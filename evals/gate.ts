/**
 * The evaluation gate CI runs on every change: `npm run eval:gate`.
 *
 * Recomputes the offline evaluations (rule-based segmentation and risk
 * detection, no model calls) and fails if any metric has fallen more than
 * 3 points below the committed baseline, as the plan requires. Raise the
 * baseline deliberately, by editing evals/baseline.json, when a change
 * improves a metric.
 */
import { readFileSync } from "node:fs";

import { segmentContract } from "@/lib/pipeline/segment";

import { generateEvalSet } from "./generator/generate";
import { scoreContract, totalScores } from "./metrics";
import { scoreRiskSet } from "./risk";

const TOLERANCE = 0.03;

const baseline = JSON.parse(readFileSync("evals/baseline.json", "utf8")) as Record<
  string,
  number
>;

const set = generateEvalSet();
const scores = set.map((gold) =>
  scoreContract(
    gold,
    segmentContract(gold.text).map((s) => ({ startOffset: s.startOffset, type: null })),
  ),
);
const pick = (noisy: boolean) =>
  totalScores(scores.filter((_, i) => set[i].noisy === noisy));
const risk = scoreRiskSet();

const current: Record<string, number> = {
  "segmentation.f1": totalScores(scores).f1,
  "segmentation.clean.f1": pick(false).f1,
  "segmentation.noisy.f1": pick(true).f1,
  "risk.recall": risk.recall,
  "risk.precision": risk.precision,
};

let failed = false;
console.log("metric                     baseline  current");
for (const [metric, value] of Object.entries(current)) {
  const expected = baseline[metric];
  const ok = expected === undefined || value >= expected - TOLERANCE;
  if (!ok) failed = true;
  console.log(
    `${metric.padEnd(26)} ${expected === undefined ? "   (new)" : (expected * 100).toFixed(1).padStart(7) + "%"} ${(value * 100).toFixed(1).padStart(7)}%  ${ok ? "ok" : "REGRESSED"}`,
  );
}
if (failed) {
  console.error(
    `\nA metric fell more than ${TOLERANCE * 100} points below the baseline.`,
  );
  process.exit(1);
}
console.log("\nEvaluation gate passed.");
