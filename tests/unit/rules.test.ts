import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";
import { RISK_CATEGORIES, RULES, runRules } from "@/lib/rules";
import { describeDays, durations, sentenceAround, typeOf } from "@/lib/rules/helpers";
import type { RuleClause } from "@/lib/rules/types";

const clauseRules = RULES.filter((rule) => rule.kind === "clause");
const contractRules = RULES.filter((rule) => rule.kind === "contract");

const clause = (text: string, extra: Partial<RuleClause> = {}): RuleClause => ({
  ordinal: 0,
  type: null,
  heading: null,
  text,
  ...extra,
});

/** Runs one rule on one clause, with the clause typed so the rule applies to it. */
function fires(ruleId: string, text: string): boolean {
  const rule = RULES.find((candidate) => candidate.id === ruleId);
  if (!rule || rule.kind !== "clause") throw new Error(`no clause rule ${ruleId}`);
  const type = rule.types?.[0] ?? null;
  return runRules({ clauses: [clause(text, { type })], text }, [rule]).length > 0;
}

function fixture(name: string) {
  const text = normaliseText(
    readFileSync(`tests/fixtures/contracts/${name}.txt`, "utf8"),
  );
  const clauses = segmentContract(text).map((s) => ({
    ordinal: s.ordinal,
    type: null,
    heading: s.heading,
    text: s.text,
  }));
  return { text, clauses };
}

describe("rule set", () => {
  it("has more than 60 detectors, each with a unique id", () => {
    expect(RULES.length).toBeGreaterThan(60);
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
  });

  it("covers every risk category", () => {
    for (const category of RISK_CATEGORIES) {
      expect(RULES.some((rule) => rule.category === category)).toBe(true);
    }
  });

  it("gives every rule an explanation, a suggestion and valid scores", () => {
    for (const rule of RULES) {
      expect(rule.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
      expect(rule.explanation.length).toBeGreaterThan(30);
      expect(rule.suggestion.length).toBeGreaterThan(15);
      expect(rule.severity).toBeGreaterThanOrEqual(1);
      expect(rule.severity).toBeLessThanOrEqual(5);
      expect(rule.likelihood).toBeGreaterThanOrEqual(1);
      expect(rule.likelihood).toBeLessThanOrEqual(5);
    }
  });
});

describe.each(clauseRules.map((rule) => [rule.id, rule] as const))("%s", (id, rule) => {
  if (rule.kind !== "clause") return;

  it.each(rule.examples.hit)("fires on: %s", (text) => {
    expect(fires(id, text)).toBe(true);
  });

  it.each(rule.examples.miss)("stays quiet on: %s", (text) => {
    expect(fires(id, text)).toBe(false);
  });

  it("quotes the clause verbatim", () => {
    for (const text of rule.examples.hit) {
      const padded = `Preceding sentence that is unrelated. ${text} A following sentence.`;
      const type = rule.types?.[0] ?? null;
      const [finding] = runRules({ clauses: [clause(padded, { type })], text: padded }, [
        rule,
      ]);
      expect(finding.quotedText).toBeTruthy();
      expect(padded).toContain(finding.quotedText!);
    }
  });
});

describe("contract-level rules", () => {
  const run = (id: string, text: string, clauses: RuleClause[], contractType?: string) =>
    runRules(
      { text, clauses, contractType },
      contractRules.filter((rule) => rule.id === id),
    );

  it("reports a missing liability clause, but not in an NDA", () => {
    const text = "1. Services\nThe Vendor shall provide the services.";
    const clauses = [clause(text, { type: "scope_of_work" })];
    expect(
      run("liability.no-cap", text, clauses, "master_services_agreement"),
    ).toHaveLength(1);
    expect(run("liability.no-cap", text, clauses, "nda")).toHaveLength(0);

    const withCap = [
      ...clauses,
      clause("Liability is capped.", { type: "limitation_of_liability" }),
    ];
    expect(
      run("liability.no-cap", text, withCap, "master_services_agreement"),
    ).toHaveLength(0);
  });

  it("reports missing data protection only when personal data is mentioned", () => {
    const mentions = "The Vendor will handle employee data of the Client.";
    expect(run("data.no-clause", mentions, [clause(mentions)])).toHaveLength(1);

    const none = "The Vendor will supply steel rods.";
    expect(run("data.no-clause", none, [clause(none)])).toHaveLength(0);

    const covered = [
      clause(mentions),
      clause("Data terms.", { type: "data_protection" }),
    ];
    expect(run("data.no-clause", mentions, covered)).toHaveLength(0);
  });

  it("reports a data clause with no breach notification and no erasure", () => {
    const text = "The Processor shall process personal data only on instructions.";
    const clauses = [clause(text, { type: "data_protection" })];
    expect(run("data.no-breach-notification", text, clauses)).toHaveLength(1);
    expect(run("data.no-deletion", text, clauses)).toHaveLength(1);

    const full = `${text} It shall notify any breach promptly and erase the data on termination.`;
    const better = [clause(full, { type: "data_protection" })];
    expect(run("data.no-breach-notification", full, better)).toHaveLength(0);
    expect(run("data.no-deletion", full, better)).toHaveLength(0);
  });

  it("reports missing governing law, stamp duty and termination", () => {
    const text = "The parties agree to cooperate.";
    const clauses = [clause(text)];
    const ids = runRules({ text, clauses }, contractRules).map((f) => f.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "disputes.no-governing-law",
        "disputes.no-dispute-resolution",
        "disputes.stamp-duty-not-addressed",
        "termination.no-clause",
        "disputes.no-confidentiality",
      ]),
    );
  });

  it("produces contract-level findings without a clause or a quote", () => {
    const text = "The parties agree to cooperate.";
    const [finding] = run("disputes.no-governing-law", text, [clause(text)]);
    expect(finding).toMatchObject({
      clauseOrdinal: null,
      quotedText: null,
      clauseType: "governing_law_and_jurisdiction",
    });
  });
});

