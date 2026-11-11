import { z } from "zod";

import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { WORKFLOW_STATES, setWorkflow } from "@/lib/collab/workflow";
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

const patchBody = z
  .object({
    ourParty: z.string().trim().min(1).max(500).nullable().optional(),
    workflowStatus: z.enum(WORKFLOW_STATES).optional(),
    assigneeId: z.string().refine(isUuid).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to change.");

/**
 * Change a contract: which party the organisation is (takes effect on the
 * next analysis), its workflow status, or who is reviewing it.
 */
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
      { error: parsed.error.issues[0]?.message ?? "Invalid change." },
      { status: 400 },
    );
  }
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { ourParty, workflowStatus, assigneeId } = parsed.data;

  const result = await withOrg(org.id, async (tx) => {
    if (ourParty !== undefined) {
      const party = await setOurParty(tx, { contractId: id, ourParty, actorId: user.id });
      if (party === "not-found") return { error: "Not found", status: 404 };
      if (party === "not-a-party") {
        return { error: "That is not one of the parties to this contract.", status: 400 };
      }
    }
    if (workflowStatus !== undefined || assigneeId !== undefined) {
      return setWorkflow(tx, {
        contractId: id,
        actor: user,
        status: workflowStatus,
        assigneeId,
      });
    }
    return getContract(tx, id).then((detail) =>
      detail ? detail.contract : { error: "Not found", status: 404 },
    );
  });

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({
    ourParty: result.ourParty,
    workflowStatus: result.workflowStatus,
    assigneeId: result.assigneeId,
  });
}
