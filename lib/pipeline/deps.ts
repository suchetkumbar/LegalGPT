import "server-only";

import { pipelineAi } from "@/lib/ai/generate";
import { withOrg } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { assertWithinBudget } from "@/lib/usage/budget";

import type { AnalysisDeps } from "./analyze";

/** The real dependencies for the pipeline, limited to one organisation's data. */
export function analysisDeps(orgId: string): AnalysisDeps {
  return {
    scope: (fn) => withOrg(orgId, fn),
    readFile: (key) => getStorage().get(key),
    ai: pipelineAi,
    checkBudget: () => withOrg(orgId, assertWithinBudget),
  };
}
