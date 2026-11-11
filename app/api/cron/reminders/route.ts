import { timingSafeEqual } from "node:crypto";

import { sendDueReminders } from "@/lib/obligations/reminders";

export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Daily reminder sweep. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!authorised(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await sendDueReminders();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
