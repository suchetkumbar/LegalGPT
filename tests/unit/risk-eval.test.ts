import { describe, expect, it } from "vitest";

import { PLANTED_RISKS, RISK_GATES, buildRiskSet, scoreRiskSet } from "@/evals/risk";
import { RULES } from "@/lib/rules";

describe("risk evaluation set", () => {
  const cases = buildRiskSet();

  it("has 30 contracts, each with planted high-severity risks", () => {
    expect(cases).toHaveLength(30);
    expect(cases.every((item) => item.planted.length >= 1)).toBe(true);
    // Deterministic: building it again gives the same cases.
    expect(buildRiskSet().map((item) => item.id)).toEqual(cases.map((item) => item.id));
  });

  it("plants only risks that a high-severity detector is meant to catch", () => {
    for (const risk of PLANTED_RISKS) {
      const rule = RULES.find((candidate) => candidate.id === risk.expect);
      expect(rule, risk.expect).toBeDefined();
      expect(rule!.severity).toBeGreaterThanOrEqual(4);
    }
  });

  it("meets the plan's gates for high-severity recall and precision", () => {
    const score = scoreRiskSet(cases);
    expect(score.recall).toBeGreaterThanOrEqual(RISK_GATES.recall);
    expect(score.precision).toBeGreaterThanOrEqual(RISK_GATES.precision);
  });
});
