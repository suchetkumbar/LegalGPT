import { getApiAuthContext } from "@/lib/auth/context";
import { addPolicy, policyInput, removePolicy } from "@/lib/compliance/store";
import { withOrg } from "@/lib/db";

async function adminContext() {
  const context = await getApiAuthContext();
  if (!context)
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (context.user.role !== "admin") {
    return {
      error: Response.json(
        { error: "Only an admin can change the internal policies." },
        { status: 403 },
      ),
    };
  }
  return { context };
}

/** Add an internal policy. Applies to contracts analysed from now on. */
export async function POST(request: Request) {
  const { context, error } = await adminContext();
  if (error) return error;

  const parsed = policyInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid policy." },
      { status: 400 },
    );
  }
  const rule = await withOrg(context.org.id, (tx) =>
    addPolicy(tx, {
      orgId: context.org.id,
      actorId: context.user.id,
      policy: parsed.data,
    }),
  );
  return Response.json({ id: rule.id }, { status: 201 });
}

/** Remove an internal policy: DELETE /api/policies?id=internal.xxxx */
export async function DELETE(request: Request) {
  const { context, error } = await adminContext();
  if (error) return error;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^internal\.[a-z0-9-]{1,40}$/.test(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const removed = await withOrg(context.org.id, (tx) =>
    removePolicy(tx, { orgId: context.org.id, actorId: context.user.id, ruleId: id }),
  );
  return removed
    ? Response.json({ removed: id })
    : Response.json({ error: "Not found" }, { status: 404 });
}
