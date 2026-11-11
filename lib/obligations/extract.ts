import { DURATION_SOURCE, sentenceAround, typeOf } from "@/lib/rules/helpers";
import type { RuleClause } from "@/lib/rules/types";

/**
 * Obligation and deadline extraction, by rules. Dates are worked out from the
 * effective date and the durations written in the contract, so they can be
 * checked by hand, and cost no model call.
 *
 * Only what can be computed is given a date. A notice period or a payment
 * term with no fixed start is listed without one.
 */

export type ObligationKind =
  "expiry" | "renewal_notice" | "probation_end" | "payment" | "notice_period";

export type ExtractedObligation = {
  kind: ObligationKind;
  description: string;
  /** ISO date, when it can be computed. */
  dueDate: string | null;
  recurrence: "monthly" | "quarterly" | "yearly" | null;
  noticeDays: number | null;
  clauseOrdinal: number | null;
  quotedText: string | null;
};

type Unit = "day" | "week" | "month" | "year";
type Span = { amount: number; unit: Unit; text: string; index: number };

const WORDS: Record<string, number> = {
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
};

/** Durations with their unit kept, so months and years are added as calendar months. */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  for (const match of text.matchAll(new RegExp(DURATION_SOURCE, "gi"))) {
    const raw = match[1].toLowerCase();
    const amount = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
    const unit = match[2].toLowerCase().replace(/s$/, "") as Unit | "hour";
    if (!amount || unit === "hour") continue;
    out.push({ amount, unit, text: match[0], index: match.index });
  }
  return out;
}

function addSpan(iso: string, span: Pick<Span, "amount" | "unit">): Date {
  const date = new Date(`${iso}T00:00:00Z`);
  if (span.unit === "day") date.setUTCDate(date.getUTCDate() + span.amount);
  else if (span.unit === "week") date.setUTCDate(date.getUTCDate() + span.amount * 7);
  else {
    // Calendar months, clamped to the month's end: one month from 31 January
    // is 28 February, not 3 March as plain Date arithmetic would make it.
    const months = span.unit === "month" ? span.amount : span.amount * 12;
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date;
}

const toIso = (date: Date) => date.toISOString().slice(0, 10);
const daysOf = (span: Span) =>
  span.unit === "day"
    ? span.amount
    : span.unit === "week"
      ? span.amount * 7
      : span.unit === "month"
        ? span.amount * 30
        : span.amount * 365;

function minusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return toIso(date);
}

const clausesOfType = (clauses: RuleClause[], ...types: string[]) =>
  clauses.filter((clause) => types.includes(typeOf(clause) ?? ""));

