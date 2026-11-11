import { describe, expect, it } from "vitest";

import { generateContract, generateEvalSet, STYLES } from "@/evals/generator/generate";
import { scoreContract, totalScores } from "@/evals/metrics";
import { isClauseType } from "@/lib/pipeline/clause-types";
import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";

const set = generateEvalSet();

const rulesOnly = (noisy: boolean) =>
  totalScores(
    set
      .filter((gold) => gold.noisy === noisy)
      .map((gold) =>
        scoreContract(
          gold,
          segmentContract(gold.text).map((s) => ({
            startOffset: s.startOffset,
            type: null,
          })),
        ),
      ),
  );

describe("evaluation set", () => {
  it("has 30 contracts: 20 clean and 10 noisy, three per numbering style", () => {
    expect(set).toHaveLength(30);
    expect(set.filter((gold) => gold.noisy)).toHaveLength(10);
    expect(new Set(set.map((gold) => gold.id)).size).toBe(30);
    for (const style of STYLES) {
      expect(set.filter((gold) => gold.style === style.id)).toHaveLength(3);
    }
  });

  it("is deterministic: the same seed gives the same contract", () => {
    expect(generateContract(4242, STYLES[0], true)).toEqual(
      generateContract(4242, STYLES[0], true),
    );
    expect(generateContract(4242, STYLES[0]).text).not.toBe(
      generateContract(4243, STYLES[0]).text,
    );
  });

  it("has well-formed gold labels", () => {
    for (const gold of set) {
      // Offsets are only meaningful against the text the pipeline will see.
      expect(normaliseText(gold.text)).toBe(gold.text);
      expect(gold.clauses[0]).toMatchObject({ start: 0, type: "preamble" });

      let previous = -1;
      for (const clause of gold.clauses) {
        expect(isClauseType(clause.type)).toBe(true);
        expect(clause.start).toBeGreaterThan(previous);
        expect(clause.start).toBeLessThan(gold.text.length);
        previous = clause.start;
      }
    }
  });
});

describe("rule-based segmentation on the evaluation set", () => {
  it("gets every boundary right on cleanly formatted contracts", () => {
    const clean = rulesOnly(false);
    expect(clean.f1).toBe(1);
    expect(clean.gold).toBeGreaterThan(300);
  });

  it("does not get worse on damaged contracts, which the model pass must repair", () => {
    // Measured at 89.5% when this was written. Rules cannot find a clause that
    // starts mid-line; this floor only guards against regressions.
    const noisy = rulesOnly(true);
    expect(noisy.f1).toBeGreaterThan(0.85);
    expect(noisy.f1).toBeLessThan(0.95);
  });
});

describe("scoreContract", () => {
  const gold = {
    id: "x",
    style: "s",
    kind: "k",
    noisy: false,
    text: "",
    clauses: [
      { start: 0, type: "preamble" as const, label: "Preamble" },
      { start: 50, type: "payment" as const, label: "1" },
      { start: 90, type: "termination" as const, label: "2" },
    ],
  };

  it("counts exact boundaries only, and a missed boundary as a wrong type", () => {
    const score = scoreContract(gold, [
      { startOffset: 0, type: "preamble" },
      { startOffset: 50, type: "taxes" },
      { startOffset: 91, type: "termination" }, // one character off
    ]);

    expect(score).toMatchObject({ gold: 3, predicted: 3, matched: 2, typed: 1 });
    expect(score.missed).toEqual(["2"]);
    expect(score.spurious).toEqual([91]);
    expect(score.wrongType).toEqual([
      { label: "1", gold: "payment", predicted: "taxes" },
    ]);

    const totals = totalScores([score]);
    expect(totals.precision).toBeCloseTo(2 / 3);
    expect(totals.recall).toBeCloseTo(2 / 3);
    expect(totals.typeAccuracy).toBeCloseTo(1 / 3);
  });
});
