import { NonRetriableError } from "inngest";

import {
  ANALYZE_STAGES,
  completeAnalysis,
  failAnalysis,
  isModelStage,
  runStage,
  type AnalyzeStage,
} from "@/lib/pipeline/analyze";
import { analysisDeps } from "@/lib/pipeline/deps";
import { DocumentError } from "@/lib/pipeline/parse";
import { notifyBulkScanIfDone } from "@/lib/bulk/notify";
import { BudgetExceededError } from "@/lib/usage/budget";

import { ANALYZE_REQUESTED, inngest, type AnalyzeRequested } from "../client";

/**
 * The `analyze` job as durable steps. A step that fails is retried on its
 * own; stages that already succeeded are not run again.
 */
export const analyzeContract = inngest.createFunction(
  {
    id: "analyze-contract",
    triggers: [{ event: ANALYZE_REQUESTED }],
    retries: 3,
    // One analysis at a time per organisation: the free model tier has tight
    // rate limits, and bursts are what trip them.
    concurrency: { limit: 1, key: "event.data.orgId" },
    // A bulk scan queues many analyses; start at most 2 a minute per org so the
    // free model quota (requests per minute) is not exceeded. 200 contracts
    // take about 100 minutes.
    throttle: { limit: 2, period: "1m", key: "event.data.orgId" },
    onFailure: async ({ event, error }) => {
      const { orgId, contractId, jobId } = event.data.event.data as AnalyzeRequested;
      await failAnalysis(analysisDeps(orgId), { contractId, jobId }, error);
    },
  },
  async ({ event, step }) => {
    const { orgId, contractId, jobId } = event.data as AnalyzeRequested;
    const ids = { contractId, jobId };

    // If a model stage fails for good, skip the other model stages but still
    // run the ones that need no model, so the contract gets its rule findings.
    let failedModelStage: AnalyzeStage | null = null;

    for (const stage of ANALYZE_STAGES) {
      if (failedModelStage && isModelStage(stage)) continue;
      const run = step.run(stage, async () => {
        const deps = analysisDeps(orgId);
        try {
          await runStage(deps, ids, stage);
        } catch (error) {
          // A document that cannot be read will not improve with retries.
          // Record the message written for the user, then stop.
          if (error instanceof BudgetExceededError)
            throw new NonRetriableError(error.message);
          if (error instanceof DocumentError) {
            await failAnalysis(deps, ids, error);
            throw new NonRetriableError(error.message);
          }
          throw error;
        }
      });
      if (!isModelStage(stage)) {
        await run;
        continue;
      }
      try {
        await run;
      } catch {
        // Retries are used up. The provider's error is in the run's own log.
        failedModelStage = stage;
      }
    }

    if (failedModelStage) {
      const stage = failedModelStage;
      await step.run("record-model-failure", () =>
        failAnalysis(
          analysisDeps(orgId),
          ids,
          new Error(`model stage "${stage}" failed`),
          stage,
        ),
      );
      await step.run("notify-bulk", () => notifyBulkScanIfDone(contractId));
      return { contractId, incomplete: stage };
    }

    await step.run("complete", () => completeAnalysis(analysisDeps(orgId), ids));
    await step.run("notify-bulk", () => notifyBulkScanIfDone(contractId));
    return { contractId };
  },
);
