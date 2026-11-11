import { z } from "zod";

import { runCompliance, type RulePack } from "@/lib/compliance/engine";
import {
  DOCUMENT_IS_DATA,
  escapeDocument,
  type PipelineAi,
  type TokenUsage,
} from "@/lib/pipeline/ai";
import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";
import { runRules, type RuleFinding } from "@/lib/rules";
import { computeRiskScore } from "@/lib/scoring/score";

import { PREAMBLE, SIGNATURES, type Template } from "./templates";

export const requirementsSchema = z.object({
  templateId: z.string().min(1),
  partyA: z.string().trim().min(2).max(200),
  partyB: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(80),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termMonths: z.number().int().min(1).max(120),
  /** In rupees. Optional: NDAs have no value. */
  value: z.number().min(0).max(1e12).nullable(),
  paymentDays: z.number().int().min(1).max(120).default(30),
  /** What the contract is about, in the drafter's words. */
  scope: z.string().trim().min(3).max(1000),
});
export type Requirements = z.infer<typeof requirementsSchema>;

const rupees = (amount: number) =>
  `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;

function describeTerm(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} (${years === 1 ? "one" : String(years)}) year${years === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function titleCase(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bAs A\b/, "as a");
}

/**
 * Assembles a draft from a template, the requirements and the playbook. Pure
 * and deterministic: the same inputs always give the same text.
 */
export function assembleDraft(
  template: Template,
  requirements: Requirements,
  positions: { clauseType: string; standardText: string }[],
): string {
  const [roleA, roleB] = template.roles;
  const values: Record<string, string> = {
    TITLE_CASE: titleCase(template.title),
    CITY: requirements.city,
    EFFECTIVE_DATE: dateFormat.format(
      new Date(`${requirements.effectiveDate}T00:00:00Z`),
    ),
    PARTY_A: requirements.partyA,
    PARTY_B: requirements.partyB,
    ROLE_A: roleA,
    ROLE_B: roleB,
    TERM: describeTerm(requirements.termMonths),
    VALUE: requirements.value
      ? rupees(requirements.value)
      : "the amount agreed in writing",
    PAYMENT_DAYS: String(requirements.paymentDays),
    SCOPE: requirements.scope.replace(/[.\s]+$/, ""),
  };
  const fill = (text: string) =>
    text.replace(/\{([A-Z_]+)\}/g, (match, key: string) => values[key] ?? match);
  const standard = new Map(positions.map((p) => [p.clauseType, p.standardText]));

  const blocks = [template.title, fill(PREAMBLE)];
  let number = 0;
  for (const clause of template.clauses) {
    if (clause.type === "signature_block") continue;
    const body = clause.text ?? standard.get(clause.type);
    if (!body) continue;
    number += 1;
    blocks.push(`${number}. ${clause.heading.toUpperCase()}\n\n${fill(body)}`);
  }
  blocks.push(fill(SIGNATURES.text!));
  if (
    requirements.value &&
    template.clauses.some((c) => c.text?.includes("Schedule A"))
  ) {
    blocks.push(
      `SCHEDULE A - FEES\n\n1. Fees: ${rupees(requirements.value)}, exclusive of GST.\n2. Services: ${values.SCOPE}.`,
    );
  }
  return normaliseText(blocks.join("\n\n"));
}

export type DraftReview = {
  score: number;
  band: string;
  findings: Pick<
    RuleFinding,
    "ruleId" | "title" | "severity" | "quotedText" | "suggestedFix"
  >[];
  compliance: { ruleId: string; title: string; verdict: string; reference: string }[];
};

/** Runs a draft through the same rules and compliance packs as an uploaded contract. */
export function reviewDraft(
  text: string,
  packs: RulePack[],
  contractType: string,
): DraftReview {
  const clauses = segmentContract(text).map((segment) => ({
    ordinal: segment.ordinal,
    type: null,
    heading: segment.heading,
    text: segment.text,
  }));
  const findings = runRules({ text, clauses, contractType });
  const compliance = runCompliance(packs, {
    clauses,
    text,
    governingLaw: "laws of India",
  })
    .flatMap((pack) => pack.verdicts)
    .filter((verdict) => verdict.verdict !== "pass");
  const { score, band } = computeRiskScore(
    findings.map((finding) => ({ ...finding, status: "open" as const })),
  );
  return {
    score,
    band,
    findings: findings.map(({ ruleId, title, severity, quotedText, suggestedFix }) => ({
      ruleId,
      title,
      severity,
      quotedText,
      suggestedFix,
    })),
    compliance: compliance.map(({ ruleId, title, verdict, reference }) => ({
      ruleId,
      title,
      verdict,
      reference,
    })),
  };
}

const refineSchema = z.object({
  text: z.string().describe("The complete revised contract, as plain text"),
  changes: z.array(z.string()).describe("One line per change made, in plain words"),
});

/**
 * Optional: one model call that adapts a draft to the drafter's instructions.
 * The result is reviewed again by the caller before anyone sees it as final.
 */
export async function refineDraft(
  ai: PipelineAi,
  input: { text: string; instructions: string },
): Promise<{ text: string; changes: string[]; usage: TokenUsage; modelId: string }> {
  const result = await ai.generateStructured({
    tier: "reasoning",
    functionId: "drafting.refine",
    schema: refineSchema,
    system: [
      "You revise contract drafts governed by Indian law for a drafting tool.",
      DOCUMENT_IS_DATA,
      'Apply the drafter\'s instructions and nothing else. Keep the numbering style ("1. HEADING"), the parties, the dates and the amounts unless the instructions change them. Keep cross-references correct. Do not weaken protections that the instructions do not mention. Return the whole contract.',
    ].join("\n"),
    prompt: `<document>\n${escapeDocument(input.text)}\n</document>\n\nInstructions from the drafter:\n${input.instructions}`,
    thinking: "low",
    timeoutMs: 240_000,
  });
  return {
    text: normaliseText(result.object.text),
    changes: result.object.changes.slice(0, 30),
    usage: result.usage,
    modelId: result.modelId,
  };
}

const CONTRACT_TYPES: Record<string, string> = {
  "nda-mutual": "nda",
  "nda-one-way": "nda",
  msa: "master_services_agreement",
  sow: "statement_of_work",
  saas: "saas_subscription",
  consulting: "consulting_agreement",
  employment: "employment_agreement",
};

export function contractTypeFor(templateId: string): string {
  return CONTRACT_TYPES[templateId] ?? "other";
}
