import type { ClauseType } from "@/lib/pipeline/clause-types";
import { RISK_CATEGORIES, type RiskCategory } from "@/lib/rules/types";

/**
 * The contract risk score, as defined in the project plan:
 *
 *   R = min(100, max(F, 100 · Σ sᵢ·lᵢ·w(cᵢ) / (25 · Σ w)))
 *
 * s is severity and l is likelihood (1-5 each), w is the weight of the
 * finding's clause type, and the denominator sums the weights of every clause
 * type in the playbook. F is 70 when any single finding is critical
 * (severity 5 and likelihood 4 or more), otherwise 0.
 *
 * Dismissed findings do not count: a reviewer has judged them not to be a risk.
 */

/**
 * Default weights for the 20 clause types a playbook covers. An organisation's
 * own playbook replaces these once it has one.
 */
export const DEFAULT_WEIGHTS: Partial<Record<ClauseType, number>> = {
  limitation_of_liability: 2,
  indemnity: 2,
  intellectual_property: 1.5,
  data_protection: 1.5,
  termination: 1.5,
  payment: 1.5,
  term_and_renewal: 1.2,
  non_compete: 1.2,
  confidentiality: 1,
  warranties_and_representations: 1,
  governing_law_and_jurisdiction: 1,
  dispute_resolution: 1,
  taxes: 1,
  non_solicitation: 0.8,
  assignment_and_subcontracting: 0.8,
  force_majeure: 0.6,
  insurance: 0.6,
  audit_and_records: 0.6,
  notices: 0.4,
  general_provisions: 0.4,
};

/** Weight for a clause type the playbook does not list. */
const UNLISTED_WEIGHT = 1;

/** Which clause types make up each category, for the per-category breakdown. */
const CATEGORY_TYPES: Record<RiskCategory, ClauseType[]> = {
  liability: ["limitation_of_liability", "indemnity", "warranties_and_representations"],
  ip: ["intellectual_property", "confidentiality"],
  termination: ["termination"],
  payment: ["payment", "taxes"],
  data: ["data_protection"],
  renewal: ["term_and_renewal"],
  restrictions: ["non_compete", "non_solicitation", "assignment_and_subcontracting"],
  disputes: ["governing_law_and_jurisdiction", "dispute_resolution"],
};

export const CRITICAL_FLOOR = 70;

export type RiskBand = "low" | "medium" | "high" | "critical";

export type ScorableFinding = {
  severity: number;
  likelihood: number;
  clauseType: string | null;
  category: string;
  status: "open" | "accepted" | "dismissed";
};

export type RiskScore = {
  score: number;
  band: RiskBand;
  /** True when a critical finding lifted the score to the floor. */
  floorApplied: boolean;
  /** 0-100 per category, on the same scale as the overall score. */
  byCategory: Record<RiskCategory, number>;
  /** Findings that counted towards the score. */
  counted: number;
};

export function bandFor(score: number): RiskBand {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function isCritical(finding: { severity: number; likelihood: number }): boolean {
  return finding.severity === 5 && finding.likelihood >= 4;
}

export function computeRiskScore(
  findings: ScorableFinding[],
  weights: Partial<Record<string, number>> = DEFAULT_WEIGHTS,
): RiskScore {
  const live = findings.filter((finding) => finding.status !== "dismissed");
  const weightOf = (type: string | null) =>
    (type ? weights[type] : undefined) ?? UNLISTED_WEIGHT;
  const points = (finding: ScorableFinding) =>
    finding.severity * finding.likelihood * weightOf(finding.clauseType);

  const totalWeight = Object.values(weights).reduce<number>(
    (sum, w) => sum + (w ?? 0),
    0,
  );
  const raw = totalWeight
    ? (100 * live.reduce((sum, finding) => sum + points(finding), 0)) / (25 * totalWeight)
    : 0;
  const floor = live.some(isCritical) ? CRITICAL_FLOOR : 0;
  const score = Math.round(Math.min(100, Math.max(floor, raw)));

  const byCategory = Object.fromEntries(
    RISK_CATEGORIES.map((category) => {
      const categoryWeight = CATEGORY_TYPES[category].reduce(
        (sum, type) => sum + weightOf(type),
        0,
      );
      const sum = live
        .filter((finding) => finding.category === category)
        .reduce((total, finding) => total + points(finding), 0);
      return [category, Math.round(Math.min(100, (100 * sum) / (25 * categoryWeight)))];
    }),
  ) as Record<RiskCategory, number>;

  return {
    score,
    band: bandFor(score),
    floorApplied: floor > 0 && raw < floor,
    byCategory,
    counted: live.length,
  };
}
