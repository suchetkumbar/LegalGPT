import { z } from "zod";

import {
  DOCUMENT_IS_DATA,
  escapeDocument,
  type PipelineAi,
  type TokenUsage,
} from "@/lib/pipeline/ai";
import { findQuote } from "@/lib/pipeline/quotes";

import type { Source } from "./retrieve";

/**
 * Answers a question from retrieved clauses only. The model must cite each
 * point with a source number and a verbatim quote; the server keeps only the
 * citations whose quote is really in that source.
 */

const schema = z.object({
  answer: z
    .string()
    .describe("A direct answer in plain words, citing sources inline as [S1], [S2]"),
  citations: z.array(
    z.object({
      source: z.number().int().describe("The source number, e.g. 1 for [S1]"),
      quote: z.string().describe("The exact words of the source that support the answer"),
    }),
  ),
  notInSources: z
    .boolean()
    .describe(
      "True if the sources do not contain the answer. Then say so in `answer` and give no citations.",
    ),
});

export type Citation = {
  source: number;
  clauseId: string;
  contractId: string;
  label: string;
  contractTitle: string;
  quote: string;
};

export type Answer = {
  answer: string;
  citations: Citation[];
  notInSources: boolean;
  /** True when the model answered but none of its citations could be verified. */
  unverified: boolean;
  modelId: string;
  usage: TokenUsage;
};

export async function answerQuestion(
  ai: PipelineAi,
  input: { question: string; sources: Source[]; portfolio: boolean; deep: boolean },
): Promise<Answer> {
  const blocks = input.sources.map(
    (source, index) =>
      `[S${index + 1}] ${input.portfolio ? `${source.contractTitle}, ` : ""}${source.label}\n${escapeDocument(source.text.slice(0, 3000))}`,
  );
  const result = await ai.generateStructured({
    tier: input.deep ? "reasoning" : "standard",
    functionId: "ask.answer",
    schema,
    system: [
      "You answer questions about contracts for a contract review tool used by Indian businesses.",
      DOCUMENT_IS_DATA,
      "Answer only from the numbered sources. Cite every statement with its source number and the exact supporting words. If the sources do not answer the question, say so plainly; do not use outside knowledge about the contract. Do not give legal advice or say whether to sign.",
    ].join("\n"),
    prompt: `<document>\n${blocks.join("\n\n")}\n</document>\n\nQuestion: ${input.question}`,
    thinking: input.deep ? "medium" : "low",
    timeoutMs: input.deep ? 240_000 : 90_000,
  });

  const citations: Citation[] = [];
  for (const citation of result.object.citations) {
    const source = input.sources[citation.source - 1];
    if (!source || findQuote(source.text, citation.quote) < 0) continue;
    if (citations.some((c) => c.source === citation.source && c.quote === citation.quote))
      continue;
    citations.push({
      source: citation.source,
      clauseId: source.clauseId,
      contractId: source.contractId,
      label: source.label,
      contractTitle: source.contractTitle,
      quote: citation.quote.trim(),
    });
  }

  const notInSources = result.object.notInSources;
  return {
    answer: result.object.answer.trim(),
    citations: notInSources ? [] : citations,
    notInSources,
    unverified: !notInSources && citations.length === 0,
    modelId: result.modelId,
    usage: result.usage,
  };
}
