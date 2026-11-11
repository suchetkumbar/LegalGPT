import { z } from "zod";

import { DOCUMENT_IS_DATA, escapeDocument, type PipelineAi, type TokenUsage } from "./ai";
import { CLAUSE_TYPES, CLAUSE_TYPE_IDS, type ClauseType } from "./clause-types";
import { findQuote } from "./quotes";
import type { Segment } from "./segment";

/**
 * The model pass over the rule-based segments. It does two things:
 *
 * 1. assigns each clause one of the clause types, and
 * 2. repairs boundaries the rules got wrong, by saying "this segment belongs
 *    with the one before it" or "a new clause starts at these words".
 *
 * The model never rewrites text or supplies offsets. It only points at
 * positions using short verbatim quotes, and the server applies the change if
 * the quote is really there. A wrong answer can therefore move a boundary,
 * but cannot alter or invent contract text.
 */

export type TypedSegment = Segment & { type: ClauseType | null };

const correctionSchema = z.object({
  index: z.number().int().describe("The segment's index, as given"),
  type: z.enum(CLAUSE_TYPE_IDS),
  heading: z
    .string()
    .nullable()
    .describe("A 2-6 word heading, only if the segment has none; otherwise null"),
  mergeWithPrevious: z
    .boolean()
    .describe(
      "True only if this segment is not a clause of its own but a continuation of the previous segment that was split off by mistake",
    ),
  splitBefore: z
    .array(
      z.object({
        quote: z
          .string()
          .describe(
            "The first 5-10 words of the new clause, copied exactly from the segment",
          ),
        type: z.enum(CLAUSE_TYPE_IDS),
        heading: z.string().nullable(),
      }),
    )
    .describe(
      "Use only when the segment plainly contains more than one separate numbered or headed clause run together. Usually empty.",
    ),
});

const responseSchema = z.object({ segments: z.array(correctionSchema) });

export type Correction = z.infer<typeof correctionSchema>;

/** Each call carries at most this much clause text, to stay well inside limits. */
const MAX_CHARS_PER_CALL = 60_000;
const MAX_SEGMENTS_PER_CALL = 60;
/** Long clauses are cut for classification; the type is clear from the opening. */
const MAX_CHARS_PER_SEGMENT = 2_500;

export function chunkSegments(segments: Segment[]): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const segment of segments) {
    const length = Math.min(segment.text.length, MAX_CHARS_PER_SEGMENT);
    if (
      current.length > 0 &&
      (size + length > MAX_CHARS_PER_CALL || current.length >= MAX_SEGMENTS_PER_CALL)
    ) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const SYSTEM = [
  "You label the clauses of a contract governed by Indian law for a contract review tool.",
  DOCUMENT_IS_DATA,
  "",
  "The contract has already been split into numbered segments by rules. For every segment, return its clause type. Use exactly one of these types:",
  ...Object.entries(CLAUSE_TYPES).map(([id, description]) => `- ${id}: ${description}`),
  "",
  "Choose the type that matches what the clause does, not just its heading. A sub-clause takes the type of its own content, which may differ from its parent heading.",
  "",
  "The split is usually right. Only correct it when it is clearly wrong:",
  "- mergeWithPrevious: the segment is a fragment of the previous clause (for example a wrapped line that happened to start with a number).",
  "- splitBefore: the segment contains two or more separate clauses run together. Give the opening words of each later clause, copied exactly.",
  "Lettered or bulleted sub-items such as (a), (b), (i) belong inside their clause. Never split on them.",
  "Return one entry for every segment index you were given, in order.",
].join("\n");

function buildPrompt(chunk: Segment[]): string {
  const body = chunk
    .map((segment) => {
      const text = segment.text.slice(0, MAX_CHARS_PER_SEGMENT);
      const cut = segment.text.length > MAX_CHARS_PER_SEGMENT ? "\n[...]" : "";
      return `[segment ${segment.ordinal}]\n${escapeDocument(text)}${cut}`;
    })
    .join("\n\n");
  return `<document>\n${body}\n</document>\n\nClassify segments ${chunk[0].ordinal} to ${chunk.at(-1)!.ordinal}.`;
}

function cleanHeading(heading: string | null): string | null {
  const cleaned = heading?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 120) : null;
}

/**
 * Applies the model's answer to the rule-based segments. Pure: no I/O.
 * Anything the model got wrong structurally (unknown index, a quote that is
 * not in the text, a merge on the first segment) is ignored rather than
 * trusted.
 */
export function applyCorrections(
  source: string,
  segments: Segment[],
  corrections: Correction[],
): TypedSegment[] {
  const byIndex = new Map(
    corrections.map((correction) => [correction.index, correction]),
  );

  type Draft = {
    number: string | null;
    heading: string | null;
    type: ClauseType | null;
    startOffset: number;
    endOffset: number;
  };
  const drafts: Draft[] = [];

  for (const segment of segments) {
    const correction = byIndex.get(segment.ordinal);

    if (correction?.mergeWithPrevious && drafts.length > 0) {
      drafts[drafts.length - 1].endOffset = segment.endOffset;
      continue;
    }

    const draft: Draft = {
      number: segment.number,
      heading: segment.heading ?? cleanHeading(correction?.heading ?? null),
      type: correction?.type ?? null,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
    };
    drafts.push(draft);

    const splits = (correction?.splitBefore ?? [])
      .map((split) => ({ split, at: findQuote(segment.text, split.quote) }))
      .filter(({ at }) => at > 0)
      .sort((a, b) => a.at - b.at);

    let previous = draft;
    let lastAt = 0;
    for (const { split, at } of splits) {
      // Ignore duplicates and pieces too small to be a clause.
      if (at - lastAt < 20) continue;
      const boundary = segment.startOffset + at;
      previous.endOffset = boundary;
      const piece: Draft = {
        number:
          /^\s*(\d{1,3}(?:\.\d{1,3})*)[.)]?\s/.exec(segment.text.slice(at))?.[1] ?? null,
        heading: cleanHeading(split.heading) ?? segment.heading,
        type: split.type,
        startOffset: boundary,
        endOffset: segment.endOffset,
      };
      drafts.push(piece);
      previous = piece;
      lastAt = at;
    }
  }

  return drafts
    .flatMap((draft) => {
      const raw = source.slice(draft.startOffset, draft.endOffset);
      const text = raw.trimEnd();
      if (!text.trim()) return [];
      return [{ ...draft, text, endOffset: draft.startOffset + text.length }];
    })
    .map((draft, ordinal) => ({ ...draft, ordinal }));
}

export type ClassifyResult = {
  segments: TypedSegment[];
  usage: TokenUsage;
  modelIds: string[];
};

export async function classifySegments(
  ai: PipelineAi,
  source: string,
  segments: Segment[],
): Promise<ClassifyResult> {
  const corrections: Correction[] = [];
  const usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  const modelIds = new Set<string>();

  // One chunk at a time: free-tier rate limits punish bursts.
  for (const chunk of chunkSegments(segments)) {
    const result = await ai.generateStructured({
      tier: "fast",
      functionId: "pipeline.classify",
      schema: responseSchema,
      system: SYSTEM,
      prompt: buildPrompt(chunk),
    });
    const allowed = new Set(chunk.map((segment) => segment.ordinal));
    corrections.push(...result.object.segments.filter((c) => allowed.has(c.index)));
    usage.tokensIn += result.usage.tokensIn;
    usage.tokensOut += result.usage.tokensOut;
    modelIds.add(result.modelId);
  }

  return {
    segments: applyCorrections(source, segments, corrections),
    usage,
    modelIds: [...modelIds],
  };
}
