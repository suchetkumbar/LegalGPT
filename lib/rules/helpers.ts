import type { ClauseType } from "@/lib/pipeline/clause-types";

import type { ClauseRule, RuleClause, RuleContext } from "./types";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  eighteen: 18,
  twenty: 20,
  "twenty-four": 24,
  thirty: 30,
  "thirty-six": 36,
  forty: 40,
  "forty-five": 45,
  sixty: 60,
  ninety: 90,
  hundred: 100,
  "one hundred and twenty": 120,
  "one hundred and eighty": 180,
};

const NUMBER = `(\\d{1,4}|${Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
/** "30 days", "thirty (30) days", "3 (three) months", "2 years". */
export const DURATION_SOURCE = `${NUMBER}\\s*(?:\\(\\s*[a-z0-9 -]+\\s*\\)\\s*)?(?:business\\s+|working\\s+|calendar\\s+)?(hours?|days?|weeks?|months?|years?)`;

const UNIT_DAYS: Record<string, number> = {
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export type Duration = { days: number; text: string; index: number };

function toNumber(raw: string): number {
  return /^\d+$/.test(raw)
    ? Number(raw)
    : (NUMBER_WORDS[raw.toLowerCase()] ?? Number.NaN);
}

/** Every duration mentioned in a piece of text, converted to days. */
export function durations(text: string): Duration[] {
  const found: Duration[] = [];
  for (const match of text.matchAll(new RegExp(DURATION_SOURCE, "gi"))) {
    const unit = match[2].toLowerCase().replace(/s$/, "");
    const days = toNumber(match[1]) * UNIT_DAYS[unit];
    if (Number.isFinite(days)) found.push({ days, text: match[0], index: match.index });
  }
  return found;
}

/** The first duration that appears after `index`, within `window` characters. */
export function durationAfter(
  text: string,
  index: number,
  window = 120,
): Duration | null {
  return (
    durations(text).find((d) => d.index >= index && d.index - index <= window) ?? null
  );
}

/** The duration nearest to `index` on either side, within `window` characters. */
export function durationNear(text: string, index: number, window = 100): Duration | null {
  const near = durations(text)
    .map((d) => ({ d, distance: Math.abs(d.index - index) }))
    .filter(({ distance }) => distance <= window)
    .sort((a, b) => a.distance - b.distance);
  return near[0]?.d ?? null;
}

export function describeDays(days: number): string {
  if (days >= 365 && days % 365 === 0)
    return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days >= 30 && days % 30 === 0) return `${days / 30} month${days === 30 ? "" : "s"}`;
  if (days < 1) return `${Math.round(days * 24)} hours`;
  return `${days} days`;
}

/**
 * The sentence around a match, as an exact substring of the clause. Findings
 * quote this, so it must be verbatim: no trimming inside, no ellipses.
 */
export function sentenceAround(text: string, index: number, length: number): string {
  const boundary = /[.;]\s+(?=[A-Z("“])|\n+/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const after = match.index + match[0].length;
    if (after <= index) start = after;
    else if (match.index >= index + length) {
      end = match.index + 1;
      break;
    }
  }
  let quote = text.slice(start, end);
  // Keep quotes readable: cut very long sentences around the match.
  if (quote.length > 420) {
    const from = Math.max(start, index - 160);
    quote = text.slice(from, Math.min(end, index + length + 200));
  }
  return quote.trim();
}

/** Heading keywords used to guess a clause's type when the model has not typed it. */
const HEADING_HINTS: [RegExp, ClauseType][] = [
  [/indemn/i, "indemnity"],
  [/liabilit/i, "limitation_of_liability"],
  [/intellectual|\bip\b|work product|ownership/i, "intellectual_property"],
  [/data protection|personal data|privacy/i, "data_protection"],
  [/confiden|non-disclosure/i, "confidentiality"],
  [/non-?compete|restrictive covenant|exclusiv/i, "non_compete"],
  [/non-?solicit/i, "non_solicitation"],
  [/terminat/i, "termination"],
  [/\bterm\b|renewal|duration/i, "term_and_renewal"],
  [/\btax|gst|tds/i, "taxes"],
  [/fee|payment|consideration|remuneration|invoice|price/i, "payment"],
  [/arbitrat|dispute/i, "dispute_resolution"],
  [/governing law|jurisdiction|applicable law/i, "governing_law_and_jurisdiction"],
  [/warrant|representation/i, "warranties_and_representations"],
  [/force majeure/i, "force_majeure"],
  [/assign|subcontract/i, "assignment_and_subcontracting"],
  [/notice/i, "notices"],
  [/stamp/i, "stamp_duty_and_costs"],
  [/service level|sla\b/i, "service_levels"],
  [/scope|services|deliverable/i, "scope_of_work"],
  [/probation|leave|working hours|appointment/i, "employment_terms"],
  [/general|miscellaneous|entire agreement|amendment/i, "general_provisions"],
];

/**
 * The clause's type: the model's label if it gave a specific one, otherwise a
 * guess from the heading. "other" counts as no label: it means the model
 * could not place the clause, which must not hide it from the rules.
 */
export function typeOf(clause: RuleClause): ClauseType | null {
  if (clause.type && clause.type !== "other") return clause.type;
  if (!clause.heading) return null;
  return HEADING_HINTS.find(([pattern]) => pattern.test(clause.heading!))?.[1] ?? null;
}

type PatternRule = Omit<ClauseRule, "kind" | "detect"> & {
  pattern: RegExp;
  /** Reject the match if the sentence it is in also matches this. */
  unless?: RegExp;
  /**
   * Extra test on a match. Return false to reject it, or a string to add as
   * detail to the finding (for example the number that crossed a threshold).
   */
  check?: (
    match: RegExpExecArray,
    sentence: string,
    clause: RuleClause,
    context: RuleContext,
  ) => boolean | string;
};

/** Builds a clause rule from a pattern. The first acceptable match in a clause wins. */
export function patternRule(definition: PatternRule): ClauseRule {
  const { pattern, unless, check, ...meta } = definition;
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return {
    ...meta,
    kind: "clause",
    detect(clause, context) {
      for (const match of clause.text.matchAll(global)) {
        const sentence = sentenceAround(clause.text, match.index, match[0].length);
        if (unless?.test(sentence)) continue;
        const result = check
          ? check(match as RegExpExecArray, sentence, clause, context)
          : true;
        if (result === false) continue;
        return {
          quote: sentence,
          detail: typeof result === "string" ? result : undefined,
        };
      }
      return null;
    },
  };
}

/** Wording that makes an obligation or right apply to both sides. */
export const MUTUAL =
  /\b(each party|either party|both parties|neither party|the parties|mutual(?:ly)?|any party|no party)\b/i;

/** The duration closest to where a match ends, within the same sentence. */
export function durationByMatch(
  sentence: string,
  matched: string,
  window = 90,
): Duration | null {
  const at = sentence.indexOf(matched);
  return durationNear(sentence, at < 0 ? 0 : at + matched.length, window);
}

/** A party named as the subject of a sentence: "the Service Provider", "Client", "The Company". */
export const PARTY = String.raw`((?:[Tt]he\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})`;
