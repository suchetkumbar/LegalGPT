import { z } from "zod";

import { getApiAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import { updatePosition } from "@/lib/playbook/queries";

const optionalText = z
  .string()
  .max(4000)
  .transform((value) => value.trim() || null)
  .nullable();

const body = z.object({
  standardText: z
    .string()
    .trim()
    .min(1, "The standard position cannot be empty.")
    .max(4000),
  fallbackText: optionalText,
  walkaway: optionalText,
  riskWeight: z.number().min(0.1).max(5),
});

/** Edit one playbook position. Admins only: the playbook sets the standard for the whole org. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (user.role !== "admin") {
    return Response.json(
      { error: "Only an admin can change the playbook." },
      { status: 403 },
    );
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid playbook position." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const position = isUuid(id)
    ? await withOrg(org.id, (tx) =>
        updatePosition(tx, { positionId: id, actorId: user.id, update: parsed.data }),
      )
    : null;
  if (!position) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ position });
}
