import { getApiAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { isFinished, type JobProgress } from "@/lib/contracts/progress";
import { getLatestJob } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";

export const maxDuration = 60;

const POLL_MS = 1000;
/** Close before the function limit; the browser's EventSource reconnects by itself. */
const MAX_STREAM_MS = 50_000;

/** Server-sent events with the analysis job's progress, read from the `jobs` table. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const orgId = context.org.id;
  const read = () => withOrg(orgId, (tx) => getLatestJob(tx, id));

  const first = isUuid(id) ? await read() : null;
  if (!first) return Response.json({ error: "Not found" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let last = "";
      let job: typeof first | null = first;

      while (job && !request.signal.aborted) {
        const progress: JobProgress = {
          stage: job.stage,
          status: job.status,
          error: job.error,
        };
        const payload = JSON.stringify(progress);
        if (payload !== last) {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          last = payload;
        }
        if (isFinished(job.status) || Date.now() - startedAt > MAX_STREAM_MS) break;

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        job = await read().catch(() => null);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
