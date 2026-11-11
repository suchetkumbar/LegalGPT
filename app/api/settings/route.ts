import { z } from "zod";

import { getApiAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import {
  RETENTION_CHOICES,
  deleteAllContracts,
  setRetention,
} from "@/lib/privacy/retention";
import { getStorage } from "@/lib/storage";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("retention"),
    days: z.union([
      z.literal(RETENTION_CHOICES[0]),
      z.literal(RETENTION_CHOICES[1]),
      z.literal(RETENTION_CHOICES[2]),
      z.null(),
    ]),
  }),
  z.object({ action: z.literal("delete-all"), confirm: z.string() }),
]);

/** Organisation privacy settings. Admins only. */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (user.role !== "admin") {
    return Response.json(
      { error: "Only an admin can change these settings." },
      { status: 403 },
    );
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid setting." }, { status: 400 });

  if (parsed.data.action === "retention") {
    const days = parsed.data.days;
    await withOrg(org.id, (tx) =>
      setRetention(tx, { orgId: org.id, days, actorId: user.id }),
    );
    return Response.json({ retentionDays: days });
  }

  // Deleting everything needs the organisation's name typed out, as a guard against slips.
  if (parsed.data.confirm.trim() !== org.name) {
    return Response.json(
      { error: "Type the organisation's name exactly to confirm." },
      { status: 400 },
    );
  }
  const keys = await withOrg(org.id, (tx) => deleteAllContracts(tx, user.id));
  const storage = getStorage();
  for (const key of keys) await storage.delete(key).catch(() => {});
  return Response.json({ deleted: keys.length });
}
