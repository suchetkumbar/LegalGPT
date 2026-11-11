import type { PipelineAi, StructuredRequest } from "@/lib/pipeline/ai";
import type { Correction } from "@/lib/pipeline/classify";
import type { Assessment } from "@/lib/pipeline/assess";
import type { Extraction } from "@/lib/pipeline/extract";

export const EMPTY_EXTRACTION: Extraction = {
  contractType: "other",
  parties: [],
  effectiveDate: null,
  term: null,
  contractValue: null,
  governingLaw: null,
  jurisdiction: null,
};

type Options = {
  /** Decides the answer for one segment. Defaults to type "other", no changes. */
  classify?: (index: number, text: string) => Partial<Correction>;
  extraction?: Extraction;
  /** The judgment pass's answer. Defaults to no changes and no deviations. */
  assessment?: Assessment;
  /** Makes the named call throw, to simulate an exhausted quota. */
  /** What the embedding call reports as its token count. Gemini reports none (NaN). */
  embedTokens?: number;
  failOn?: "pipeline.classify" | "pipeline.extract" | "pipeline.assess" | "embed";
};

/** A stand-in for Gemini: answers from the prompt it is given, with no network. */
export function fakeAi(options: Options = {}) {
  const requests: StructuredRequest<unknown>[] = [];
  const embedded: string[][] = [];

  const ai: PipelineAi = {
    async generateStructured<T>(request: StructuredRequest<T>) {
      requests.push(request as StructuredRequest<unknown>);
      if (options.failOn === request.functionId) throw new Error("quota exhausted");

      let object: unknown;
      if (request.functionId === "pipeline.classify") {
        const segments = [
          ...request.prompt.matchAll(
            /\[segment (\d+)\]\n([\s\S]*?)(?=\n\n\[segment |\n<\/document>)/g,
          ),
        ].map((match): Correction => {
          const index = Number(match[1]);
          return {
            index,
            type: "other",
            heading: null,
            mergeWithPrevious: false,
            splitBefore: [],
            ...options.classify?.(index, match[2]),
          };
        });
        object = { segments };
      } else if (request.functionId === "pipeline.assess") {
        object = options.assessment ?? { summary: "", ruleFindings: [], deviations: [] };
      } else {
        object = options.extraction ?? EMPTY_EXTRACTION;
      }

      return {
        object: request.schema.parse(object),
        modelId: "fake-model",
        usedFallback: false,
        usage: { tokensIn: 100, tokensOut: 10 },
      };
    },

    async embed(texts) {
      embedded.push(texts);
      if (options.failOn === "embed") throw new Error("quota exhausted");
      return {
        embeddings: texts.map((_, row) =>
          Array.from({ length: 768 }, (_, column) => ((row + column) % 7) / 7),
        ),
        usage: { tokensIn: options.embedTokens ?? texts.length * 5, tokensOut: 0 },
      };
    },
  };

  return { ai, requests, embedded };
}
