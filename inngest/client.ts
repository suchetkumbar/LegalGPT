import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "legalgpt" });

export const ANALYZE_REQUESTED = "contract/analyze.requested";

/** Ids only: contract text never travels through the job runner. */
export type AnalyzeRequested = {
  orgId: string;
  contractId: string;
  jobId: string;
};

/**
 * True when events can be delivered: on Vercel once the Inngest integration
 * has set an event key, or locally when INNGEST_DEV=1 and the Inngest dev
 * server is running. Otherwise analysis runs in the request's own process.
 */
export function inngestEnabled(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === "1";
}
