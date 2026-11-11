import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { createAnalysisJob } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { startAnalysis } from "@/lib/pipeline/enqueue";

export const maxDuration = 300;

/** Run the analysis again, for example after the model quota has reset. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { org, user } = context;
  if (!canEditContracts(user)) {
    return Response.json(
      { error: "Your role can view contracts but not re-run analysis." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const result = isUuid(id)
    ? await withOrg(org.id, (tx) =>
        createAnalysisJob(tx, { contractId: id, actorId: user.id }),
      )
    : "not-found";

  if (result === "not-found") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (result === "busy") {
    return Response.json(
      { error: "This contract is already being analysed." },
      { status: 409 },
    );
  }

  await startAnalysis({ orgId: org.id, contractId: id, jobId: result.id });
  return Response.json({ jobId: result.id }, { status: 202 });
}