export function extractObligations(input: {
  clauses: RuleClause[];
  effectiveDate: string | null;
}): ExtractedObligation[] {
  const { clauses, effectiveDate } = input;
  const found: ExtractedObligation[] = [];
  const quote = (clause: RuleClause, span: Span) =>
    sentenceAround(clause.text, span.index, span.text.length);

  // Term and expiry. A contract "for 2 years from the Effective Date" ends the
  // day before the second anniversary.
  let expiry: string | null = null;
  // "Term and Termination" headings are typed as termination, so look there too.
  for (const clause of clausesOfType(
    clauses,
    "term_and_renewal",
    "termination",
    "employment_terms",
  )) {
    const term =
      /\b(?:term|period|continue|remain in force|valid|lasts?|duration)\b[^.;]{0,60}?/i;
    const sentence = clause.text
      .split(/(?<=[.;])\s+/)
      .find((s) => term.test(s) && spans(s).length > 0);
    if (!sentence || /\bprobation\b|\bnotice\b/i.test(sentence)) continue;
    const span = spans(sentence)[0];
    if (!span || span.unit === "day" || span.unit === "week") continue;
    const at = clause.text.indexOf(sentence);
    const spanInClause = { ...span, index: at + span.index };
    expiry = effectiveDate ? minusDays(toIso(addSpan(effectiveDate, span)), 1) : null;
    found.push({
      kind: "expiry",
      description: `The contract expires (initial term of ${span.text}).`,
      dueDate: expiry,
      recurrence: null,
      noticeDays: null,
      clauseOrdinal: clause.ordinal,
      quotedText: quote(clause, spanInClause),
    });
    break;
  }

  // Automatic renewal: the last day to stop it.
  for (const clause of clauses) {
    const match = /\bnon-?renewal\b|\bnot to renew\b|\bnot renew\b/i.exec(clause.text);
    if (!match || !/\brenew/i.test(clause.text)) continue;
    // The notice period is the duration closest after "non-renewal" ("notice
    // of non-renewal at least 120 days before"), not the term mentioned earlier.
    const span =
      spans(clause.text).find(
        (s) => s.index > match.index && s.index - match.index < 80,
      ) ??
      spans(clause.text)
        .filter((s) => Math.abs(s.index - match.index) < 80)
        .sort(
          (a, b) => Math.abs(a.index - match.index) - Math.abs(b.index - match.index),
        )[0];
    if (!span) continue;
    const days = daysOf(span);
    found.push({
      kind: "renewal_notice",
      description: `Last day to give notice of non-renewal (${span.text} before the term ends), or the contract renews.`,
      dueDate: expiry ? minusDays(expiry, days) : null,
      recurrence: null,
      noticeDays: days,
      clauseOrdinal: clause.ordinal,
      quotedText: quote(clause, span),
    });
    break;
  }

  // Probation.
  for (const clause of clauses) {
    const match = /\bprobation\b/i.exec(clause.text);
    if (!match) continue;
    const span = spans(clause.text).find(
      (s) => s.index > match.index && s.index - match.index < 80,
    );
    if (!span || span.unit === "day") continue;
    found.push({
      kind: "probation_end",
      description: `Probation ends (${span.text}); confirm or extend before this date.`,
      dueDate: effectiveDate ? minusDays(toIso(addSpan(effectiveDate, span)), 1) : null,
      recurrence: null,
      noticeDays: null,
      clauseOrdinal: clause.ordinal,
      quotedText: quote(clause, span),
    });
    break;
  }

  // Payment terms.
  for (const clause of clausesOfType(clauses, "payment", "taxes")) {
    const match = /\b(?:pay|paid|payable)\b[^.;]{0,120}?\bwithin\s+/i.exec(clause.text);
    if (!match) continue;
    const span = spans(clause.text).find(
      (s) => s.index >= match.index && s.index - match.index < 160,
    );
    if (!span) continue;
    const recurrence = /\bmonthly\b|\beach month\b|\bper month\b/i.test(clause.text)
      ? "monthly"
      : /\bquarterly\b/i.test(clause.text)
        ? "quarterly"
        : /\bannual(?:ly)?\b|\byearly\b/i.test(clause.text)
          ? "yearly"
          : null;
    found.push({
      kind: "payment",
      description: `Invoices are payable within ${span.text} of receipt${recurrence ? `, invoiced ${recurrence}` : ""}.`,
      dueDate: null,
      recurrence,
      noticeDays: daysOf(span),
      clauseOrdinal: clause.ordinal,
      quotedText: quote(clause, span),
    });
    break;
  }

  // Termination notice periods: no date, but worth knowing before acting.
  for (const clause of clausesOfType(clauses, "termination")) {
    const match = /\bnotice\b/i.exec(clause.text);
    if (!match) continue;
    const span = spans(clause.text).find((s) => Math.abs(s.index - match.index) < 40);
    if (!span) continue;
    found.push({
      kind: "notice_period",
      description: `Termination needs ${span.text} notice.`,
      dueDate: null,
      recurrence: null,
      noticeDays: daysOf(span),
      clauseOrdinal: clause.ordinal,
      quotedText: quote(clause, span),
    });
    break;
  }

  return found;
}
