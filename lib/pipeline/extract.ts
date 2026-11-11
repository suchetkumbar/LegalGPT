import { z } from "zod";

import { DOCUMENT_IS_DATA, escapeDocument, type PipelineAi, type TokenUsage } from "./ai";
import { findQuote } from "./quotes";

/**
 * Entity extraction: the parties, dates, value and governing law of a
 * contract. Every entity must come with a verbatim quote, and the server
 * drops any entity whose quote is not in the contract. An extracted "fact"
 * that cannot be pointed at in the text is not shown to anyone.
 */

export const CONTRACT_TYPES = [
  "nda",
  "master_services_agreement",
  "statement_of_work",
  "saas_subscription",
  "consulting_agreement",
  "employment_agreement",
  "supply_agreement",
  "lease_or_licence",
  "loan_or_finance",
  "partnership_or_shareholders",
  "other",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const ENTITY_KINDS = [
  "party",
  "date",
  "amount",
  "law",
  "jurisdiction",
  "term",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

const quote = z
  .string()
  .describe(
    "The exact words from the contract that state this, copied verbatim (5-40 words)",
  );

const extractionSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES),
  parties: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Full legal name as written, e.g. 'Narmada Retail Private Limited'"),
        role: z
          .string()
          .nullable()
          .describe(
            "The short name the contract gives this party, e.g. 'Client', 'Employee'",
          ),
        quote,
      }),
    )
    .describe("The contracting parties only, not signatories, witnesses or affiliates"),
  effectiveDate: z
    .object({
      iso: z.string().describe("The date as YYYY-MM-DD"),
      quote,
    })
    .nullable()
    .describe("The date the contract takes effect. Null if no specific date is stated."),
  term: z
    .object({
      description: z
        .string()
        .describe("Duration and renewal in plain words, e.g. '3 years, renews yearly'"),
      quote,
    })
    .nullable(),
  contractValue: z
    .object({
      amount: z
        .number()
        .describe(
          "The amount as a plain number. 'INR 48,00,000' is 4800000; '2.5 crore' is 25000000.",
        ),
      currency: z.string().describe("ISO currency code, e.g. INR, USD"),
      description: z
        .string()
        .describe(
          "What the amount is, e.g. 'total fees under the first statement of work'",
        ),
      quote,
    })
    .nullable()
    .describe("The main contract value or fee. Null if none is stated."),
  governingLaw: z
    .object({ value: z.string().describe("e.g. 'Laws of India'"), quote })
    .nullable(),
  jurisdiction: z
    .object({
      value: z
        .string()
        .describe(
          "Courts or arbitration seat, e.g. 'Courts at Hyderabad', 'Arbitration seated in Bengaluru'",
        ),
      quote,
    })
    .nullable(),
});

export type Extraction = z.infer<typeof extractionSchema>;

export type ExtractedEntity = {
  kind: EntityKind;
  /** What the value is: a party's role, or a field name such as "effective_date". */
  label: string;
  value: string;
  /** Machine-readable form where one exists (ISO date, numeric amount). */
  normalized: Record<string, string | number> | null;
  /** Where the supporting quote starts in the contract text. */
  offset: number;
};

/** Enough for a 60-page contract. Beyond that, keep the start and the end. */
const MAX_CHARS = 160_000;
const TAIL_CHARS = 30_000;

function fitToBudget(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  // Parties and dates are at the start; governing law and signatures at the end.
  return `${text.slice(0, MAX_CHARS - TAIL_CHARS)}\n[...]\n${text.slice(-TAIL_CHARS)}`;
}

const SYSTEM = [
  "You extract key facts from a contract, most often one governed by Indian law, for a contract review tool.",
  DOCUMENT_IS_DATA,
  "",
  "Extract only what the contract states. Do not infer, guess or fill in typical values. If something is not stated, return null for it.",
  "Every item needs a quote: the exact words from the contract that state it, copied character for character. An item without a real quote will be discarded.",
  "Indian number formats use lakh and crore grouping: 48,00,000 is forty-eight lakh (4800000). Rs., INR and ₹ all mean Indian rupees (INR).",
].join("\n");

const isIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Turns the model's answer into entities, keeping only those whose quote is in the text. */
export function verifyExtraction(
  source: string,
  extraction: Extraction,
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const add = (entity: Omit<ExtractedEntity, "offset">, quoted: string) => {
    const offset = findQuote(source, quoted);
    const value = entity.value.replace(/\s+/g, " ").trim();
    if (offset >= 0 && value)
      entities.push({ ...entity, value: value.slice(0, 500), offset });
  };

  for (const party of extraction.parties) {
    // A party's name must itself appear in the contract, not just near a quote.
    if (findQuote(source, party.name, 3) < 0) continue;
    add(
      {
        kind: "party",
        label: party.role?.trim() || "party",
        value: party.name,
        normalized: null,
      },
      party.quote,
    );
  }

  const { effectiveDate, term, contractValue, governingLaw, jurisdiction } = extraction;
  if (effectiveDate && isIsoDate(effectiveDate.iso)) {
    add(
      {
        kind: "date",
        label: "effective_date",
        value: effectiveDate.iso,
        normalized: { iso: effectiveDate.iso },
      },
      effectiveDate.quote,
    );
  }
  if (term) {
    add(
      { kind: "term", label: "term", value: term.description, normalized: null },
      term.quote,
    );
  }
  if (
    contractValue &&
    Number.isFinite(contractValue.amount) &&
    contractValue.amount > 0
  ) {
    const currency = contractValue.currency.trim().toUpperCase().slice(0, 3) || "INR";
    add(
      {
        kind: "amount",
        label: "contract_value",
        value: contractValue.description,
        normalized: { amount: contractValue.amount, currency },
      },
      contractValue.quote,
    );
  }
  if (governingLaw) {
    add(
      {
        kind: "law",
        label: "governing_law",
        value: governingLaw.value,
        normalized: null,
      },
      governingLaw.quote,
    );
  }
  if (jurisdiction) {
    add(
      {
        kind: "jurisdiction",
        label: "jurisdiction",
        value: jurisdiction.value,
        normalized: null,
      },
      jurisdiction.quote,
    );
  }
  return entities;
}

const simplify = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|inc|corp|company|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The other side of the contract, from the uploading organisation's point of
 * view. Only filled in when exactly one party is recognisably the
 * organisation itself; otherwise it is left for a person to set.
 */
export function pickCounterparty(orgName: string, parties: string[]): string | null {
  const org = simplify(orgName);
  if (!org || parties.length < 2) return null;
  const isOrg = (party: string) => {
    const name = simplify(party);
    return name.length > 0 && (name.includes(org) || org.includes(name));
  };
  const own = parties.filter(isOrg);
  if (own.length !== 1) return null;
  return parties.filter((party) => !isOrg(party)).join(", ") || null;
}

export type ExtractResult = {
  contractType: ContractType;
  entities: ExtractedEntity[];
  usage: TokenUsage;
  modelId: string;
};

export async function extractEntities(
  ai: PipelineAi,
  source: string,
): Promise<ExtractResult> {
  const result = await ai.generateStructured({
    tier: "fast",
    functionId: "pipeline.extract",
    schema: extractionSchema,
    system: SYSTEM,
    prompt: `<document>\n${escapeDocument(fitToBudget(source))}\n</document>\n\nExtract the contract type, parties, effective date, term, contract value, governing law and jurisdiction.`,
  });
  return {
    contractType: result.object.contractType,
    entities: verifyExtraction(source, result.object),
    usage: result.usage,
    modelId: result.modelId,
  };
}
