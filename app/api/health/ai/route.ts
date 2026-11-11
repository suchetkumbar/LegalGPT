import { timingSafeEqual } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { generateText } from "ai";

import { checkAiHealth } from "@/lib/ai/health";
import { routeModel } from "@/lib/ai/provider";

export const maxDuration = 60;

function hasValidSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Pings all three model tiers. Each check spends a few tokens, so the route
 * needs either a signed-in user or `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!hasValidSecret(request)) {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const health = await checkAiHealth((tier) =>
    routeModel(tier, async (model, modelId) => {
      const result = await generateText({
        model,
        prompt: "Reply with the single word: ok",
        // Thinking models spend output tokens on reasoning before they write
        // anything, so a tight cap returns an empty answer.
        maxOutputTokens: 512,
        maxRetries: 0,
        timeout: 45_000,
        telemetry: { functionId: "health.ai" },
      });
      // A 200 with no text is not a working model.
      if (!result.text.trim()) {
        throw new Error(`${modelId} returned no text (finish: ${result.finishReason})`);
      }
      return result;
    }),
  );

  return Response.json(health, {
    status: health.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
