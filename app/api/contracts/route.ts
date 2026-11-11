import { createHash, randomUUID } from "node:crypto";

import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { parentVersion } from "@/lib/contracts/full";
import { isUuid } from "@/lib/contracts/ids";
import { createContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { startAnalysis } from "@/lib/pipeline/enqueue";
import { MAX_UPLOAD_BYTES, MIME_TYPES, detectFileKind } from "@/lib/pipeline/file-type";
import { findDuplicate } from "@/lib/privacy/retention";
import { limitRequest } from "@/lib/security/guard";
import { getStorage } from "@/lib/storage";

export const maxDuration = 300;

class ParentNotFound extends Error {}

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

function titleFrom(raw: FormDataEntryValue | null, fileName: string): string {
  const given = typeof raw === "string" ? raw.trim() : "";
  const fallback = fileName.replace(/\.[^.]+$/, "").trim() || "Untitled contract";
  return (given || fallback).replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Upload a contract (multipart form: `file`, optional `title`). Creates the
 * contract, stores the original file privately, and starts its analysis.
 */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return fail(401, "Sign in to upload contracts.");
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return fail(403, "Your role can view contracts but not upload them.");
  }

  const limited = await limitRequest("upload", user.id);
  if (limited) return limited;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return fail(413, "The file is larger than 20 MB.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "The upload could not be read.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "No file was attached.");
  if (file.size === 0) return fail(400, "The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "The file is larger than 20 MB.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectFileKind(bytes, file.name);
  if (!kind) return fail(415, "Upload a PDF, a Word document (.docx) or a text file.");

  // The same file uploaded again (not as a new version): reuse the earlier
  // analysis instead of spending the model quota twice.
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (form.get("parentId") === null && form.get("force") === null) {
    const duplicate = await withOrg(org.id, (tx) => findDuplicate(tx, fileHash));
    if (duplicate) {
      return Response.json({ id: duplicate.id, duplicate: true }, { status: 200 });
    }
  }

  const contractId = randomUUID();
  // The key is built from ids only; the uploader's file name never reaches storage.
  const storageKey = `${org.id}/${contractId}/original.${kind}`;
  const storage = getStorage();
  await storage.put(storageKey, bytes, MIME_TYPES[kind]);

  // A new version of an existing contract: must be one this org can see.
  const parentRaw = form.get("parentId");
  const parentId = typeof parentRaw === "string" && isUuid(parentRaw) ? parentRaw : null;

  let jobId: string;
  try {
    const created = await withOrg(org.id, async (tx) => {
      const parent = parentId ? await parentVersion(tx, parentId) : null;
      if (parentId && !parent) throw new ParentNotFound();
      return createContract(tx, {
        parent,
        id: contractId,
        orgId: org.id,
        createdBy: user.id,
        title: titleFrom(form.get("title"), file.name),
        storageKey,
        fileName: file.name.slice(0, 255),
        mimeType: MIME_TYPES[kind],
        sizeBytes: bytes.length,
        fileHash,
      });
    });
    jobId = created.job.id;
  } catch (error) {
    await storage.delete(storageKey).catch(() => {});
    if (error instanceof ParentNotFound) {
      return fail(404, "The earlier version could not be found.");
    }
    throw error;
  }

  await startAnalysis({ orgId: org.id, contractId, jobId });

  return Response.json({ id: contractId }, { status: 201 });
}
