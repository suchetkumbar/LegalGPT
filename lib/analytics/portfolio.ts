import { and, desc, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

const { contracts, findings, entities, obligations } = schema;

/** Portfolio aggregates for the dashboard. Row-level security scopes every query to one org. */

export async function riskDistribution(tx: OrgTx) {
  const rows = await tx
    .select({ score: contracts.riskScore })
    .from(contracts)
    .where(and(eq(contracts.status, "ready"), isNotNull(contracts.riskScore)));
  const bands = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const { score } of rows) {
    const s = score ?? 0;
    if (s >= 80) bands.critical += 1;
    else if (s >= 60) bands.high += 1;
    else if (s >= 30) bands.medium += 1;
    else bands.low += 1;
  }
  return { bands, scored: rows.length };
}

/** The issues that come up in the most contracts, ignoring dismissed findings. */
export function topRecurringFindings(tx: OrgTx, limit = 10) {
  return tx
    .select({
      title: findings.title,
      kind: findings.kind,
      contracts: sql<number>`count(distinct ${findings.contractId})::int`,
      maxSeverity: sql<number>`max(${findings.severity})::int`,
    })
    .from(findings)
    .where(ne(findings.status, "dismissed"))
    .groupBy(findings.title, findings.kind)
    .orderBy(
      desc(sql`count(distinct ${findings.contractId})`),
      desc(sql`max(${findings.severity})`),
    )
    .limit(limit);
}

/** Value and risk per counterparty, from the extracted contract values. */
export async function exposureByCounterparty(tx: OrgTx, limit = 10) {
  const rows = await tx
    .select({
      counterparty: contracts.counterparty,
      contracts: sql<number>`count(distinct ${contracts.id})::int`,
      averageRisk: sql<number>`round(avg(${contracts.riskScore}))::int`,
      maxRisk: sql<number>`max(${contracts.riskScore})::int`,
      value: sql<number>`coalesce(sum((${entities.normalized}->>'amount')::numeric) filter (where ${entities.normalized}->>'currency' = 'INR'), 0)::float8`,
    })
    .from(contracts)
    .leftJoin(
      entities,
      and(eq(entities.contractId, contracts.id), eq(entities.kind, "amount")),
    )
    .where(eq(contracts.status, "ready"))
    .groupBy(contracts.counterparty)
    .orderBy(desc(sql`max(${contracts.riskScore})`))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    counterparty: row.counterparty ?? "Counterparty not identified",
  }));
}

/** Expiries and non-renewal deadlines in the next 90 days. */
export function upcomingRenewals(
  tx: OrgTx,
  today = new Date().toISOString().slice(0, 10),
  days = 90,
) {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return tx
    .select({
      id: obligations.id,
      contractId: obligations.contractId,
      title: contracts.title,
      kind: obligations.kind,
      dueDate: obligations.dueDate,
      description: obligations.description,
    })
    .from(obligations)
    .innerJoin(contracts, eq(contracts.id, obligations.contractId))
    .where(
      and(
        sql`${obligations.kind} in ('expiry', 'renewal_notice')`,
        gte(obligations.dueDate, today),
        lte(obligations.dueDate, end.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(obligations.dueDate);
}

export function workflowCounts(tx: OrgTx) {
  return tx
    .select({ status: contracts.workflowStatus, count: sql<number>`count(*)::int` })
    .from(contracts)
    .groupBy(contracts.workflowStatus);
}
