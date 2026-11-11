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
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
  });
}

const env = {};

describe("modelChain", () => {
  it("uses the documented defaults", () => {
    expect(modelChain("reasoning", env)).toEqual([
      "claude-fable-5-2",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(modelChain("standard", env)).toEqual(["claude-sonnet-5-5"]);
    expect(modelChain("fast", env)).toEqual(["claude-haiku-5-5"]);
  });

  it("reads each tier from the environment", () => {
    const custom = {
      MODEL_TIER_REASONING: "r",
      MODEL_TIER_REASONING_FALLBACK: "rf",
      MODEL_TIER_STANDARD: "s",
      MODEL_TIER_FAST: "f",
    };
    expect(modelChain("reasoning", custom)).toEqual(["r", "rf", "s"]);
    expect(modelChain("fast", custom)).toEqual(["f"]);
  });

  it("ignores blank values and removes duplicate models", () => {
    expect(
      modelChain("reasoning", {
        MODEL_TIER_REASONING: "  ",
        MODEL_TIER_REASONING_FALLBACK: "claude-sonnet-5-5",
      }),
    ).toEqual(["claude-fable-5-2", "claude-sonnet-5-5"]);
  });
});

describe("isFallbackError", () => {
  it.each([500, 502, 503, 529, 403, 404, 408, undefined])("falls back on %s", (s) => {
    expect(isFallbackError(apiError(s))).toBe(true);
  });

  it.each([400, 401, 413, 422, 429])("does not fall back on %s", (s) => {
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
    const routed = await runWithFallback("reasoning", call, { env });

    expect(routed).toMatchObject({
      result: "ok:claude-fable-5-2",
      modelId: "claude-fable-5-2",
      usedFallback: false,
      failedAttempts: [],
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("moves to Opus when Fable returns a 5xx", async () => {
    const onFallback = vi.fn();
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "claude-fable-5-2") throw apiError(503);
      return modelId;
    });

    const routed = await runWithFallback("reasoning", call, { env, onFallback });

    expect(routed.modelId).toBe("claude-opus-5-5");
    expect(routed.usedFallback).toBe(true);
    expect(routed.failedAttempts.map((a) => a.modelId)).toEqual(["claude-fable-5-2"]);
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "claude-fable-5-2",
        nextModelId: "claude-opus-5-5",
      }),
    );
  });

  it("walks the whole chain when access to both top models is unavailable", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId !== "claude-sonnet-5-5") throw apiError(403);
      return modelId;
    });

    const routed = await runWithFallback("reasoning", call, { env });

    expect(routed.modelId).toBe("claude-sonnet-5-5");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-fallback error without trying other models", async () => {
    const call = vi.fn(async () => {
      throw apiError(400);
    });

    await expect(runWithFallback("reasoning", call, { env })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws AllModelsFailedError once the chain is exhausted", async () => {
    const call = vi.fn(async () => {
      throw apiError(500);
    });

    const error = await runWithFallback("reasoning", call, { env }).catch((e) => e);

    expect(error).toBeInstanceOf(AllModelsFailedError);
    expect(error.failedAttempts).toHaveLength(3);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("has no fallback for the fast tier", async () => {
    const call = vi.fn(async () => {
      throw apiError(500);
    });

    await expect(runWithFallback("fast", call, { env })).rejects.toBeInstanceOf(
      AllModelsFailedError,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});
