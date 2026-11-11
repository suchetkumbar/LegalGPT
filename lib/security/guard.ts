import "server-only";

import { adminDb } from "@/lib/db";

import { LIMITS, hit, tooManyRequests } from "./rate-limit";

/**
 * Applies a per-user rate limit. Returns a 429 response to send, or null to carry on.
 * If the limiter itself fails, the request is allowed: a database hiccup must
 * not lock everyone out.
 */
export async function limitRequest(
  kind: keyof typeof LIMITS,
  userId: string,
): Promise<Response | null> {
  try {
    const result = await hit(adminDb(), `${kind}:${userId}`, LIMITS[kind]);
    return result.ok ? null : tooManyRequests(result.retryAfter);
  } catch (error) {
    console.error(
      "[rate-limit] check failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
