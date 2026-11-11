import { getApiAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import { toIcs } from "@/lib/obligations/calendar";
import { listObligations } from "@/lib/obligations/queries";

/** Upcoming obligations as JSON, or `?format=ics` as a calendar file. */
export async function GET(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const items = await withOrg(context.org.id, (tx) => listObligations(tx));
  if (new URL(request.url).searchParams.get("format") === "ics") {
    return new Response(toIcs(items), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="contract-obligations.ics"',
      },
    });
  }
  return Response.json(
    { obligations: items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
