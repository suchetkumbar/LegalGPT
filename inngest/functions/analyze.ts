import { NonRetriableError } from "inngest";

import {
  ANALYZE_STAGES,
  completeAnalysis,
  failAnalysis,
  runStage,
} from "@/lib/pipeline/analyze";
import { analysisDeps } from "@/lib/pipeline/deps";
import { DocumentError } from "@/lib/pipeline/parse";

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
    onFailure: async ({ event, error }) => {
      const { orgId, contractId, jobId } = event.data.event.data as AnalyzeRequested;
      await failAnalysis(analysisDeps(orgId), { contractId, jobId }, error);
    },
  },
  async ({ event, step }) => {
    const { orgId, contractId, jobId } = event.data as AnalyzeRequested;
    const ids = { contractId, jobId };

    for (const stage of ANALYZE_STAGES) {
      await step.run(stage, async () => {
        const deps = analysisDeps(orgId);
        try {
          await runStage(deps, ids, stage);
        } catch (error) {
          // A document that cannot be read will not improve with retries.
          // Record the message written for the user, then stop.
          if (error instanceof DocumentError) {
            await failAnalysis(deps, ids, error);
            throw new NonRetriableError(error.message);
          }
          throw error;
        }
      });
    }

    await step.run("complete", () => completeAnalysis(analysisDeps(orgId), ids));
    return { contractId };
  },
);
