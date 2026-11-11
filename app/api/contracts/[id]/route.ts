import { getApiAuthContext } from "@/lib/auth/context";
import { getContract } from "@/lib/contracts/queries";
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
