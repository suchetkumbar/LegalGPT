import { z } from "zod";

import { pipelineAi } from "@/lib/ai/generate";
import { canEditContracts, getApiAuthContext } from "@/lib/auth/context";
import { getFullContract } from "@/lib/contracts/full";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import { limitRequest } from "@/lib/security/guard";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "@/lib/usage/budget";
import {
  draftProposals,
  playbookProposals,
  type NegotiationInput,
} from "@/lib/negotiate/negotiate";
import { ensurePlaybook } from "@/lib/playbook/queries";

export const maxDuration = 300;

const body = z.object({
  contractId: z.string().refine(isUuid),
  findingIds: z.array(z.string().refine(isUuid)).min(1).max(20),
  /** false: playbook wording only, no model call. */
  useModel: z.boolean(),
});

/** Counter-proposals for the chosen findings: from the playbook, or one model call for all of them. */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditContracts(context.user)) {
    return Response.json(
      { error: "Your role cannot negotiate contracts." },
      { status: 403 },
    );
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Choose between 1 and 20 findings." }, { status: 400 });
  }
  const { contractId, findingIds, useModel } = parsed.data;
  const orgId = context.org.id;

  const loaded = await withOrg(orgId, async (tx) => ({
    contract: await getFullContract(tx, contractId),
    positions: (await ensurePlaybook(tx, orgId)).positions,
  }));
  if (!loaded.contract) return Response.json({ error: "Not found" }, { status: 404 });
  const { contract, positions } = loaded;

  const inputs: NegotiationInput[] = contract.findings
    .filter((finding) => findingIds.includes(finding.id))
    .map((finding) => {
      const position = positions.find((p) => p.clauseType === finding.clauseType);
      return {
        findingId: finding.id,
        title: finding.title,
        quotedText: finding.quotedText,
        reasoning: finding.reasoning,
        clauseText: finding.clauseId
          ? (contract.clauseTexts.get(finding.clauseId) ?? null)
          : null,
        position: position
          ? {
              standardText: position.standardText,
              fallbackText: position.fallbackText,
              walkaway: position.walkaway,
            }
          : null,
      };
    });
  if (inputs.length === 0)
    return Response.json({ error: "No such findings." }, { status: 400 });

  if (!useModel) return Response.json({ proposals: playbookProposals(inputs) });
  const limited = await limitRequest("ai", context.user.id);
  if (limited) return limited;
  try {
    await withOrg(context.org.id, assertWithinBudget);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  try {
    const result = await draftProposals(pipelineAi, inputs, contract.contract.ourParty);
    await withOrg(orgId, (tx) =>
      recordUsage(tx, {
        orgId,
        userId: context.user.id,
        kind: "negotiate",
        usage: result.usage,
      }),
    );
    return Response.json({ proposals: result.proposals, model: result.modelId });
  } catch (error) {
    console.error("[negotiate] failed:", error instanceof Error ? error.message : error);
    return Response.json(
      {
        error:
          "The AI step could not finish, most likely because the free model quota is used up. Playbook wording is still available.",
        proposals: playbookProposals(inputs),
      },
      { status: 503 },
    );
  }
}
