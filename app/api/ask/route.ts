import { z } from "zod";

import { pipelineAi } from "@/lib/ai/generate";
import { answerQuestion } from "@/lib/ask/answer";
import { retrieve } from "@/lib/ask/retrieve";
import { getApiAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "@/lib/usage/budget";

export const maxDuration = 300;

const body = z.object({
  question: z.string().trim().min(3).max(1000),
  /** Omit to ask across every contract in the organisation. */
  contractId: z.string().refine(isUuid).nullable(),
  /** The reasoning tier, for harder questions. */
  deep: z.boolean().default(false),
});

/** Ask a contract, or the whole portfolio. Two model calls: one to embed the question, one to answer. */
export async function POST(request: Request) {
  const context = await getApiAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Ask a question of 3 to 1000 characters." },
      { status: 400 },
    );
  const { question, contractId, deep } = parsed.data;
  try {
    await withOrg(context.org.id, assertWithinBudget);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  // The question's embedding improves recall; if it fails, full-text search alone is used.
  let embedding: number[] | null = null;
  try {
    embedding = (await pipelineAi.embed([question], "query")).embeddings[0] ?? null;
  } catch (error) {
    console.warn(
      "[ask] embedding failed, using full-text search only:",
      error instanceof Error ? error.message : error,
    );
  }

  const sources = await withOrg(context.org.id, (tx) =>
    retrieve(tx, { question, contractId, embedding }),
  );
  if (sources.length === 0) {
    return Response.json({
      answer: "Nothing in the contracts matches that question.",
      citations: [],
      notInSources: true,
      unverified: false,
      sources: [],
    });
  }

  try {
    const answer = await answerQuestion(pipelineAi, {
      question,
      sources,
      portfolio: !contractId,
      deep,
    });
    await withOrg(context.org.id, (tx) =>
      recordUsage(tx, {
        orgId: context.org.id,
        userId: context.user.id,
        kind: deep ? "ask_deep" : "ask",
        usage: answer.usage,
      }),
    );
    return Response.json({
      ...answer,
      sources: sources.map(({ clauseId, contractId: id, contractTitle, label }) => ({
        clauseId,
        contractId: id,
        contractTitle,
        label,
      })),
    });
  } catch (error) {
    console.error("[ask] answer failed:", error instanceof Error ? error.message : error);
    return Response.json(
      {
        error:
          "The AI could not answer just now, most likely because the free model quota is used up. The most relevant clauses are listed below.",
        sources: sources.map(({ clauseId, contractId: id, contractTitle, label }) => ({
          clauseId,
          contractId: id,
          contractTitle,
          label,
        })),
      },
      { status: 503 },
    );
  }
}
