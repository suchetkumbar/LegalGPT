import type { GoldContract } from "./generator/generate";

export type Predicted = { startOffset: number; type: string | null };

export type ContractScore = {
  id: string;
  style: string;
  gold: number;
  predicted: number;
  /** Predicted clause starts that are exactly a gold start. */
  matched: number;
  /** Gold clauses whose boundary was found and whose type is right. */
  typed: number;
  missed: string[];
  spurious: number[];
  wrongType: { label: string; gold: string; predicted: string | null }[];
};

export type Totals = {
  contracts: number;
  gold: number;
  predicted: number;
  matched: number;
  typed: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of all gold clauses that got the right type (a missed boundary counts as wrong). */
  typeAccuracy: number;
};

/**
 * Scores one contract. A boundary counts only if the predicted clause starts
 * at exactly the gold character offset: "nearly right" would still cut a
 * sentence in the wrong place.
 */
export function scoreContract(gold: GoldContract, predicted: Predicted[]): ContractScore {
  const predictedByStart = new Map(predicted.map((p) => [p.startOffset, p]));
  const goldStarts = new Set(gold.clauses.map((clause) => clause.start));

  const score: ContractScore = {
    id: gold.id,
    style: gold.style,
    gold: gold.clauses.length,
    predicted: predicted.length,
    matched: 0,
    typed: 0,
    missed: [],
    spurious: predicted
      .filter((p) => !goldStarts.has(p.startOffset))
      .map((p) => p.startOffset),
    wrongType: [],
  };

  for (const clause of gold.clauses) {
    const hit = predictedByStart.get(clause.start);
    if (!hit) {
      score.missed.push(clause.label);
      continue;
    }
    score.matched += 1;
    if (hit.type === clause.type) score.typed += 1;
    else
      score.wrongType.push({
        label: clause.label,
        gold: clause.type,
        predicted: hit.type,
      });
  }
  return score;
}

export function totalScores(scores: ContractScore[]): Totals {
  const sum = (pick: (score: ContractScore) => number) =>
    scores.reduce((total, score) => total + pick(score), 0);
  const gold = sum((s) => s.gold);
  const predicted = sum((s) => s.predicted);
  const matched = sum((s) => s.matched);
  const typed = sum((s) => s.typed);
  const precision = predicted ? matched / predicted : 0;
  const recall = gold ? matched / gold : 0;
  return {
    contracts: scores.length,
    gold,
    predicted,
    matched,
    typed,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    typeAccuracy: gold ? typed / gold : 0,
  };
}

export function totalsByStyle(scores: ContractScore[]): Record<string, Totals> {
  const groups = new Map<string, ContractScore[]>();
  for (const score of scores) {
    groups.set(score.style, [...(groups.get(score.style) ?? []), score]);
  }
  return Object.fromEntries(
    [...groups].map(([style, group]) => [style, totalScores(group)]),
  );
}

/** Exit gates from the project plan. */
export const GATES = { boundaryF1: 0.95, typeAccuracy: 0.9 };
