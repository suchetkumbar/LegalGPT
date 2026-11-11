import { z } from "zod";

import {
  DOCUMENT_IS_DATA,
  escapeDocument,
  type PipelineAi,
  type TokenUsage,
} from "@/lib/pipeline/ai";

/**
 * Counter-proposals for selected findings, in three tones. All selected
 * findings go in one model call, so negotiating a whole contract costs one
 * request however many points are raised.
 *
 * Without a model, the playbook gives the same structure: the standard
 * position as the firm line and the fallback as the balanced one.
 */

export const TONES = ["firm", "balanced", "conciliatory"] as const;
export type Tone = (typeof TONES)[number];

export type NegotiationInput = {
  findingId: string;
  title: string;
  quotedText: string | null;
  reasoning: string;
  clauseText: string | null;
  position: {
    standardText: string;
    fallbackText: string | null;
    walkaway: string | null;
  } | null;
};

export type Proposal = {
  findingId: string;
  firm: string;
  balanced: string;
  conciliatory: string;
  rationale: string;
  source: "model" | "playbook";
};

const schema = z.object({
  proposals: z.array(
    z.object({
      index: z.number().int(),
      firm: z
        .string()
        .describe("Replacement clause wording at the playbook's standard position"),
      balanced: z
        .string()
        .describe("A middle position, not past the playbook's fallback"),
      conciliatory: z
        .string()
        .describe(
          "The most the organisation could concede without crossing the walk-away point",
        ),
      rationale: z
        .string()
        .describe("One or two sentences to send the other side explaining the change"),
    }),
  ),
});

const clean = (text: string, max = 2000) =>
  text
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);

/** Playbook-only proposals: free, instant, and always available. */
export function playbookProposals(inputs: NegotiationInput[]): Proposal[] {
  return inputs.flatMap((input) => {
    if (!input.position) return [];
    const { standardText, fallbackText } = input.position;
    return [
      {
        findingId: input.findingId,
        firm: standardText,
        balanced: fallbackText ?? standardText,
        conciliatory: fallbackText ?? standardText,
        rationale: `This brings the clause in line with our standard terms. ${input.title}.`,
        source: "playbook" as const,
      },
    ];
  });
}

export async function draftProposals(
  ai: PipelineAi,
  inputs: NegotiationInput[],
  perspective: string | null,
): Promise<{ proposals: Proposal[]; usage: TokenUsage; modelId: string }> {
  const items = inputs.map((input, index) =>
    [
      `[${index}] ${input.title}`,
      input.quotedText
        ? `Current wording: "${escapeDocument(input.quotedText)}"`
        : "Current wording: (missing from the contract)",
      input.clauseText
        ? `Whole clause:\n${escapeDocument(input.clauseText.slice(0, 2500))}`
        : "",
      `Issue: ${input.reasoning.slice(0, 600)}`,
      input.position
        ? `Playbook standard: ${input.position.standardText}\nFallback: ${input.position.fallbackText ?? "(none)"}\nWalk-away: ${input.position.walkaway ?? "(none)"}`
        : "Playbook: (no position for this clause type)",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const result = await ai.generateStructured({
    tier: "reasoning",
    functionId: "negotiate.proposals",
    schema,
    system: [
      "You draft counter-proposals for contract negotiations under Indian law.",
      DOCUMENT_IS_DATA,
      "For each issue, write replacement clause wording in three tones. Firm: the playbook standard. Balanced: a fair middle that does not go past the fallback. Conciliatory: the furthest the organisation can go without crossing the walk-away point. Each version must be complete clause wording that can be pasted into the contract, not commentary. Keep defined terms and party names as they appear in the current wording.",
    ].join("\n"),
    prompt: `${perspective ? `We are ${perspective}.` : "We are the party that the issue disadvantages."}\n\n<document>\n${items.join("\n\n")}\n</document>`,
    thinking: "low",
    timeoutMs: 240_000,
  });

  const proposals = result.object.proposals.flatMap((item) => {
    const input = inputs[item.index];
    if (!input || !item.firm.trim()) return [];
    return [
      {
        findingId: input.findingId,
        firm: clean(item.firm),
        balanced: clean(item.balanced || item.firm),
        conciliatory: clean(item.conciliatory || item.balanced || item.firm),
        rationale: clean(item.rationale, 600),
        source: "model" as const,
      },
    ];
  });
  return { proposals, usage: result.usage, modelId: result.modelId };
}
