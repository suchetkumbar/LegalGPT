import { timingSafeEqual } from "node:crypto";

import { adminDb } from "@/lib/db";
import { sendDueReminders } from "@/lib/obligations/reminders";
import { purgeExpired } from "@/lib/privacy/retention";
import { getStorage } from "@/lib/storage";

export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The daily sweep, called by Vercel Cron at 09:00 IST with the CRON_SECRET:
 * deletes contracts past their organisation's retention period, then sends
 * deadline reminders. Each part runs even if the other fails.
 */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const storage = getStorage();
  const [retention, reminders] = await Promise.allSettled([
    purgeExpired(adminDb(), (key) => storage.delete(key)),
    sendDueReminders(),
  ]);
  const report = (result: PromiseSettledResult<unknown>) =>
    result.status === "fulfilled"
      ? result.value
      : {
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        };
  return Response.json(
    { retention: report(retention), reminders: report(reminders) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
