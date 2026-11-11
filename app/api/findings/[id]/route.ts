import { z } from "zod";

import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { setFindingStatus } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";

const body = z.object({ status: z.enum(["open", "accepted", "dismissed"]) });

/** Accept, dismiss or reopen a finding. The contract's risk score is updated to match. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return Response.json(
      { error: "Your role can view findings but not review them." },
      { status: 403 },
    );
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "status must be open, accepted or dismissed." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = isUuid(id)
    ? await withOrg(org.id, (tx) =>
        setFindingStatus(tx, {
          findingId: id,
          status: parsed.data.status,
          actorId: user.id,
        }),
      )
    : null;
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: result.finding.id,
    status: result.finding.status,
    riskScore: result.riskScore,
  });
}
