import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Fixed-window rate limiting in Postgres, so limits hold across serverless
 * instances without another service. One row per key and window; a single
 * upsert increments it and returns the new count.
 */

export type RateLimit = { limit: number; windowSeconds: number };

/** Per-user limits for the costly endpoints. Generous for people, tight for scripts. */
export const LIMITS = {
  upload: { limit: 30, windowSeconds: 600 },
  bulk: { limit: 3, windowSeconds: 3600 },
  ai: { limit: 30, windowSeconds: 600 },
  comment: { limit: 60, windowSeconds: 600 },
} satisfies Record<string, RateLimit>;

export type RateResult = { ok: true } | { ok: false; retryAfter: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, any>;

export async function hit(
  db: AnyDb,
  key: string,
  rule: RateLimit,
  now = new Date(),
): Promise<RateResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start = excluded.window_start
                   then rate_limits.count + 1 else 1 end,
      window_start = excluded.window_start
    returning count`);
  const rows =
    (result as unknown as { rows?: { count: number }[] }).rows ??
    (result as unknown as { count: number }[]);
  const count = Number(rows[0]?.count ?? 1);
  if (count <= rule.limit) return { ok: true };
  return {
    ok: false,
    retryAfter: Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  };
}

export function tooManyRequests(retryAfter: number): Response {
  return Response.json(
    {
      error: `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? "s" : ""}.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
