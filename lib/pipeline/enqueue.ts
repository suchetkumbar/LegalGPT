import "server-only";

import { after } from "next/server";

import { ANALYZE_REQUESTED, inngest, inngestEnabled } from "@/inngest/client";

import { runAnalysis } from "./analyze";
import { analysisDeps } from "./deps";

/**
 * Starts the analysis of a contract. Must be called from a route handler.
 *
 * With Inngest configured, the job is queued and runs as retryable steps.
 * Without it (plain `npm run dev`), the same stages run in this process once
 * the response has been sent, with no retries.
 */
export async function startAnalysis(input: {
  orgId: string;
  contractId: string;
  jobId: string;
}): Promise<"queued" | "inline"> {
  if (inngestEnabled()) {
    await inngest.send({ name: ANALYZE_REQUESTED, data: input });
    return "queued";
  }
  after(async () => {
    await runAnalysis(analysisDeps(input.orgId), {
      contractId: input.contractId,
      jobId: input.jobId,
    });
    const { notifyBulkScanIfDone } = await import("@/lib/bulk/notify");
    await notifyBulkScanIfDone(input.contractId);
  });
  return "inline";
}
