import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { analyzeContract } from "@/inngest/functions/analyze";

// Each step is one request to this route, so a step can take this long.
export const maxDuration = 300;

/** Job runner endpoint. Requests are signed by Inngest and verified by `serve`. */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzeContract],
});
