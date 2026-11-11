import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  evaluateRule,
  phraseToPattern,
  runCompliance,
  type ComplianceContext,
  type RulePack,
} from "@/lib/compliance/engine";
import { BUILT_IN_PACKS, ICA } from "@/lib/compliance/packs";
import { policyToRule } from "@/lib/compliance/store";
import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";
import { RULES } from "@/lib/rules";

function contextFor(
  name: string,
  governingLaw: string | null = "laws of India",
): ComplianceContext {
  const text = normaliseText(
    readFileSync(`tests/fixtures/contracts/${name}.txt`, "utf8"),
  );
  const clauses = segmentContract(text).map((s) => ({
    ordinal: s.ordinal,
    type: null,
    heading: s.heading,
    text: s.text,
  }));
  return { clauses, text, governingLaw };
}

const verdictsOf = (context: ComplianceContext, packs = BUILT_IN_PACKS) =>
  Object.fromEntries(
    runCompliance(packs, context)
      .flatMap((pack) => pack.verdicts)
      .map((verdict) => [verdict.ruleId, verdict.verdict]),
  );

const appliedPacks = (context: ComplianceContext) =>
  runCompliance(BUILT_IN_PACKS, context)
    .filter((pack) => pack.applies)
    .map((pack) => pack.code);

