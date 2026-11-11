import { createHash, randomUUID } from "node:crypto";

import { after } from "next/server";

import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { createContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { rulesOnlyAi } from "@/lib/pipeline/ai";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { analysisDeps } from "@/lib/pipeline/deps";
import { SAMPLE_CONTRACTS } from "@/lib/samples/contracts";
import { getStorage } from "@/lib/storage";

/**
 * Loads three fictional sample contracts into the organisation for a demo.
 * They get the rule-based review only, so loading them costs no AI quota;
 * "Run analysis again" on any of them gives the full review.
 */
export async function POST() {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return Response.json({ error: "Your role cannot add contracts." }, { status: 403 });
  }

  const storage = getStorage();
  const created: { contractId: string; jobId: string }[] = [];
  for (const sample of SAMPLE_CONTRACTS) {
    const bytes = new TextEncoder().encode(sample.text);
    const contractId = randomUUID();
    const storageKey = `${org.id}/${contractId}/original.txt`;
    await storage.put(storageKey, bytes, "text/plain");
    const { job } = await withOrg(org.id, (tx) =>
      createContract(tx, {
        id: contractId,
        orgId: org.id,
        createdBy: user.id,
        title: sample.title,
        storageKey,
        fileName: sample.fileName,
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        // Salted, so a sample never counts as a duplicate of a real upload.
        fileHash: createHash("sha256").update(`sample:${contractId}`).digest("hex"),
      }),
    );
    created.push({ contractId, jobId: job.id });
  }

  after(async () => {
    for (const ids of created) {
      await runAnalysis({ ...analysisDeps(org.id), ai: rulesOnlyAi }, ids);
    }
  });
  return Response.json({ created: created.map((c) => c.contractId) }, { status: 201 });
}
