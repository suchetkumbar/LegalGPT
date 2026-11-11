import type { ClauseType } from "@/lib/pipeline/clause-types";

/**
 * The rule engine: deterministic detectors for known risk patterns. They are
 * free, instant and repeatable, and every hit quotes the words that triggered
 * it. Models are kept for judgment; rules do the pattern-spotting.
 */

/**
 * Risk categories for the score breakdown. The plan's six, plus two that
 * matter under Indian law and fit none of them: restrictions (non-compete and
 * exclusivity, which section 27 of the Indian Contract Act treats specially)
 * and disputes (governing law, seat and arbitrator appointment).
 */
export const RISK_CATEGORIES = [
  "liability",
  "ip",
  "termination",
  "payment",
  "data",
  "renewal",
  "restrictions",
  "disputes",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RiskCategory, string> = {
  liability: "Liability",
  ip: "Intellectual property",
  termination: "Termination",
  payment: "Payment",
  data: "Data protection",
  renewal: "Term and renewal",
  restrictions: "Restrictions",
  disputes: "Disputes",
};

export type RuleClause = {
  ordinal: number;
  type: ClauseType | null;
  heading: string | null;
  text: string;
};

export type RuleContext = {
  clauses: RuleClause[];
  /** The whole contract, for "is this mentioned anywhere" checks. */
  text: string;
  contractType: string | null;
  /** Whether any clause has this type (after heading-based guessing). */
  hasType(type: ClauseType): boolean;
};

type Meta = {
  /** Stable id, stored on the finding. Never reuse one for a different rule. */
  id: string;
  title: string;
  category: RiskCategory;
  /** Default severity and likelihood, 1-5. The model pass may revise them. */
  severity: 1 | 2 | 3 | 4 | 5;
  likelihood: 1 | 2 | 3 | 4 | 5;
  /** Why this matters, in plain words, with the Indian law point where there is one. */
  explanation: string;
  suggestion: string;
};

/** A rule that looks inside one clause and quotes what it found. */
export type ClauseRule = Meta & {
  kind: "clause";
  /** Clause types to look in. Omit to look in every clause. */
  types?: ClauseType[];
  /** Returns the verbatim quote that triggered the rule, or null. */
  detect(
    clause: RuleClause,
    context: RuleContext,
  ): { quote: string; detail?: string } | null;
  /** Clause texts that must and must not trigger the rule. Checked by the tests. */
  examples: { hit: string[]; miss: string[] };
};

/** A rule about the contract as a whole, usually that something is missing. */
export type ContractRule = Meta & {
  kind: "contract";
  /** The clause type the finding is weighted as. */
  clauseType: ClauseType;
  /** Returns true (or a detail string) when the problem is present. */
  detect(context: RuleContext): boolean | string;
};

export type Rule = ClauseRule | ContractRule;

export type RuleFinding = {
  ruleId: string;
  title: string;
  category: RiskCategory;
  severity: number;
  likelihood: number;
  /** Used for the score weight. */
  clauseType: ClauseType | null;
  /** The clause the quote is in. Null for a contract-level finding. */
  clauseOrdinal: number | null;
  /** Verbatim from the clause. Null only when the finding is that something is absent. */
  quotedText: string | null;
  reasoning: string;
  suggestedFix: string;
};
