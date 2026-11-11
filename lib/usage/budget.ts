import { and, eq, gte, sql } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";
import type { TokenUsage } from "@/lib/pipeline/ai";

const { jobs, usageEvents, orgs } = schema;

/**
 * Per-organisation token metering and a monthly budget. Analyses are counted
 * from the jobs table; everything else (questions, drafting, negotiation) from
 * usage_events. Kept in Postgres rather than Redis: one less service, and the
 * numbers are needed for the usage page anyway.
 */

export class BudgetExceededError extends Error {
  constructor() {
    super("The organisation's monthly AI budget is used up.");
    this.name = "BudgetExceededError";
  }
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type MonthUsage = {
  analysis: number;
  other: Record<string, number>;
  total: number;
  budget: number | null;
  remaining: number | null;
};

export async function monthUsage(tx: OrgTx, now = new Date()): Promise<MonthUsage> {
  const since = monthStart(now);
  const [analysis] = await tx
    .select({
      tokens: sql<number>`coalesce(sum(${jobs.tokensIn} + ${jobs.tokensOut}), 0)::int`,
    })
    .from(jobs)
    .where(gte(jobs.createdAt, since));
  const events = await tx
    .select({
      kind: usageEvents.kind,
      tokens: sql<number>`coalesce(sum(${usageEvents.tokensIn} + ${usageEvents.tokensOut}), 0)::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.at, since))
    .groupBy(usageEvents.kind);
  const [org] = await tx.select({ budget: orgs.monthlyTokenBudget }).from(orgs);

  const other = Object.fromEntries(events.map((e) => [e.kind, Number(e.tokens)]));
  const total =
    Number(analysis?.tokens ?? 0) + Object.values(other).reduce((a, b) => a + b, 0);
  const budget = org?.budget ?? null;
  return {
    analysis: Number(analysis?.tokens ?? 0),
    other,
    total,
    budget,
    remaining: budget === null ? null : Math.max(0, budget - total),
  };
}

/** Throws BudgetExceededError if this month's budget is already spent. */
export async function assertWithinBudget(tx: OrgTx): Promise<void> {
  const usage = await monthUsage(tx);
  if (usage.budget !== null && usage.total >= usage.budget)
    throw new BudgetExceededError();
}

export async function recordUsage(
  tx: OrgTx,
  input: { orgId: string; userId: string | null; kind: string; usage: TokenUsage },
): Promise<void> {
  const clean = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
  await tx.insert(usageEvents).values({
    orgId: input.orgId,
    userId: input.userId,
    kind: input.kind,
    tokensIn: clean(input.usage.tokensIn),
    tokensOut: clean(input.usage.tokensOut),
  });
}

export async function setBudget(
  tx: OrgTx,
  input: { orgId: string; budget: number | null; actorId: string },
) {
  await tx
    .update(orgs)
    .set({ monthlyTokenBudget: input.budget, updatedAt: new Date() })
    .where(eq(orgs.id, input.orgId));
  await tx.insert(schema.auditLog).values({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "usage.budget_set",
    target: `org:${input.orgId}`,
    diff: { budget: input.budget },
  });
}

export { and };
