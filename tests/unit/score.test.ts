import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEIGHTS,
  bandFor,
  computeRiskScore,
  isCritical,
  type ScorableFinding,
} from "@/lib/scoring/score";

const finding = (extra: Partial<ScorableFinding> = {}): ScorableFinding => ({
  severity: 3,
  likelihood: 3,
  clauseType: "payment",
  category: "payment",
  status: "open",
  ...extra,
});

const totalWeight = Object.values(DEFAULT_WEIGHTS).reduce((sum, w) => sum + (w ?? 0), 0);

describe("computeRiskScore", () => {
  it("is zero for a contract with no findings", () => {
    const result = computeRiskScore([]);
    expect(result).toMatchObject({
      score: 0,
      band: "low",
      floorApplied: false,
      counted: 0,
    });
    expect(Object.values(result.byCategory).every((value) => value === 0)).toBe(true);
  });

  it("follows the plan's formula: 100 x sum(s x l x w) / (25 x sum of weights)", () => {
    const findings = [
      finding({ severity: 4, likelihood: 3, clauseType: "payment" }), // 12 x 1.5
      finding({ severity: 3, likelihood: 4, clauseType: "limitation_of_liability" }), // 12 x 2
      finding({ severity: 2, likelihood: 2, clauseType: "notices" }), // 4 x 0.4
    ];
    const expected = Math.round((100 * (18 + 24 + 1.6)) / (25 * totalWeight));

    expect(computeRiskScore(findings).score).toBe(expected);
  });

  it("weights the 20 clause types a playbook covers", () => {
    expect(Object.keys(DEFAULT_WEIGHTS)).toHaveLength(20);
  });

  it("weights a clause type outside the playbook as 1, and a missing type too", () => {
    const listed = computeRiskScore([finding({ clauseType: "payment" })]).score;
    const unlisted = computeRiskScore([
      finding({ clauseType: "stamp_duty_and_costs" }),
    ]).score;
    const none = computeRiskScore([finding({ clauseType: null })]).score;
    expect(unlisted).toBe(none);
    expect(listed).toBeGreaterThanOrEqual(unlisted);
  });

  it("puts a floor of 70 under any contract with a critical finding", () => {
    const critical = finding({
      severity: 5,
      likelihood: 4,
      clauseType: "indemnity",
      category: "liability",
    });
    const result = computeRiskScore([critical]);

    expect(result).toMatchObject({ score: 70, band: "high", floorApplied: true });
    // Severity 5 with likelihood 3 is serious but not critical.
    expect(computeRiskScore([{ ...critical, likelihood: 3 }]).score).toBeLessThan(70);
    expect(isCritical({ severity: 5, likelihood: 4 })).toBe(true);
    expect(isCritical({ severity: 4, likelihood: 5 })).toBe(false);
  });

  it("never exceeds 100", () => {
    const many = Array.from({ length: 200 }, () =>
      finding({
        severity: 5,
        likelihood: 5,
        clauseType: "indemnity",
        category: "liability",
      }),
    );
    const result = computeRiskScore(many);
    expect(result.score).toBe(100);
    expect(result.band).toBe("critical");
    expect(result.floorApplied).toBe(false);
    expect(result.byCategory.liability).toBe(100);
  });

  it("ignores dismissed findings but counts open and accepted ones", () => {
    const critical = finding({ severity: 5, likelihood: 5, clauseType: "indemnity" });
    expect(computeRiskScore([{ ...critical, status: "dismissed" }])).toMatchObject({
      score: 0,
      counted: 0,
    });
    expect(computeRiskScore([{ ...critical, status: "accepted" }]).score).toBe(70);
    expect(computeRiskScore([{ ...critical, status: "open" }]).score).toBe(70);
  });

  it("breaks the score down by category", () => {
    const result = computeRiskScore([
      finding({
        severity: 4,
        likelihood: 3,
        clauseType: "termination",
        category: "termination",
      }),
      finding({ severity: 2, likelihood: 2, clauseType: "payment", category: "payment" }),
    ]);

    // Termination: 12 x 1.5 against a category weight of 1.5 → 48.
    expect(result.byCategory.termination).toBe(48);
    // Payment: 4 x 1.5 against payment (1.5) + taxes (1) → 10.
    expect(result.byCategory.payment).toBe(10);
    expect(result.byCategory.data).toBe(0);
  });

  it("accepts a custom set of weights", () => {
    const heavy = computeRiskScore([finding()], { payment: 5 });
    const light = computeRiskScore([finding()], { payment: 5, termination: 5 });
    expect(heavy.score).toBeGreaterThan(light.score);
  });
});

describe("bandFor", () => {
  it.each([
    [0, "low"],
    [29, "low"],
    [30, "medium"],
    [59, "medium"],
    [60, "high"],
    [79, "high"],
    [80, "critical"],
    [100, "critical"],
  ])("%i is %s", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});
