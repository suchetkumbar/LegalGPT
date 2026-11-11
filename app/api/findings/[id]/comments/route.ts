import { z } from "zod";

import { getApiAuthContext } from "@/lib/auth/context";
import { addComment } from "@/lib/collab/workflow";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import { limitRequest } from "@/lib/security/guard";

const body = z.object({ body: z.string().trim().min(1).max(4000) });

/** Comment on a finding. Every member, including viewers, can take part in the discussion. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await limitRequest("comment", context.user.id);
  if (limited) return limited;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "A comment needs some text." }, { status: 400 });
  }
  const { id } = await params;
  const comment = isUuid(id)
    ? await withOrg(context.org.id, (tx) =>
        addComment(tx, {
          findingId: id,
          authorId: context.user.id,
          body: parsed.data.body,
        }),
      )
    : null;
  if (!comment) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ id: comment.id }, { status: 201 });
}
