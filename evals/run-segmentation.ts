/**
 * Clause segmentation and typing evaluation.
 *
 *   npm run eval:segmentation              rules only: free, offline, no keys
 *   npm run eval:segmentation -- --model   adds the Gemini pass (about one call
 *                                          per contract, on your API key)
 *
 * Options for --model:
 *   --limit N     only the first N contracts
 *   --delay MS    pause between live calls (default 6000, to respect the free
 *                 tier's per-minute limit)
 *
 * Model answers are cached under evals/.cache, so re-running costs nothing
 * unless the contract or the prompt changed. The run stops at the first
 * failed call rather than burning quota on retries.
 *
 * Exits non-zero in --model mode if a gate from the project plan is missed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";

import { segmentContract } from "@/lib/pipeline/segment";

import { generateEvalSet, type GoldContract } from "./generator/generate";
import {
  GATES,
  scoreContract,
  totalScores,
  totalsByStyle,
  type ContractScore,
  type Predicted,
  type Totals,
} from "./metrics";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? Number(args[index + 1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
};

const useModel = flag("model");
const limit = option("limit", Infinity);
const delayMs = option("delay", 6000);

const CACHE_DIR = path.join("evals", ".cache");
const REPORT_DIR = path.join("evals", "reports");
/** Bump when the classify prompt or schema changes, to invalidate cached answers. */
const PROMPT_VERSION = "classify-v1";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(6);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function row(label: string, totals: Totals, withTypes: boolean): string {
  const cells = [
    label.padEnd(22),
    String(totals.gold).padStart(5),
    String(totals.predicted).padStart(5),
    pct(totals.precision),
    pct(totals.recall),
    pct(totals.f1),
  ];
  if (withTypes) cells.push(pct(totals.typeAccuracy));
  return cells.join(" ");
}

/**
 * Why a model call failed, including the provider's own status and message.
 * The router wraps the real error, so dig it out: "all models failed" alone
 * does not say whether it was a rate limit, a timeout or a bad request.
 */
function describeFailure(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    const e = value as {
      name?: string;
      statusCode?: number;
      message?: string;
      cause?: unknown;
      failedAttempts?: { modelId: string; error: unknown }[];
    };
    if (e.failedAttempts?.length) {
      for (const attempt of e.failedAttempts) {
        parts.push(`[${attempt.modelId}]`);
        visit(attempt.error);
      }
      return;
    }
    const status = e.statusCode ? `HTTP ${e.statusCode} ` : "";
    parts.push(`${status}${e.name ?? "Error"}: ${String(e.message).slice(0, 300)}`);
    visit(e.cause);
  };
  visit(error);
  return parts.join(" ");
}

async function predictWithModel(
  gold: GoldContract,
): Promise<{ predicted: Predicted[]; cached: boolean }> {
  const key = createHash("sha256")
    .update(PROMPT_VERSION)
    .update(gold.text)
    .digest("hex")
    .slice(0, 16);
  const file = path.join(CACHE_DIR, `${gold.id}-${key}.json`);
  if (existsSync(file)) {
    return { predicted: JSON.parse(readFileSync(file, "utf8")), cached: true };
  }

  // Imported lazily so the rules-only mode never loads the model client.
  const { pipelineAi } = await import("@/lib/ai/generate");
  const { classifySegments } = await import("@/lib/pipeline/classify");
  const result = await classifySegments(
    pipelineAi,
    gold.text,
    segmentContract(gold.text),
  );
  const predicted = result.segments.map((segment) => ({
    startOffset: segment.startOffset,
    type: segment.type,
  }));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(predicted));
  return { predicted, cached: false };
}

