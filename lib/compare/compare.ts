import { diffWords } from "diff";

import { runRules } from "@/lib/rules";
import type { RuleClause } from "@/lib/rules/types";

/**
 * Version comparison. Clauses are aligned by clause type and wording rather
 * than by number, so a renumbered or moved clause still pairs with its
 * earlier version. Each change is then marked favourable, unfavourable or
 * neutral by running the rule engine on both versions of the clause: a change
 * that introduces a known risk is unfavourable, one that removes it is
 * favourable.
 *
 * "Neutral" means the rules saw no difference in risk, not that the change
 * does not matter. A reviewer still needs to read every change.
 */

export type CompareClause = {
  id: string;
  ordinal: number;
  number: string | null;
  heading: string | null;
  type: string | null;
  text: string;
};

export type Assessment = "unchanged" | "favourable" | "unfavourable" | "neutral";

export type DiffPart = { text: string; added?: boolean; removed?: boolean };

export type ClauseChange = {
  before: CompareClause | null;
  after: CompareClause | null;
  assessment: Assessment;
  /** Risks present after the change that were not there before. */
  introduced: string[];
  /** Risks present before the change that are gone after it. */
  resolved: string[];
  diff: DiffPart[];
};

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/^\s*[\d.()a-z]{1,8}\s+/, "")
      .match(/[a-z0-9]+/g) ?? [],
  );

function similarity(a: CompareClause, b: CompareClause): number {
  const x = words(a.text);
  const y = words(b.text);
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  const union = x.size + y.size - shared;
  let score = union ? shared / union : 0;
  if (a.type && a.type === b.type && a.type !== "other") score += 0.3;
  if (a.heading && a.heading === b.heading) score += 0.15;
  return score;
}

const MATCH_THRESHOLD = 0.3;

/** Pairs each new clause with its most likely earlier version. Greedy, best match first. */
export function alignClauses(
  before: CompareClause[],
  after: CompareClause[],
): [CompareClause | null, CompareClause | null][] {
  const candidates: { i: number; j: number; score: number }[] = [];
  for (const [i, old] of before.entries()) {
    for (const [j, now] of after.entries()) {
      const score = similarity(old, now);
      if (score >= MATCH_THRESHOLD) candidates.push({ i, j, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const matchOf = new Map<number, number>(); // after index → before index
  const usedBefore = new Set<number>();
  for (const { i, j } of candidates) {
    if (matchOf.has(j) || usedBefore.has(i)) continue;
    matchOf.set(j, i);
    usedBefore.add(i);
  }

  // Walk the new version in order; slot each removed clause in before the
  // first new clause that matches something later in the old version.
  const pairs: [CompareClause | null, CompareClause | null][] = [];
  const emitted = new Set<number>();
  const emitRemovedBefore = (limit: number) => {
    for (let i = 0; i < limit; i++) {
      if (!usedBefore.has(i) && !emitted.has(i)) {
        pairs.push([before[i], null]);
        emitted.add(i);
      }
    }
  };
  for (const [j, now] of after.entries()) {
    const i = matchOf.get(j);
    if (i !== undefined) emitRemovedBefore(i);
    pairs.push([i === undefined ? null : before[i], now]);
  }
  emitRemovedBefore(before.length);
  return pairs;
}

function risksIn(clause: CompareClause | null): Map<string, string> {
  if (!clause) return new Map();
  const ruleClause: RuleClause = {
    ordinal: 0,
    type: (clause.type as RuleClause["type"]) ?? null,
    heading: clause.heading,
    text: clause.text,
  };
  const found = runRules({ text: clause.text, clauses: [ruleClause] }).filter(
    (finding) => finding.clauseOrdinal !== null,
  );
  return new Map(found.map((finding) => [finding.ruleId, finding.title]));
}

export function compareVersions(
  before: CompareClause[],
  after: CompareClause[],
): ClauseChange[] {
  return alignClauses(before, after).map(([old, now]) => {
    const oldRisks = risksIn(old);
    const newRisks = risksIn(now);
    const introduced = [...newRisks]
      .filter(([id]) => !oldRisks.has(id))
      .map(([, t]) => t);
    const resolved = [...oldRisks].filter(([id]) => !newRisks.has(id)).map(([, t]) => t);

    const sameText =
      old &&
      now &&
      old.text.replace(/\s+/g, " ").trim() === now.text.replace(/\s+/g, " ").trim();
    const assessment: Assessment = sameText
      ? "unchanged"
      : introduced.length > 0
        ? "unfavourable"
        : resolved.length > 0
          ? "favourable"
          : "neutral";

    const diff: DiffPart[] = sameText
      ? [{ text: now!.text }]
      : diffWords(old?.text ?? "", now?.text ?? "").map((part) => ({
          text: part.value,
          ...(part.added ? { added: true } : {}),
          ...(part.removed ? { removed: true } : {}),
        }));

    return { before: old, after: now, assessment, introduced, resolved, diff };
  });
}

export function summariseChanges(changes: ClauseChange[]) {
  const count = (assessment: Assessment) =>
    changes.filter((change) => change.assessment === assessment).length;
  return {
    unchanged: count("unchanged"),
    favourable: count("favourable"),
    unfavourable: count("unfavourable"),
    neutral: count("neutral"),
    added: changes.filter((change) => !change.before).length,
    removed: changes.filter((change) => !change.after).length,
  };
}
