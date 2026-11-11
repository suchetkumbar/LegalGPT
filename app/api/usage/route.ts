import { z } from "zod";

import { getApiAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import { monthUsage, setBudget } from "@/lib/usage/budget";

/** This month's model usage for the organisation. */
export async function GET() {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await withOrg(context.org.id, (tx) => monthUsage(tx)));
}

const body = z.object({
  monthlyTokenBudget: z.number().int().min(1000).max(1_000_000_000).nullable(),
});

/** Set or clear the monthly token budget. Admins only. */
export async function PUT(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (context.user.role !== "admin") {
    return Response.json({ error: "Only an admin can set the budget." }, { status: 403 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "The budget must be at least 1,000 tokens, or empty for no limit." },
      { status: 400 },
    );
  }
  await withOrg(context.org.id, (tx) =>
    setBudget(tx, {
      orgId: context.org.id,
      budget: parsed.data.monthlyTokenBudget,
      actorId: context.user.id,
    }),
  );
  return Response.json({ monthlyTokenBudget: parsed.data.monthlyTokenBudget });
}