async function main() {
  const set = generateEvalSet().slice(0, limit);
  const scores: ContractScore[] = [];
  const evaluated: GoldContract[] = [];
  let liveCalls = 0;
  let stoppedEarly: string | null = null;

  if (useModel) {
    // One attempt per call and no second model: a failure ends the run.
    process.env.AI_MAX_RETRIES ??= "0";
  }

  for (const gold of set) {
    let predicted: Predicted[];
    if (useModel) {
      try {
        if (liveCalls > 0) await sleep(delayMs);
        const result = await predictWithModel(gold);
        predicted = result.predicted;
        if (!result.cached) liveCalls += 1;
        process.stdout.write(result.cached ? "c" : ".");
      } catch (error) {
        stoppedEarly = `${gold.id}: ${describeFailure(error)}`;
        break;
      }
    } else {
      predicted = segmentContract(gold.text).map((segment) => ({
        startOffset: segment.startOffset,
        type: null,
      }));
    }
    scores.push(scoreContract(gold, predicted));
    evaluated.push(gold);
  }
  if (useModel) process.stdout.write("\n");

  const mode = useModel ? "rules + model" : "rules only";
  console.log(
    `\nClause segmentation: ${mode}, ${scores.length} of ${set.length} contracts`,
  );
  if (useModel) console.log(`Live model calls this run: ${liveCalls}`);
  if (stoppedEarly) console.log(`STOPPED EARLY at ${stoppedEarly}`);
  if (scores.length === 0) process.exit(1);

  const header =
    `\n${"".padEnd(22)}  gold  pred      P      R     F1` + (useModel ? "  types" : "");
  console.log(header);
  for (const [style, totals] of Object.entries(totalsByStyle(scores))) {
    console.log(row(style, totals, useModel));
  }
  console.log("-".repeat(header.length - 1));
  const part = (noisy: boolean) =>
    totalScores(scores.filter((_, index) => evaluated[index].noisy === noisy));
  const clean = part(false);
  const noisy = part(true);
  const all = totalScores(scores);
  console.log(row(`clean (${clean.contracts})`, clean, useModel));
  console.log(row(`noisy (${noisy.contracts})`, noisy, useModel));
  console.log(row(`ALL (${all.contracts})`, all, useModel));

  if (useModel) {
    const confusions = new Map<string, number>();
    for (const score of scores) {
      for (const wrong of score.wrongType) {
        const key = `${wrong.gold} → ${wrong.predicted ?? "none"}`;
        confusions.set(key, (confusions.get(key) ?? 0) + 1);
      }
    }
    const top = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (top.length) {
      console.log("\nMost common type disagreements (gold → predicted):");
      for (const [pair, count] of top)
        console.log(`  ${String(count).padStart(3)}  ${pair}`);
    }
  }

  const worst = scores
    .filter((score) => score.missed.length + score.spurious.length > 0)
    .sort(
      (a, b) =>
        b.missed.length + b.spurious.length - (a.missed.length + a.spurious.length),
    )
    .slice(0, 8);
  if (worst.length) {
    console.log("\nContracts with boundary errors:");
    for (const score of worst) {
      console.log(
        `  ${score.id}: missed ${score.missed.length} [${score.missed.slice(0, 8).join(", ")}${score.missed.length > 8 ? ", ..." : ""}], spurious ${score.spurious.length}`,
      );
    }
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    path.join(REPORT_DIR, `segmentation-${useModel ? "model" : "rules"}.json`),
    `${JSON.stringify(
      {
        mode,
        complete: !stoppedEarly && scores.length === set.length,
        gates: GATES,
        all,
        clean,
        noisy,
        byStyle: totalsByStyle(scores),
      },
      null,
      2,
    )}\n`,
  );

  if (!useModel) {
    console.log(
      "\nRules only: clause types are not assigned, and noisy contracts need the model pass.",
    );
    return;
  }

  const f1Ok = all.f1 >= GATES.boundaryF1;
  const typesOk = all.typeAccuracy >= GATES.typeAccuracy;
  console.log(
    `\nGates: boundary F1 ${pct(all.f1).trim()} (need ${pct(GATES.boundaryF1).trim()}) ${f1Ok ? "PASS" : "FAIL"}; ` +
      `type accuracy ${pct(all.typeAccuracy).trim()} (need ${pct(GATES.typeAccuracy).trim()}) ${typesOk ? "PASS" : "FAIL"}`,
  );
  if (stoppedEarly || !f1Ok || !typesOk) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
