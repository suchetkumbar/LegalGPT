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
    routeModel(tier, (model) =>
      generateText({
        model,
        prompt: "Reply with the single word: ok",
        maxOutputTokens: 16,
        maxRetries: 0,
        timeout: 20_000,
        telemetry: { functionId: "health.ai" },
      }),
    ),
  );

  return Response.json(health, {
    status: health.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
