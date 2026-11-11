import { z } from "zod";

import { pipelineAi } from "@/lib/ai/generate";
import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { loadPacks } from "@/lib/compliance/store";
import { withOrg } from "@/lib/db";
import { limitRequest } from "@/lib/security/guard";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "@/lib/usage/budget";
import {
  assembleDraft,
  contractTypeFor,
  refineDraft,
  requirementsSchema,
  reviewDraft,
} from "@/lib/drafting/generate";
import { findTemplate } from "@/lib/drafting/templates";
import { draftDocx, safeFileName } from "@/lib/export/export";
import { ensurePlaybook } from "@/lib/playbook/queries";

export const maxDuration = 300;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assemble"), requirements: requirementsSchema }),
  z.object({
    action: z.literal("refine"),
    templateId: z.string(),
    text: z.string().min(50).max(200_000),
    instructions: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal("docx"),
    title: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(200_000),
  }),
]);

/**
 * Drafting.
 * - assemble: builds a draft from a template and the playbook. No model call.
 * - refine: one model call that applies the drafter's instructions.
 * - docx: returns a draft as a Word file.
 * Every draft text is reviewed with the rules and compliance packs before it is returned.
 */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditContracts(context.user)) {
    return Response.json({ error: "Your role cannot draft contracts." }, { status: 403 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const orgId = context.org.id;

  if (input.action === "docx") {
    const file = await draftDocx(input.title, input.text);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFileName(input.title, "docx")}"`,
      },
    });
  }

  const templateId =
    input.action === "assemble" ? input.requirements.templateId : input.templateId;
  const template = findTemplate(templateId);
  if (!template) return Response.json({ error: "Unknown template." }, { status: 400 });

  const { positions, packs } = await withOrg(orgId, async (tx) => ({
    positions: (await ensurePlaybook(tx, orgId)).positions,
    packs: await loadPacks(tx),
  }));

  if (input.action === "assemble") {
    const text = assembleDraft(template, input.requirements, positions);
    return Response.json({
      title: template.title,
      text,
      review: reviewDraft(text, packs, contractTypeFor(template.id)),
    });
  }

  try {
    await withOrg(context.org.id, assertWithinBudget);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const limited = await limitRequest("ai", context.user.id);
  if (limited) return limited;
  try {
    const refined = await refineDraft(pipelineAi, {
      text: input.text,
      instructions: input.instructions,
    });
    await withOrg(orgId, (tx) =>
      recordUsage(tx, {
        orgId,
        userId: context.user.id,
        kind: "draft_refine",
        usage: refined.usage,
      }),
    );
    return Response.json({
      title: template.title,
      text: refined.text,
      changes: refined.changes,
      model: refined.modelId,
      review: reviewDraft(refined.text, packs, contractTypeFor(template.id)),
    });
  } catch (error) {
    console.error(
      "[generate] refine failed:",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      {
        error:
          "The AI step could not finish, most likely because the free model quota is used up or the request took too long. Your draft is unchanged.",
      },
      { status: 503 },
    );
  }
}
