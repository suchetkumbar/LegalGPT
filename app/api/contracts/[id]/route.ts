import { z } from "zod";

import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { getContract, setOurParty } from "@/lib/contracts/queries";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";

/** A contract with its clause outline and latest job. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const detail = isUuid(id)
    ? await withOrg(context.org.id, (tx) => getContract(tx, id))
    : null;
  // Another org's contract is indistinguishable from one that does not exist.
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });

  // The storage key and file hash are internal and stay on the server.
  const contract = { ...detail.contract, blobUrl: undefined, fileHash: undefined };
  return Response.json(
    {
      contract,
      clauses: detail.clauses,
      entities: detail.entities,
      findings: detail.findings,
      job: detail.job,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const patchBody = z.object({ ourParty: z.string().trim().min(1).max(500).nullable() });

/** Set which party the organisation is. Takes effect the next time the analysis runs. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return Response.json(
      { error: "Your role cannot change contracts." },
      { status: 403 },
    );
  }

  const parsed = patchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "ourParty must be a party name or null." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = isUuid(id)
    ? await withOrg(org.id, (tx) =>
        setOurParty(tx, {
          contractId: id,
          ourParty: parsed.data.ourParty,
          actorId: user.id,
        }),
      )
    : "not-found";
  if (result === "not-found")
    return Response.json({ error: "Not found" }, { status: 404 });
  if (result === "not-a-party") {
    return Response.json(
      { error: "That is not one of the parties to this contract." },
      { status: 400 },
    );
  }
  return Response.json({ ourParty: result.ourParty });
}
