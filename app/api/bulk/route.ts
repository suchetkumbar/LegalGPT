import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { after } from "next/server";

import { inngestEnabled } from "@/inngest/client";
import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { notifyBulkScanIfDone } from "@/lib/bulk/notify";
import { BulkError, readArchive } from "@/lib/bulk/scan";
import { createContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { limitRequest } from "@/lib/security/guard";
import * as schema from "@/lib/db/schema";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { analysisDeps } from "@/lib/pipeline/deps";
import { startAnalysis } from "@/lib/pipeline/enqueue";
import { MIME_TYPES } from "@/lib/pipeline/file-type";
import { getStorage } from "@/lib/storage";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";

export const maxDuration = 300;

/** Without the job runner, analyses run in this request's process, so keep batches small. */
const MAX_INLINE_FILES = 10;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;

/** Upload a zip of contracts. Each one is analysed in turn, and admins get an email when all are done. */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return Response.json(
      { error: "Your role cannot upload contracts." },
      { status: 403 },
    );
  }

  const limited = await limitRequest("bulk", user.id);
  if (limited) return limited;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return Response.json({ error: "Attach a zip file." }, { status: 400 });
  if (file.size > MAX_ZIP_BYTES) {
    return Response.json({ error: "The zip is larger than 25 MB." }, { status: 413 });
  }

  let archive;
  try {
    archive = await readArchive(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof BulkError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
  if (archive.files.length === 0) {
    return Response.json(
      {
        error: "No PDF, Word or text files were found in the zip.",
        skipped: archive.skipped,
      },
      { status: 400 },
    );
  }
  const queued = inngestEnabled();
  if (!queued && archive.files.length > MAX_INLINE_FILES) {
    return Response.json(
      {
        error: `Without the background job runner, a bulk scan can hold at most ${MAX_INLINE_FILES} files. Configure Inngest to scan up to 200.`,
      },
      { status: 400 },
    );
  }

  try {
    await withOrg(org.id, assertWithinBudget);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const storage = getStorage();
  const scanId = randomUUID();
  const created: { contractId: string; jobId: string }[] = [];
  for (const entry of archive.files) {
    const contractId = randomUUID();
    const storageKey = `${org.id}/${contractId}/original.${entry.kind}`;
    await storage.put(storageKey, entry.bytes, MIME_TYPES[entry.kind]);
    created.push({ contractId, jobId: "" });
  }

  await withOrg(org.id, async (tx) => {
    await tx.insert(schema.bulkScans).values({
      id: scanId,
      orgId: org.id,
      createdBy: user.id,
      fileName: file.name.slice(0, 255),
      total: archive.files.length,
      skipped: archive.skipped,
    });
    for (const [index, item] of created.entries()) {
      const entry = archive.files[index];
      const result = await createContract(tx, {
        id: item.contractId,
        orgId: org.id,
        createdBy: user.id,
        title: entry.name.replace(/\.[^.]+$/, "") || entry.name,
        storageKey: `${org.id}/${item.contractId}/original.${entry.kind}`,
        fileName: entry.name,
        mimeType: MIME_TYPES[entry.kind],
        sizeBytes: entry.bytes.length,
        fileHash: createHash("sha256").update(entry.bytes).digest("hex"),
      });
      item.jobId = result.job.id;
      await tx
        .update(schema.contracts)
        .set({ bulkScanId: scanId })
        .where(eq(schema.contracts.id, item.contractId));
    }
  });

  if (queued) {
    for (const item of created) await startAnalysis({ orgId: org.id, ...item });
  } else {
    // One at a time, so a small batch does not burst the model quota.
    after(async () => {
      for (const item of created) {
        await runAnalysis(analysisDeps(org.id), item);
        await notifyBulkScanIfDone(item.contractId);
      }
    });
  }

  return Response.json(
    { id: scanId, queued: created.length, skipped: archive.skipped },
    { status: 201 },
  );
}
