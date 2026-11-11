import { APICallError } from "ai";

/**
 * Model router. Every model call in the app goes through `runWithFallback`,
 * so changing a task's model is an environment change and the reasoning
 * fallback chain applies everywhere.
 *
 * The defaults are Gemini models that Google offers on its free tier. Free
 * quotas are counted per model, so each tier uses a different model.
 *
 * This module has no provider import, which keeps it unit-testable. The
 * provider binding lives in ./provider.ts.
 */

export const TIERS = ["reasoning", "standard", "fast"] as const;
export type ModelTier = (typeof TIERS)[number];

const DEFAULTS = {
  reasoning: "gemini-3.8-flash",
  reasoningFallback: "gemini-3.6-flash",
  standard: "gemini-3.6-flash",
  fast: "gemini-3.5-flash-lite",
} as const;

type Env = Record<string, string | undefined>;

function read(env: Env, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

/**
 * Ordered model ids to try for a tier. The first entry is the primary model.
 *
 * The standard and fast tiers back each other up. On the free tier each model
 * has its own daily quota, so when one runs out the other usually still has
 * room, and a finished analysis on the neighbouring model beats a failed one.
 */
export function modelChain(tier: ModelTier, env: Env = process.env): string[] {
  const standard = read(env, "MODEL_TIER_STANDARD", DEFAULTS.standard);
  const fast = read(env, "MODEL_TIER_FAST", DEFAULTS.fast);
  switch (tier) {
    case "reasoning": {
      const chain = [
        read(env, "MODEL_TIER_REASONING", DEFAULTS.reasoning),
        read(env, "MODEL_TIER_REASONING_FALLBACK", DEFAULTS.reasoningFallback),
        standard,
      ];
      return [...new Set(chain)];
    }
    case "standard":
      return [...new Set([standard, fast])];
    case "fast":
      return [...new Set([fast, standard])];
  }
}

/**
 * Whether an error should move the call on to the next model in the chain:
 * a 5xx, a timeout, the model being unavailable to this account (403/404),
 * or its quota being used up (429, which is routine on the free tier and is
 * counted per model). Everything else, such as a 400 for a bad request or a
 * 401 for a bad key, would fail identically on any model, so it is rethrown.
 */
export function isFallbackError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === undefined) return true; // network failure before any response
    return (
      status >= 500 ||
      status === 403 ||
      status === 404 ||
      status === 408 ||
      status === 429
    );
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return true;
    if (error.cause !== undefined && error.cause !== error) {
      return isFallbackError(error.cause);
    }
  }
  return false;
}

export type FailedAttempt = { modelId: string; error: unknown };

export type RoutedResult<T> = {
  result: T;
  /** The model that produced the result. Stored on every finding. */
  modelId: string;
  tier: ModelTier;
  /** True when a model other than the tier's primary answered (UI shows a badge). */
  usedFallback: boolean;
  failedAttempts: FailedAttempt[];
};

export class AllModelsFailedError extends Error {
  constructor(
    readonly tier: ModelTier,
    readonly failedAttempts: FailedAttempt[],
  ) {
    super(
      `All models failed for tier "${tier}": ${failedAttempts.map((a) => a.modelId).join(", ")}`,
      { cause: failedAttempts.at(-1)?.error },
    );
    this.name = "AllModelsFailedError";
  }
}

export type RouteOptions = {
  env?: Env;
  onFallback?: (attempt: FailedAttempt & { nextModelId: string }) => void;
};

/**
 * Run `call` against the tier's primary model, moving down the chain on
 * fallback-eligible errors. `call` receives the model id and performs the
 * actual request.
 */
export async function runWithFallback<T>(
  tier: ModelTier,
  call: (modelId: string) => Promise<T>,
  options: RouteOptions = {},
): Promise<RoutedResult<T>> {
  const chain = modelChain(tier, options.env);
  const failedAttempts: FailedAttempt[] = [];

  for (const [index, modelId] of chain.entries()) {
    try {
      const result = await call(modelId);
      return { result, modelId, tier, usedFallback: index > 0, failedAttempts };
    } catch (error) {
      if (!isFallbackError(error)) throw error;
      failedAttempts.push({ modelId, error });
      const nextModelId = chain[index + 1];
      if (nextModelId) options.onFallback?.({ modelId, error, nextModelId });
    }
  }

  throw new AllModelsFailedError(tier, failedAttempts);
}
