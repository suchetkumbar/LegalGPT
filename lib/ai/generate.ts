import "server-only";

import { google } from "@ai-sdk/google";
import { Output, embedMany, generateText } from "ai";

import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";
import type { PipelineAi } from "@/lib/pipeline/ai";

import { routeModel } from "./provider";

const EMBEDDING_MODEL = () =>
  process.env.MODEL_EMBEDDING?.trim() || "gemini-embedding-001";

/** The embedding API takes a limited number of texts per request. */
const EMBED_BATCH = 100;

/** Retries inside one model call, before the router moves to the next model. */
const maxRetries = () => {
  const value = Number(process.env.AI_MAX_RETRIES);
  return Number.isInteger(value) && value >= 0 ? value : 2;
};

/**
 * Contract text is confidential, so traces carry the model, token counts and
 * timing for each call, but never the prompt or the response.
 */
const privateTelemetry = (functionId: string) => ({
  functionId,
  recordInputs: false,
  recordOutputs: false,
});

/** The pipeline's model operations, bound to Gemini through the router. */
export const pipelineAi: PipelineAi = {
  async generateStructured(request) {
    const routed = await routeModel(request.tier, (model) =>
      generateText({
        model,
        instructions: request.system,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        // Extraction and labelling need little deliberation; keeping thinking
        // low makes these calls several times faster.
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel: request.thinking ?? "low" } },
        },
        maxRetries: maxRetries(),
        timeout: request.timeoutMs ?? 120_000,
        telemetry: privateTelemetry(request.functionId),
      }),
    );
    return {
      object: routed.result.output,
      modelId: routed.modelId,
      usedFallback: routed.usedFallback,
      usage: {
        tokensIn: routed.result.usage.inputTokens ?? 0,
        tokensOut: routed.result.usage.outputTokens ?? 0,
      },
    };
  },

  async embed(texts) {
    const embeddings: number[][] = [];
    let tokensIn = 0;
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const result = await embedMany({
        model: google.embedding(EMBEDDING_MODEL()),
        values: texts.slice(i, i + EMBED_BATCH),
        providerOptions: {
          google: {
            outputDimensionality: EMBEDDING_DIMENSIONS,
            taskType: "RETRIEVAL_DOCUMENT",
          },
        },
        maxRetries: maxRetries(),
        telemetry: privateTelemetry("pipeline.embed"),
      });
      embeddings.push(...result.embeddings);
      // Gemini does not report a token count for embeddings.
      const tokens = result.usage.tokens;
      if (Number.isFinite(tokens)) tokensIn += tokens;
    }
    return { embeddings, usage: { tokensIn, tokensOut: 0 } };
  },
};
