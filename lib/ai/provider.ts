import "server-only";

import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

import {
  runWithFallback,
  type ModelTier,
  type RouteOptions,
  type RoutedResult,
} from "./router";

/** Run an AI SDK call on a tier, with the fallback chain applied. */
export function routeModel<T>(
  tier: ModelTier,
  call: (model: LanguageModel, modelId: string) => Promise<T>,
  options: RouteOptions = {},
): Promise<RoutedResult<T>> {
  return runWithFallback(tier, (modelId) => call(anthropic(modelId), modelId), {
    onFallback: ({ modelId, nextModelId, error }) => {
      console.warn(
        `[ai/router] ${modelId} unavailable, falling back to ${nextModelId}:`,
        error instanceof Error ? error.message : error,
      );
    },
    ...options,
  });
}