describe("runRules on the sample contracts", () => {
  it("finds the risks planted in the services agreement", () => {
    const { text, clauses } = fixture("services-agreement");
    const findings = runRules({
      text,
      clauses,
      contractType: "master_services_agreement",
    });
    const ids = findings.map((f) => f.ruleId);

    expect(ids).toEqual(
      expect.arrayContaining([
        "payment.long-terms", // 90 days
        "renewal.automatic",
        "renewal.long-non-renewal-notice", // 120 days
        "ip.vests-in-supplier",
        "ip.licence-only",
        "liability.low-cap", // 3 months of fees
        "liability.uncapped-indemnity",
        "liability.one-sided-indemnity",
        "termination.unilateral-convenience",
        "termination.right-restricted",
        "termination.long-cure-period", // 90 days
        "restrictions.post-termination-non-compete",
        "disputes.stamp-duty-not-addressed",
      ]),
    );

    // Things this contract does properly must not be flagged.
    expect(ids).not.toContain("data.no-clause");
    expect(ids).not.toContain("disputes.no-governing-law");
    expect(ids).not.toContain("payment.high-interest"); // 18% is at the threshold, not over
    expect(ids).not.toContain("restrictions.exclusivity"); // "exclusive of taxes", "exclusive jurisdiction"

    const indemnity = findings.find((f) => f.ruleId === "liability.uncapped-indemnity");
    expect(indemnity).toMatchObject({ severity: 5, likelihood: 4 });
    expect(indemnity?.quotedText).toMatch(/shall indemnify the Service Provider/);
    expect(clauses[indemnity!.clauseOrdinal!].text).toContain(indemnity!.quotedText!);
  });

  it("flags the post-termination non-compete and the bare assignment in the employment agreement", () => {
    const { text, clauses } = fixture("employment-agreement");
    const findings = runRules({ text, clauses, contractType: "employment_agreement" });
    const ids = findings.map((f) => f.ruleId);

    expect(ids).toContain("restrictions.post-termination-non-compete");
    expect(ids).toContain("ip.assignment-no-term-or-territory");
    // Short notice during probation and dismissal for misconduct are normal.
    expect(ids).not.toContain("termination.short-notice");
    expect(ids).not.toContain("termination.no-notice");

    const nonCompete = findings.find((f) => f.ruleId.endsWith("non-compete"));
    expect(nonCompete?.reasoning).toMatch(/24 months after the contract ends/);
    expect(nonCompete?.reasoning).toMatch(/[Ss]ection 27/);
  });

  it("finds little wrong with the balanced mutual NDA", () => {
    const { text, clauses } = fixture("mutual-nda");
    const findings = runRules({ text, clauses, contractType: "nda" });

    expect(findings.filter((f) => f.severity >= 4)).toEqual([]);
    expect(findings.length).toBeLessThanOrEqual(3);
  });

  it("every clause-level finding quotes text that is in its clause", () => {
    for (const name of ["services-agreement", "employment-agreement", "mutual-nda"]) {
      const { text, clauses } = fixture(name);
      for (const finding of runRules({ text, clauses })) {
        if (finding.clauseOrdinal === null) continue;
        expect(clauses[finding.clauseOrdinal].text).toContain(finding.quotedText!);
      }
    }
  });
});

