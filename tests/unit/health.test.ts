import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { checkAiHealth } from "@/lib/ai/health";
import { AllModelsFailedError, modelChain, type RoutedResult } from "@/lib/ai/router";

const unavailable = new APICallError({
  message: "model unavailable",
  url: "https://api.anthropic.com/v1/messages",
  requestBodyValues: {},
  statusCode: 403,
});

function answered(tier: RoutedResult<unknown>["tier"], index = 0): RoutedResult<unknown> {
  const chain = modelChain(tier);
  return {
    result: "ok",
    tier,
    modelId: chain[index],
    usedFallback: index > 0,
    failedAttempts: chain.slice(0, index).map((modelId) => ({
      modelId,
      error: unavailable,
    })),
  };
}

describe("checkAiHealth", () => {
  it("is ok when every tier's primary model answers", async () => {
    const health = await checkAiHealth(async (tier) => answered(tier));

    expect(health.status).toBe("ok");
    expect(health.tiers.map((t) => t.tier)).toEqual(["reasoning", "standard", "fast"]);
    expect(health.tiers.every((t) => t.status === "ok" && t.errors.length === 0)).toBe(
      true,
    );
  });

  it("is degraded when the reasoning tier answers from a fallback model", async () => {
    const health = await checkAiHealth(async (tier) =>
      answered(tier, tier === "reasoning" ? 1 : 0),
    );
    const reasoning = health.tiers[0];

    expect(health.status).toBe("degraded");
    expect(reasoning.status).toBe("fallback");
    expect(reasoning.answeredBy).toBe(modelChain("reasoning")[1]);
    expect(reasoning.errors).toEqual([
      {
        modelId: modelChain("reasoning")[0],
        statusCode: 403,
        message: "model unavailable",
      },
    ]);
  });

  it("is down when a tier has no working model, and still reports the others", async () => {
    const health = await checkAiHealth(async (tier) => {
      if (tier === "fast") {
        throw new AllModelsFailedError("fast", [
          { modelId: modelChain("fast")[0], error: unavailable },
        ]);
      }
      return answered(tier);
    });

    expect(health.status).toBe("down");
    expect(health.tiers[2]).toMatchObject({ status: "down", answeredBy: null });
    expect(health.tiers[0].status).toBe("ok");
  });

  it("reports a non-fallback error such as a bad API key as down", async () => {
    const health = await checkAiHealth(async () => {
      throw new Error("invalid x-api-key");
    });

    expect(health.status).toBe("down");
    expect(health.tiers[0].errors[0].message).toBe("invalid x-api-key");
  });
});
