import { eq } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

import { computeRiskScore, type RiskScore } from "./score";

const { contracts, findings } = schema;

/**
 * Recomputes a contract's risk score from its current findings and stores it.
 * Called after the findings change: at the end of analysis, and whenever a
 * reviewer accepts, dismisses or reopens one.
 */
export async function rescoreContract(tx: OrgTx, contractId: string): Promise<RiskScore> {
  const rows = await tx
    .select({
      severity: findings.severity,
      likelihood: findings.likelihood,
      clauseType: findings.clauseType,
      category: findings.category,
      status: findings.status,
    })
    .from(findings)
    .where(eq(findings.contractId, contractId));

  const result = computeRiskScore(rows);
  await tx
    .update(contracts)
    .set({ riskScore: result.score, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));
  return result;
}
