import "server-only";

import { pipelineAi } from "@/lib/ai/generate";
import { withOrg } from "@/lib/db";
import { getStorage } from "@/lib/storage";

import type { AnalysisDeps } from "./analyze";

/** The real dependencies for the pipeline, limited to one organisation's data. */
export function analysisDeps(orgId: string): AnalysisDeps {
  return {
    scope: (fn) => withOrg(orgId, fn),
    readFile: (key) => getStorage().get(key),
    ai: pipelineAi,
  };
}