describe("clauses the model could not type", () => {
  const text =
    "The Client shall indemnify the Service Provider against all claims, without limit.";

  it('still runs type-specific rules on a clause labelled "other"', () => {
    const findings = runRules({
      text,
      clauses: [clause(text, { type: "other", heading: "Limitation of Liability" })],
    });
    expect(findings.map((f) => f.ruleId)).toContain("liability.uncapped-indemnity");
    // The finding is weighted by the heading-based type, not by "other".
    expect(findings[0].clauseType).toBe("limitation_of_liability");
  });

  it("never scans definitions or the signature block", () => {
    const findings = runRules({
      text,
      clauses: [
        clause(text, { type: "definitions" }),
        clause(text, { type: "signature_block", ordinal: 1 }),
      ],
    });
    expect(findings.filter((f) => f.clauseOrdinal !== null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("reads durations written in digits, words and both", () => {
    const days = (text: string) => durations(text).map((d) => d.days);
    expect(days("within 30 days")).toEqual([30]);
    expect(days("thirty (30) days")).toEqual([30]);
    expect(days("3 (three) months")).toEqual([90]);
    expect(days("a period of 2 years and 6 months")).toEqual([730, 180]);
    expect(days("within 48 hours")).toEqual([2]);
    expect(days("15 business days")).toEqual([15]);
    expect(days("no numbers here")).toEqual([]);
  });

  it("describes durations in the largest whole unit", () => {
    expect(describeDays(730)).toBe("2 years");
    expect(describeDays(90)).toBe("3 months");
    expect(describeDays(45)).toBe("45 days");
    expect(describeDays(2)).toBe("2 days");
  });

  it("returns the whole sentence around a match, verbatim", () => {
    const text =
      "First sentence. The Client shall pay within 90 days of receipt. Last one.";
    expect(sentenceAround(text, text.indexOf("90"), 2)).toBe(
      "The Client shall pay within 90 days of receipt.",
    );
  });

  it("guesses a clause type from its heading when the model gave none", () => {
    expect(typeOf(clause("x", { heading: "Limitation of Liability" }))).toBe(
      "limitation_of_liability",
    );
    expect(typeOf(clause("x", { heading: "Fees and Payment" }))).toBe("payment");
    expect(typeOf(clause("x", { heading: "Term" }))).toBe("term_and_renewal");
    expect(typeOf(clause("x", { heading: "Preamble" }))).toBeNull();
    // A specific label from the model always wins.
    expect(typeOf(clause("x", { heading: "Fees", type: "taxes" }))).toBe("taxes");
    // "other" means the model could not place it, so the heading is used instead.
    expect(typeOf(clause("x", { heading: "Indemnity", type: "other" }))).toBe(
      "indemnity",
    );
    expect(typeOf(clause("x", { heading: "Background", type: "other" }))).toBeNull();
  });
});