describe("built-in packs", () => {
  it("are versioned, reviewed, and every rule has a reference and a fix", () => {
    const ids = BUILT_IN_PACKS.flatMap((pack) => pack.rules.map((rule) => rule.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of BUILT_IN_PACKS) {
      expect(pack.version).toMatch(/^\d{4}\.\d+$/);
      expect(pack.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const rule of pack.rules) {
        expect(rule.reference.length).toBeGreaterThan(5);
        expect(rule.fix.length).toBeGreaterThan(10);
        // Patterns must compile; a broken one would silently never match.
        for (const source of [
          ...(rule.check.require ?? []),
          ...(rule.check.forbid ?? []),
        ]) {
          expect(() => new RegExp(source, "i")).not.toThrow();
        }
      }
    }
  });

  it("serialise to JSON and back without loss", () => {
    for (const pack of BUILT_IN_PACKS) {
      expect(JSON.parse(JSON.stringify(pack))).toEqual(pack);
    }
  });
});

describe("applicability", () => {
  it("applies DPDP to a contract that processes personal data, not to an NDA that only mentions it", () => {
    expect(appliedPacks(contextFor("services-agreement"))).toContain("DPDP");
    expect(appliedPacks(contextFor("mutual-nda"))).not.toContain("DPDP");
  });

  it("applies the Contract Act and stamp duty to every contract, arbitration only when provided for", () => {
    const nda = appliedPacks(contextFor("mutual-nda"));
    expect(nda).toEqual(expect.arrayContaining(["ICA", "STAMP", "ARB"]));
    expect(appliedPacks(contextFor("employment-agreement"))).not.toContain("ARB");
  });

  it("applies GDPR or CCPA only when the contract points to them", () => {
    const india = contextFor("services-agreement");
    expect(appliedPacks(india)).not.toContain("GDPR");
    expect(appliedPacks(india)).not.toContain("CCPA");
    expect(
      appliedPacks({ ...india, governingLaw: "laws of England and Wales" }),
    ).toContain("GDPR");
    expect(
      appliedPacks({ ...india, governingLaw: "laws of the State of California" }),
    ).toContain("CCPA");
  });
});

describe("verdicts on the sample contracts", () => {
  it("fails the post-termination non-compete under s. 27 and cites it", () => {
    const context = contextFor("employment-agreement");
    const rule = ICA.rules.find((r) => r.id === "ica.s27-restraint-of-trade")!;
    const verdict = evaluateRule(ICA, rule, context);

    expect(verdict).toMatchObject({
      verdict: "fail",
      packCode: "ICA",
      packVersion: ICA.version,
    });
    expect(verdict.quotedText).toMatch(/24 months after the termination of employment/);
    expect(context.clauses[verdict.clauseOrdinal!].text).toContain(verdict.quotedText!);
  });

  it("checks the services agreement's data clause against the DPDP Act", () => {
    const verdicts = verdictsOf(contextFor("services-agreement"));
    expect(verdicts).toMatchObject({
      "dpdp.purpose-limitation": "pass",
      "dpdp.security-safeguards": "pass",
      "dpdp.breach-notification": "pass",
      "dpdp.erasure": "fail", // the clause says nothing about erasure
      "ica.s27-restraint-of-trade": "fail",
      "ica.s124-indemnity": "warn",
      "stamp.duty-addressed": "warn",
    });
  });

  it("passes the balanced NDA on everything that applies", () => {
    const verdicts = Object.values(verdictsOf(contextFor("mutual-nda")));
    expect(verdicts.length).toBeGreaterThan(5);
    expect(verdicts.every((verdict) => verdict === "pass")).toBe(true);
  });

  it("flags a sole arbitrator chosen by one party, and an arbitration with no seat", () => {
    const text =
      "1. Arbitration\nAll disputes shall be referred to a sole arbitrator appointed by the Company.";
    const context: ComplianceContext = {
      text,
      governingLaw: null,
      clauses: [{ ordinal: 0, type: "dispute_resolution", heading: "Arbitration", text }],
    };
    expect(verdictsOf(context)).toMatchObject({
      "arb.unilateral-appointment": "fail",
      "arb.seat": "warn",
    });
  });

  it("every cited quote is in the clause it names", () => {
    for (const name of ["services-agreement", "employment-agreement", "mutual-nda"]) {
      const context = contextFor(name);
      for (const verdict of runCompliance(BUILT_IN_PACKS, context).flatMap(
        (p) => p.verdicts,
      )) {
        if (verdict.quotedText === null) continue;
        expect(context.clauses[verdict.clauseOrdinal!].text).toContain(
          verdict.quotedText,
        );
      }
    }
  });

  it("agrees with the rule engine on the non-compete", () => {
    expect(
      RULES.some((rule) => rule.id === "restrictions.post-termination-non-compete"),
    ).toBe(true);
  });
});

describe("internal policies", () => {
  const pack = (rules: RulePack["rules"]): RulePack => ({
    code: "INTERNAL",
    name: "Internal policies",
    version: "1",
    reviewedOn: "2026-11-11",
    applicability: { always: true, description: "" },
    rules,
  });

  it("turns plain phrases into literal patterns", () => {
    const pattern = new RegExp(phraseToPattern("payable within (30) days"), "i");
    expect(pattern.test("Payable  within\n(30) days")).toBe(true);
    expect(pattern.test("payable within 30 days")).toBe(false);
  });

  it("fails a contract that uses a forbidden phrase, citing it", () => {
    const rule = policyToRule("internal.test", {
      title: "No auto-renewal",
      description: "We do not sign contracts that renew themselves.",
      mode: "forbid",
      phrases: ["renew automatically"],
      clauseType: null,
      severity: "fail",
      category: "renewal",
      fix: "",
    });
    const [result] = runCompliance([pack([rule])], contextFor("services-agreement"));

    expect(result.verdicts[0]).toMatchObject({
      verdict: "fail",
      reference: "Internal policy",
    });
    expect(result.verdicts[0].quotedText).toMatch(/renew automatically/);
    expect(
      runCompliance([pack([rule])], contextFor("mutual-nda"))[0].verdicts[0].verdict,
    ).toBe("pass");
  });

  it("warns when a required phrase is missing from the named clause type", () => {
    const rule = policyToRule("internal.test2", {
      title: "Insurance certificate",
      description: "Suppliers must show insurance.",
      mode: "require",
      phrases: ["certificate of insurance"],
      clauseType: "insurance",
      severity: "warn",
      category: "liability",
      fix: "Ask for a certificate.",
    });
    const [result] = runCompliance([pack([rule])], contextFor("services-agreement"));
    expect(result.verdicts[0]).toMatchObject({ verdict: "warn", quotedText: null });
  });

  it("ignores a malformed stored pattern instead of failing the review", () => {
    const broken = pack([
      {
        id: "internal.broken",
        title: "Broken",
        reference: "Internal policy",
        description: "x",
        category: "liability",
        fix: "x",
        check: { forbid: ["(unclosed"] },
      },
    ]);
    expect(runCompliance([broken], contextFor("mutual-nda"))[0].verdicts[0].verdict).toBe(
      "pass",
    );
  });
});
