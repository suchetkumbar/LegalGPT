import { z } from "zod";

import type { RiskCategory } from "@/lib/rules/types";

import { DOCUMENT_IS_DATA, escapeDocument, type PipelineAi, type TokenUsage } from "./ai";
import { clauseTypeLabel } from "./clause-types";
import { findQuote } from "./quotes";

/**
 * The judgment pass, on the reasoning tier. One call per contract does three
 * jobs that the plan lists separately, because on a free quota every call
 * counts:
 *
 * 1. re-scores each rule finding in the context of the whole contract,
 * 2. compares each clause with the organisation's playbook and reports
 *    material deviations, and
 * 3. writes the executive summary.
 *
 * Nothing the model says is stored unless it can be tied to the text: a
 * deviation must quote its clause verbatim, and the server checks the quote.
 */

export type AssessClause = {
  ordinal: number;
  number: string | null;
  heading: string | null;
  type: string | null;
  text: string;
};

export type AssessPosition = {
  clauseType: string;
  standardText: string;
  fallbackText: string | null;
  walkaway: string | null;
};

export type AssessRuleFinding = {
  /** Position in the list sent to the model. */
  index: number;
  title: string;
  severity: number;
  likelihood: number;
  quotedText: string | null;
};

const score = z.number().int().min(1).max(5);

const assessmentSchema = z.object({
  summary: z
    .string()
    .describe(
      "Executive summary for a business reader, 3 to 5 sentences: what the contract is, who it favours, and the two or three issues that matter most. Plain words, no legal jargon, no advice to sign or not sign.",
    ),
  ruleFindings: z
    .array(
      z.object({
        index: z.number().int(),
        severity: score.describe("1 trivial, 3 moderate, 5 could threaten the business"),
        likelihood: score.describe(
          "How likely the risk is to materialise, 1 remote to 5 expected",
        ),
        doesNotApply: z
          .boolean()
          .describe(
            "True only if, read in context, the flagged text plainly does not have the problem described",
          ),
        note: z
          .string()
          .nullable()
          .describe(
            "One sentence on how other clauses change the picture, e.g. a cap elsewhere that limits this. Null if nothing to add.",
          ),
      }),
    )
    .describe("One entry for every rule finding listed, by its index"),
  deviations: z
    .array(
      z.object({
        clauseIndex: z.number().int(),
        title: z.string().describe("5 to 10 words naming the deviation"),
        quote: z
          .string()
          .describe(
            "The exact words of the clause that deviate, copied verbatim (8 to 50 words)",
          ),
        deviation: z
          .string()
          .describe(
            "How the clause differs from the playbook position and why that matters",
          ),
        beyondWalkaway: z
          .boolean()
          .describe("True if it crosses the playbook's walk-away point"),
        severity: score,
        likelihood: score,
        suggestedText: z
          .string()
          .describe("Replacement wording for the clause, based on the playbook standard"),
      }),
    )
    .describe(
      "Only material deviations from the playbook: a real shift in risk, not a difference in wording. Do not repeat a problem already in the rule findings. Often empty.",
    ),
});

export type Assessment = z.infer<typeof assessmentSchema>;

const MAX_CLAUSE_CHARS = 3_000;
const MAX_TOTAL_CHARS = 120_000;

const SYSTEM = [
  "You are the second reviewer on a contract review tool used by Indian businesses. A rule engine has already flagged known risk patterns. You add judgment.",
  DOCUMENT_IS_DATA,
  "",
  "You are given the contract's clauses, the organisation's playbook (its preferred position, fallback and walk-away point per clause type), and the rule findings.",
  "",
  "Task 1, rule findings: for each, set severity and likelihood for this particular contract, reading the clause against the rest of the document. An uncapped indemnity matters less if a liability cap elsewhere expressly covers it; a short notice period matters more if the service is critical. Mark doesNotApply only when the flag is plainly wrong.",
  "Task 2, playbook deviations: compare each clause with the playbook position for its type. Report a deviation only if it materially shifts risk. Harmless rewording, a different order, or a term more favourable than the standard is not a deviation. Quote the deviating words exactly as they appear.",
  "Task 3, summary: as described in the output schema.",
  "",
  "Apply Indian law where relevant (Indian Contract Act 1872, DPDP Act 2023, Arbitration and Conciliation Act 1996). You are not giving legal advice and must not say whether to sign.",
].join("\n");

function buildPrompt(input: {
  clauses: AssessClause[];
  positions: AssessPosition[];
  ruleFindings: AssessRuleFinding[];
  perspective: string | null;
}): string {
  let budget = MAX_TOTAL_CHARS;
  const clauseBlocks: string[] = [];
  for (const clause of input.clauses) {
    const text = clause.text.slice(0, MAX_CLAUSE_CHARS);
    if (text.length > budget) break;
    budget -= text.length;
    clauseBlocks.push(
      `[clause ${clause.ordinal}${clause.type ? `, type ${clause.type}` : ""}]\n${escapeDocument(text)}`,
    );
  }

  const present = new Set(input.clauses.map((clause) => clause.type));
  const positions = input.positions
    .filter((position) => present.has(position.clauseType))
    .map(
      (position) =>
        `${position.clauseType}:\n  standard: ${position.standardText}` +
        (position.fallbackText ? `\n  fallback: ${position.fallbackText}` : "") +
        (position.walkaway ? `\n  walk-away: ${position.walkaway}` : ""),
    );

  const findings = input.ruleFindings.map(
    (finding) =>
      `[${finding.index}] ${finding.title} (rule default: severity ${finding.severity}, likelihood ${finding.likelihood})` +
      (finding.quotedText
        ? `\n    "${finding.quotedText.slice(0, 300)}"`
        : "\n    (something missing from the contract)"),
  );

  return [
    input.perspective
      ? `Review from the point of view of ${input.perspective}.`
      : "It is not known which party the organisation is. Judge one-sided terms as risks to whichever party they burden.",
    "",
    `<document>\n${clauseBlocks.join("\n\n")}\n</document>`,
    "",
    "PLAYBOOK",
    positions.length
      ? positions.join("\n")
      : "(no positions for the clause types in this contract)",
    "",
    "RULE FINDINGS",
    findings.length ? findings.join("\n") : "(none)",
  ].join("\n");
}

