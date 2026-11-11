/**
 * Risk detection evaluation: `npm run eval:risk`. Offline, free, no keys.
 * Scores the rule engine on 30 generated contracts with planted risks.
 * Exits non-zero if a gate from the project plan is missed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RISK_GATES, scoreRiskSet } from "./risk";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const score = scoreRiskSet();

console.log(`Risk detection (rules only), ${score.contracts} generated contracts\n`);
console.log(
  `High-severity recall:    ${pct(score.recall)}  (${score.plantedFound} of ${score.planted} planted risks found; need ${pct(RISK_GATES.recall)})`,
);
console.log(
  `High-severity precision: ${pct(score.precision)}  (${score.highCorrect} of ${score.highFindings} high findings genuine; need ${pct(RISK_GATES.precision)})`,
);

const missedByRisk = new Map<string, number>();
for (const miss of score.missed)
  missedByRisk.set(miss.risk, (missedByRisk.get(miss.risk) ?? 0) + 1);
if (missedByRisk.size) {
  console.log("\nPlanted risks the rules missed (times):");
  for (const [risk, count] of missedByRisk)
    console.log(`  ${String(count).padStart(2)}  ${risk}`);
}

const unexpectedByRule = new Map<string, { count: number; quote: string | null }>();
for (const item of score.unexpected) {
  const entry = unexpectedByRule.get(item.ruleId) ?? { count: 0, quote: item.quote };
  entry.count += 1;
  unexpectedByRule.set(item.ruleId, entry);
}
if (unexpectedByRule.size) {
  console.log("\nHigh-severity findings that were not planted (times, first quote):");
  for (const [ruleId, entry] of unexpectedByRule) {
    console.log(
      `  ${String(entry.count).padStart(2)}  ${ruleId}\n        ${(entry.quote ?? "(absent clause)").slice(0, 110)}`,
    );
  }
}

mkdirSync(path.join("evals", "reports"), { recursive: true });
writeFileSync(
  path.join("evals", "reports", "risk-rules.json"),
  `${JSON.stringify({ gates: RISK_GATES, ...score, missed: undefined, unexpected: undefined }, null, 2)}\n`,
);

const ok = score.recall >= RISK_GATES.recall && score.precision >= RISK_GATES.precision;
console.log(`\nGates: ${ok ? "PASS" : "FAIL"}`);
if (!ok) process.exit(1);
