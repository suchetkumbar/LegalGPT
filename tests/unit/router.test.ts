import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  AllModelsFailedError,
  isFallbackError,
  modelChain,
  runWithFallback,
} from "@/lib/ai/router";

function apiError(statusCode: number | undefined) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    requestBodyValues: {},
    statusCode,
  });
}

const env = {};

// A three-model chain, so the fallback tests do not depend on the defaults.
const chainEnv = {
  MODEL_TIER_REASONING: "primary",
  MODEL_TIER_REASONING_FALLBACK: "secondary",
  MODEL_TIER_STANDARD: "tertiary",
  MODEL_TIER_FAST: "fast",
};

describe("modelChain", () => {
  it("uses the documented defaults", () => {
    // The fallback and the standard tier share a model by default, so it appears once.
    expect(modelChain("reasoning", env)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.6-flash",
    ]);
    expect(modelChain("standard", env)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
    expect(modelChain("fast", env)).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
    ]);
  });

  it("reads each tier from the environment", () => {
    const custom = {
      MODEL_TIER_REASONING: "r",
      MODEL_TIER_REASONING_FALLBACK: "rf",
      MODEL_TIER_STANDARD: "s",
      MODEL_TIER_FAST: "f",
    };
    expect(modelChain("reasoning", custom)).toEqual(["r", "rf", "s"]);
    expect(modelChain("fast", custom)).toEqual(["f", "s"]);
  });

  it("ignores blank values and removes duplicate models", () => {
    expect(
      modelChain("reasoning", {
        MODEL_TIER_REASONING: "  ",
        MODEL_TIER_REASONING_FALLBACK: "gemini-3.6-flash",
      }),
    ).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
  });
});

describe("isFallbackError", () => {
  it.each([500, 502, 503, 529, 403, 404, 408, 429, undefined])(
    "falls back on %s",
    (s) => {
      expect(isFallbackError(apiError(s))).toBe(true);
    },
  );

  it.each([400, 401, 413, 422])("does not fall back on %s", (s) => {
    expect(isFallbackError(apiError(s))).toBe(false);
  });

  it("falls back on timeouts, including wrapped ones", () => {
    expect(isFallbackError(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(
      isFallbackError(new Error("retries exhausted", { cause: apiError(503) })),
    ).toBe(true);
  });

  it("does not fall back on ordinary errors", () => {
    expect(isFallbackError(new Error("schema validation failed"))).toBe(false);
    expect(isFallbackError("nope")).toBe(false);
  });
});

describe("runWithFallback", () => {
  it("returns the primary model's result without a fallback flag", async () => {
    const call = vi.fn(async (modelId: string) => `ok:${modelId}`);
    const routed = await runWithFallback("reasoning", call, { env: chainEnv });

    expect(routed).toMatchObject({
      result: "ok:primary",
      modelId: "primary",
      usedFallback: false,
      failedAttempts: [],
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("moves to the second model when the primary returns a 5xx", async () => {
    const onFallback = vi.fn();
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "primary") throw apiError(503);
      return modelId;
    });

    const routed = await runWithFallback("reasoning", call, {
      env: chainEnv,
      onFallback,
    });

    expect(routed.modelId).toBe("secondary");
    expect(routed.usedFallback).toBe(true);
    expect(routed.failedAttempts.map((a) => a.modelId)).toEqual(["primary"]);
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "primary",
        nextModelId: "secondary",
      }),
    );
  });

  it("walks the whole chain when the first two models are unavailable", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId !== "tertiary") throw apiError(403);
      return modelId;
    });

    const routed = await runWithFallback("reasoning", call, { env: chainEnv });

    expect(routed.modelId).toBe("tertiary");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-fallback error without trying other models", async () => {
    const call = vi.fn(async () => {
      throw apiError(400);
    });

    await expect(
      runWithFallback("reasoning", call, { env: chainEnv }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws AllModelsFailedError once the chain is exhausted", async () => {
    const call = vi.fn(async () => {
      throw apiError(500);
    });

    const error = await runWithFallback("reasoning", call, { env: chainEnv }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AllModelsFailedError);
    expect(error.failedAttempts).toHaveLength(3);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("moves on when the primary model's free quota is used up", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "primary") throw apiError(429);
      return modelId;
    });

    const routed = await runWithFallback("reasoning", call, { env: chainEnv });

    expect(routed.modelId).toBe("secondary");
    expect(routed.usedFallback).toBe(true);
  });

  it("lets the fast and standard tiers back each other up", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "fast") throw apiError(429);
      return modelId;
    });

    const routed = await runWithFallback("fast", call, { env: chainEnv });

    expect(routed).toMatchObject({ modelId: "tertiary", usedFallback: true });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
