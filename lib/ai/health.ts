import { APICallError } from "ai";

import {
  AllModelsFailedError,
  TIERS,
  modelChain,
  type FailedAttempt,
  type ModelTier,
  type RoutedResult,
} from "./router";

export type TierHealth = {
  tier: ModelTier;
  primaryModel: string;
  /** "ok": primary answered. "fallback": a lower model answered. "down": none did. */
  status: "ok" | "fallback" | "down";
  answeredBy: string | null;
  latencyMs: number;
  errors: { modelId: string; statusCode?: number; message: string }[];
};

export type AiHealth = {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  tiers: TierHealth[];
};

type Ping = (tier: ModelTier) => Promise<RoutedResult<unknown>>;

function describe(attempt: FailedAttempt): TierHealth["errors"][number] {
  const { modelId, error } = attempt;
  return {
    modelId,
    statusCode: APICallError.isInstance(error) ? error.statusCode : undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Ping every tier in parallel. `ping` is injected so this is testable without a network. */
export async function checkAiHealth(ping: Ping): Promise<AiHealth> {
  const tiers = await Promise.all(
    TIERS.map(async (tier): Promise<TierHealth> => {
      const primaryModel = modelChain(tier)[0];
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
      try {
        const routed = await ping(tier);
        return {
          tier,
          primaryModel,
          status: routed.usedFallback ? "fallback" : "ok",
          answeredBy: routed.modelId,
          latencyMs: elapsed(),
          errors: routed.failedAttempts.map(describe),
        };
      } catch (error) {
        const attempts =
          error instanceof AllModelsFailedError
            ? error.failedAttempts
            : [{ modelId: primaryModel, error }];
        return {
          tier,
          primaryModel,
          status: "down",
          answeredBy: null,
          latencyMs: elapsed(),
          errors: attempts.map(describe),
        };
      }
    }),
  );

  const status = tiers.some((t) => t.status === "down")
    ? "down"
    : tiers.some((t) => t.status === "fallback")
      ? "degraded"
      : "ok";

  return { status, checkedAt: new Date().toISOString(), tiers };
}
