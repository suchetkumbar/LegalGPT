import type { ClauseType } from "@/lib/pipeline/clause-types";

import { dataRules } from "./detectors/data";
import { disputeRules } from "./detectors/disputes";
import { ipRules } from "./detectors/ip";
import { liabilityRules } from "./detectors/liability";
import { paymentRules } from "./detectors/payment";
import { renewalRules } from "./detectors/renewal";
import { restrictionRules } from "./detectors/restrictions";
import { terminationRules } from "./detectors/termination";
import { typeOf } from "./helpers";
import type { Rule, RuleClause, RuleContext, RuleFinding } from "./types";

export const RULES: Rule[] = [
  ...liabilityRules,
  ...ipRules,
  ...terminationRules,
  ...paymentRules,
  ...dataRules,
  ...renewalRules,
  ...restrictionRules,
  ...disputeRules,
];

/** Parts of a contract that state no obligations and are never scanned. */
const SKIPPED: ReadonlySet<ClauseType> = new Set(["signature_block", "definitions"]);

export function buildContext(input: {
  clauses: RuleClause[];
  text: string;
  contractType?: string | null;
}): RuleContext {
  // Fill in a type for clauses the model has not labelled, from their headings.
  const clauses = input.clauses.map((clause) => ({ ...clause, type: typeOf(clause) }));
  const present = new Set(clauses.map((clause) => clause.type));
  return {
    clauses,
    text: input.text,
    contractType: input.contractType ?? null,
    hasType: (type) => present.has(type),
  };
}

/**
 * Runs every rule over a contract. A clause rule fires at most once per
 * clause; a contract rule at most once.
 */
export function runRules(
  input: { clauses: RuleClause[]; text: string; contractType?: string | null },
  rules: Rule[] = RULES,
): RuleFinding[] {
  const context = buildContext(input);
  const findings: RuleFinding[] = [];

  for (const rule of rules) {
    const base = {
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      likelihood: rule.likelihood,
      suggestedFix: rule.suggestion,
    };

    if (rule.kind === "contract") {
      // A statement of work incorporates its master agreement, so a clause
      // "missing" from the SOW is usually there.
      if (context.contractType === "statement_of_work") continue;
      const result = rule.detect(context);
      if (!result) continue;
      findings.push({
        ...base,
        clauseType: rule.clauseType,
        clauseOrdinal: null,
        quotedText: null,
        reasoning:
          typeof result === "string" ? `${result} ${rule.explanation}` : rule.explanation,
      });
      continue;
    }

    for (const clause of context.clauses) {
      if (clause.type && SKIPPED.has(clause.type)) continue;
      // An untyped clause is scanned by every rule: better a stray hit than a miss.
      if (rule.types && clause.type && !rule.types.includes(clause.type)) continue;
      const hit = rule.detect(clause, context);
      if (!hit) continue;
      findings.push({
        ...base,
        clauseType: clause.type,
        clauseOrdinal: clause.ordinal,
        quotedText: hit.quote,
        reasoning: hit.detail ? `${hit.detail} ${rule.explanation}` : rule.explanation,
      });
    }
  }

  return findings;
}

export { RISK_CATEGORIES, CATEGORY_LABELS } from "./types";
export type { RiskCategory, Rule, RuleClause, RuleFinding } from "./types";