/** Which score category a deviation in a clause of this type belongs to. */
const TYPE_CATEGORY: Record<string, RiskCategory> = {
  limitation_of_liability: "liability",
  indemnity: "liability",
  warranties_and_representations: "liability",
  insurance: "liability",
  intellectual_property: "ip",
  confidentiality: "ip",
  termination: "termination",
  force_majeure: "termination",
  payment: "payment",
  taxes: "payment",
  audit_and_records: "payment",
  data_protection: "data",
  term_and_renewal: "renewal",
  non_compete: "restrictions",
  non_solicitation: "restrictions",
  assignment_and_subcontracting: "restrictions",
  general_provisions: "restrictions",
  notices: "disputes",
  governing_law_and_jurisdiction: "disputes",
  dispute_resolution: "disputes",
};

export type RuleJudgment = {
  index: number;
  severity: number;
  likelihood: number;
  note: string | null;
};

export type Deviation = {
  clauseOrdinal: number;
  clauseType: string;
  category: RiskCategory;
  title: string;
  quotedText: string;
  reasoning: string;
  severity: number;
  likelihood: number;
  suggestedFix: string;
};

export type AssessResult = {
  summary: string;
  judgments: RuleJudgment[];
  deviations: Deviation[];
  usage: TokenUsage;
  modelId: string;
  usedFallback: boolean;
};

const clean = (text: string, max: number) =>
  text.replace(/\s+/g, " ").trim().slice(0, max);

/** Turns the model's answer into things safe to store. Pure: no I/O. */
export function verifyAssessment(
  input: { clauses: AssessClause[]; ruleFindings: AssessRuleFinding[] },
  assessment: Assessment,
): Pick<AssessResult, "summary" | "judgments" | "deviations"> {
  const known = new Set(input.ruleFindings.map((finding) => finding.index));
  const judgments = assessment.ruleFindings
    .filter((judgment) => known.has(judgment.index))
    .map((judgment) => ({
      index: judgment.index,
      // "Does not apply" lowers a finding to a note. It stays visible: a rule
      // hit is never deleted on a model's say-so.
      severity: judgment.doesNotApply ? 1 : judgment.severity,
      likelihood: judgment.doesNotApply ? 1 : judgment.likelihood,
      note: judgment.doesNotApply
        ? `On reading the contract as a whole, this was judged not to apply. ${clean(judgment.note ?? "", 400)}`.trim()
        : judgment.note
          ? clean(judgment.note, 400)
          : null,
    }));

  const byOrdinal = new Map(input.clauses.map((clause) => [clause.ordinal, clause]));
  const seen = new Set<string>();
  const deviations: Deviation[] = [];
  for (const item of assessment.deviations) {
    const clause = byOrdinal.get(item.clauseIndex);
    if (!clause?.type || !(clause.type in TYPE_CATEGORY)) continue;
    // No citation, no finding: the quote must be in this clause.
    const at = findQuote(clause.text, item.quote);
    if (at < 0) continue;
    // Store the clause's own words, not the model's copy of them.
    const wanted = item.quote.replace(/\s+/g, " ").trim();
    const exact = clause.text.includes(item.quote)
      ? item.quote
      : clause.text.slice(at, at + wanted.length + 40).split(/(?<=[.;])\s/)[0];
    const key = `${clause.ordinal}|${exact}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deviations.push({
      clauseOrdinal: clause.ordinal,
      clauseType: clause.type,
      category: TYPE_CATEGORY[clause.type],
      title: clean(item.title, 120),
      quotedText: exact,
      reasoning:
        `Differs from the playbook position for ${clauseTypeLabel(clause.type).toLowerCase()}. ${clean(item.deviation, 800)}` +
        (item.beyondWalkaway ? " This is past the playbook's walk-away point." : ""),
      severity: item.severity,
      likelihood: item.likelihood,
      suggestedFix: clean(item.suggestedText, 1500),
    });
  }

  return { summary: clean(assessment.summary, 1500), judgments, deviations };
}

export async function assessContract(
  ai: PipelineAi,
  input: {
    clauses: AssessClause[];
    positions: AssessPosition[];
    ruleFindings: AssessRuleFinding[];
    perspective: string | null;
  },
): Promise<AssessResult> {
  const result = await ai.generateStructured({
    tier: "reasoning",
    functionId: "pipeline.assess",
    schema: assessmentSchema,
    system: SYSTEM,
    prompt: buildPrompt(input),
    // A live call with medium thinking ran past two minutes without
    // answering, so thinking is kept low and the time limit is generous.
    thinking: "low",
    timeoutMs: 240_000,
  });
  return {
    ...verifyAssessment(input, result.object),
    usage: result.usage,
    modelId: result.modelId,
    usedFallback: result.usedFallback,
  };
}
