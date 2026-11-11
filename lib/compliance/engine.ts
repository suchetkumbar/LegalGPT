import type { ClauseType } from "@/lib/pipeline/clause-types";
import { sentenceAround, typeOf } from "@/lib/rules/helpers";
import type { RiskCategory, RuleClause } from "@/lib/rules/types";

/**
 * Compliance checking. A rule pack is plain data (it serialises to JSON), so
 * packs can be versioned, stored and written by an organisation for its own
 * policies. Each rule yields a verdict of pass, warn or fail, and a pass or a
 * fail that rests on wording cites that wording.
 *
 * This is deterministic: it checks whether required terms are present and
 * prohibited ones absent. It does not weigh how well a clause is drafted.
 */

export type Verdict = "pass" | "warn" | "fail";

export type Check = {
  /** Clause types to look in. Omit to look at the whole contract. */
  clauseTypes?: ClauseType[];
  /** Regular expressions (case-insensitive). Any one matching satisfies the rule. */
  require?: string[];
  /** Regular expressions that must not match. */
  forbid?: string[];
  /** Verdict when a forbidden term is found. Defaults to "fail". */
  ifForbidden?: "fail" | "warn";
  /** Verdict when a required term is not found. Defaults to "fail". */
  ifMissing?: Verdict;
};

export type PackRule = {
  id: string;
  title: string;
  /** The provision relied on, e.g. "DPDP Act 2023, s. 8(6)". */
  reference: string;
  description: string;
  category: RiskCategory;
  check: Check;
  fix: string;
};

export type Applicability = {
  /** Applies to every contract. */
  always?: boolean;
  /** Applies if any of these match the contract text. */
  mentions?: string[];
  /** Applies if the contract has a clause of any of these types. */
  clauseTypes?: ClauseType[];
  /** Applies if the extracted governing law matches any of these. */
  governingLaw?: string[];
  /** Shown to the user to explain why the pack was or was not applied. */
  description: string;
};

export type RulePack = {
  code: string;
  name: string;
  /** Verdicts record this, so an old report can be traced to the rules it used. */
  version: string;
  /** When the pack was last checked against the law. */
  reviewedOn: string;
  applicability: Applicability;
  rules: PackRule[];
};

export type ComplianceContext = {
  clauses: RuleClause[];
  text: string;
  governingLaw: string | null;
};

export type RuleVerdict = {
  packCode: string;
  packVersion: string;
  ruleId: string;
  title: string;
  reference: string;
  category: RiskCategory;
  verdict: Verdict;
  clauseOrdinal: number | null;
  quotedText: string | null;
  explanation: string;
  fix: string | null;
};

const SKIPPED = new Set(["signature_block", "definitions"]);

function compile(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null; // a malformed pattern in a stored pack must not break the review
  }
}

const anyMatch = (sources: string[] | undefined, text: string) =>
  (sources ?? []).some((source) => compile(source)?.test(text));

export function packApplies(pack: RulePack, context: ComplianceContext): boolean {
  const { applicability } = pack;
  if (applicability.always) return true;
  if (anyMatch(applicability.mentions, context.text)) return true;
  if (
    applicability.clauseTypes?.some((type) =>
      context.clauses.some((c) => typeOf(c) === type),
    )
  ) {
    return true;
  }
  return Boolean(
    context.governingLaw && anyMatch(applicability.governingLaw, context.governingLaw),
  );
}

function find(sources: string[] | undefined, clauses: RuleClause[]) {
  for (const source of sources ?? []) {
    const pattern = compile(source);
    if (!pattern) continue;
    for (const clause of clauses) {
      const match = pattern.exec(clause.text);
      if (match) {
        return {
          clauseOrdinal: clause.ordinal,
          quotedText: sentenceAround(clause.text, match.index, match[0].length),
        };
      }
    }
  }
  return null;
}

export function evaluateRule(
  pack: RulePack,
  rule: PackRule,
  context: ComplianceContext,
): RuleVerdict {
  const { check } = rule;
  const usable = context.clauses.filter((clause) => !SKIPPED.has(typeOf(clause) ?? ""));
  const scoped = check.clauseTypes
    ? usable.filter((clause) => check.clauseTypes!.includes(typeOf(clause) as ClauseType))
    : usable;

  const base = {
    packCode: pack.code,
    packVersion: pack.version,
    ruleId: rule.id,
    title: rule.title,
    reference: rule.reference,
    category: rule.category,
  };

  const forbidden = find(check.forbid, scoped);
  if (forbidden) {
    return {
      ...base,
      ...forbidden,
      verdict: check.ifForbidden ?? "fail",
      explanation: rule.description,
      fix: rule.fix,
    };
  }

  if (check.require?.length) {
    const present = find(check.require, scoped);
    if (present) {
      return {
        ...base,
        ...present,
        verdict: "pass",
        explanation: "The contract addresses this in the clause quoted.",
        fix: null,
      };
    }
    const verdict = check.ifMissing ?? "fail";
    return {
      ...base,
      verdict,
      clauseOrdinal: null,
      quotedText: null,
      explanation:
        verdict === "pass"
          ? "The contract does not raise this."
          : `Nothing in the contract addresses this. ${rule.description}`,
      fix: verdict === "pass" ? null : rule.fix,
    };
  }

  return {
    ...base,
    verdict: "pass",
    clauseOrdinal: null,
    quotedText: null,
    explanation: "Nothing in the contract conflicts with this.",
    fix: null,
  };
}

export type PackResult = {
  code: string;
  name: string;
  version: string;
  applies: boolean;
  reason: string;
  verdicts: RuleVerdict[];
};

/** Decides which packs apply and evaluates every rule of those that do. */
export function runCompliance(
  packs: RulePack[],
  context: ComplianceContext,
): PackResult[] {
  return packs.map((pack) => {
    const applies = packApplies(pack, context);
    return {
      code: pack.code,
      name: pack.name,
      version: pack.version,
      applies,
      reason: pack.applicability.description,
      verdicts: applies
        ? pack.rules.map((rule) => evaluateRule(pack, rule, context))
        : [],
    };
  });
}

/** Turns a plain phrase into a pattern that matches it literally, ignoring spacing. */
export function phraseToPattern(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}
