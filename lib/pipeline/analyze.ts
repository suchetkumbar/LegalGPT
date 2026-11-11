import { and, asc, eq, sql } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

import type { PipelineAi, TokenUsage } from "./ai";
import type { ClauseType } from "./clause-types";
import { assessContract } from "./assess";
import { classifySegments } from "./classify";
import { extractEntities, pickCounterparty } from "./extract";
import { detectFileKind } from "./file-type";
import type { OcrFunction } from "./ocr";
import { DocumentError, parseDocument } from "./parse";
import { segmentContract, type Segment } from "./segment";
import { runRules } from "@/lib/rules";
import { ensurePlaybook } from "@/lib/playbook/queries";
import { rescoreContract } from "@/lib/scoring/rescore";

const { contracts, clauses, entities, findings, jobs, orgs } = schema;

/**
 * The `analyze` job: parse → segment → classify → extract → embed → review → assess.
 *
 * Each stage reads what it needs from the database and writes its own output,
 * so stages can be retried one at a time and nothing confidential has to be
 * passed between them. The same stage functions run inline (`runAnalysis`) and
 * as steps on the background job runner (inngest/functions/analyze.ts).
 */
export const ANALYZE_STAGES = [
  "parse",
  "segment",
  "classify",
  "extract",
  "embed",
  "review",
  "assess",
] as const;
export type AnalyzeStage = (typeof ANALYZE_STAGES)[number];

/** Stages that need a model. If one fails, the rule-based clauses are still usable. */
const MODEL_STAGES: ReadonlySet<string> = new Set([
  "classify",
  "extract",
  "embed",
  "assess",
]);

export type AnalysisDeps = {
  /** Runs a callback in a transaction limited to the contract's org. */
  scope: <T>(fn: (tx: OrgTx) => Promise<T>) => Promise<T>;
  readFile: (key: string) => Promise<Uint8Array>;
  ai: PipelineAi;
  /** Reads scanned PDFs. Defaults to Tesseract; tests pass a fake. */
  ocr?: OcrFunction;
};

export type AnalysisIds = { contractId: string; jobId: string };

export type AnalysisResult = { ok: true } | { ok: false; stage: string; error: string };

const GENERIC_FAILURE = "Something went wrong while processing this document.";
const MODEL_FAILURE =
  "The AI step could not finish, most likely because the free model quota is used up for now. " +
  "The clauses were found by rules only, so types and key details may be missing. Try again later.";

/** Clause text sent for embedding is capped; the model has an input limit. */
const MAX_EMBED_CHARS = 6_000;

/** A provider may omit a count; never let that reach an integer column. */
const count = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0);

function addUsage(tx: OrgTx, jobId: string, usage: TokenUsage) {
  return tx
    .update(jobs)
    .set({
      tokensIn: sql`${jobs.tokensIn} + ${count(usage.tokensIn)}`,
      tokensOut: sql`${jobs.tokensOut} + ${count(usage.tokensOut)}`,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

async function loadText(tx: OrgTx, contractId: string) {
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId));
  if (!contract) throw new Error("Contract not found");
  if (contract.text === null) throw new Error("Contract has not been parsed");
  return { contract, text: contract.text };
}

function loadClauses(tx: OrgTx, contractId: string) {
  return tx
    .select()
    .from(clauses)
    .where(eq(clauses.contractId, contractId))
    .orderBy(asc(clauses.ordinal));
}

/** Replaces a contract's clauses, so a re-run never leaves earlier ones behind. */
async function replaceClauses(
  tx: OrgTx,
  contract: { id: string; orgId: string },
  segments: (Segment & { type?: string | null })[],
) {
  await tx.delete(clauses).where(eq(clauses.contractId, contract.id));
  if (segments.length === 0) return;
  await tx.insert(clauses).values(
    segments.map((segment) => ({
      orgId: contract.orgId,
      contractId: contract.id,
      ordinal: segment.ordinal,
      number: segment.number,
      heading: segment.heading,
      text: segment.text,
      type: segment.type ?? null,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
    })),
  );
}

const STAGES: Record<
  AnalyzeStage,
  (deps: AnalysisDeps, ids: AnalysisIds) => Promise<void>
> = {
  async parse({ scope, readFile, ocr }, { contractId, jobId }) {
    const contract = await scope(async (tx) => {
      const [row] = await tx.select().from(contracts).where(eq(contracts.id, contractId));
      if (!row) throw new Error("Contract not found");
      await tx
        .update(contracts)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(contracts.id, contractId));
      return row;
    });

    const bytes = await readFile(contract.blobUrl);
    const kind = detectFileKind(bytes, contract.fileName);
    if (!kind) throw new DocumentError("This file type is not supported.");
    const parsed = await parseDocument(bytes, kind, {
      ocr,
      // OCR takes seconds per page; say so rather than appear stuck on "reading".
      onOcrStart: async () => {
        await scope((tx) =>
          tx
            .update(jobs)
            .set({ stage: "ocr", updatedAt: new Date() })
            .where(eq(jobs.id, jobId)),
        );
      },
    });

    await scope((tx) =>
      tx
        .update(contracts)
        .set({
          text: parsed.text,
          pageCount: parsed.pageCount,
          ocrUsed: parsed.ocr,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, contractId)),
    );
  },

  async segment({ scope }, { contractId }) {
    await scope(async (tx) => {
      const { contract, text } = await loadText(tx, contractId);
      await replaceClauses(tx, contract, segmentContract(text));
    });
  },

  async classify({ scope, ai }, { contractId, jobId }) {
    const { contract, text, rows } = await scope(async (tx) => ({
      ...(await loadText(tx, contractId)),
      rows: await loadClauses(tx, contractId),
    }));
    if (rows.length === 0) return;

    const result = await classifySegments(ai, text, rows);

    await scope(async (tx) => {
      await replaceClauses(tx, contract, result.segments);
      await addUsage(tx, jobId, result.usage);
    });
  },

  async extract({ scope, ai }, { contractId, jobId }) {
    const { contract, text, rows, orgName } = await scope(async (tx) => {
      const loaded = await loadText(tx, contractId);
      const [org] = await tx
        .select()
        .from(orgs)
        .where(eq(orgs.id, loaded.contract.orgId));
      return {
        ...loaded,
        rows: await loadClauses(tx, contractId),
        orgName: org?.name ?? "",
      };
    });

    const result = await extractEntities(ai, text);
    const parties = result.entities.filter((e) => e.kind === "party").map((e) => e.value);

    await scope(async (tx) => {
      await tx.delete(entities).where(eq(entities.contractId, contractId));
      if (result.entities.length > 0) {
        await tx.insert(entities).values(
          result.entities.map((entity) => ({
            orgId: contract.orgId,
            contractId,
            clauseId:
              rows.find(
                (row) =>
                  entity.offset >= row.startOffset && entity.offset < row.endOffset,
              )?.id ?? null,
            kind: entity.kind,
            label: entity.label,
            value: entity.value,
            normalized: entity.normalized,
          })),
        );
      }
      await tx
        .update(contracts)
        .set({
          type: result.contractType,
          counterparty: pickCounterparty(orgName, parties),
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, contractId));
      await addUsage(tx, jobId, result.usage);
    });
  },

  async embed({ scope, ai }, { contractId, jobId }) {
    const rows = await scope((tx) => loadClauses(tx, contractId));
    if (rows.length === 0) return;

    const texts = rows.map((row) =>
      // The heading gives a short sub-clause the context it lacks on its own.
      [row.heading, row.text].filter(Boolean).join("\n").slice(0, MAX_EMBED_CHARS),
    );
    const result = await ai.embed(texts);
    if (result.embeddings.length !== rows.length) {
      throw new Error("Embedding count does not match clause count");
    }

    await scope(async (tx) => {
      for (const [index, row] of rows.entries()) {
        await tx
          .update(clauses)
          .set({ embedding: result.embeddings[index] })
          .where(eq(clauses.id, row.id));
      }
      await addUsage(tx, jobId, result.usage);
    });
  },

  /**
   * The rule engine and the risk score. Needs no model, so it runs even when
   * the model stages could not: a contract always gets its rule findings.
   */
  async review({ scope }, { contractId }) {
    await scope(async (tx) => {
      const { contract, text } = await loadText(tx, contractId);
      const rows = await loadClauses(tx, contractId);

      const results = runRules({
        text,
        contractType: contract.type,
        clauses: rows.map((row) => ({
          ordinal: row.ordinal,
          type: row.type as ClauseType | null,
          heading: row.heading,
          text: row.text,
        })),
      });

      // A re-run must not undo a reviewer's decisions: carry each one over to
      // the same finding (same rule, same quoted words) in the new set.
      const previous = await tx
        .select()
        .from(findings)
        .where(and(eq(findings.contractId, contractId), eq(findings.source, "rule")));
      const key = (ruleId: string | null, quote: string | null) =>
        `${ruleId}|${quote ?? ""}`;
      const decided = new Map(
        previous
          .filter((finding) => finding.status !== "open")
          .map((finding) => [key(finding.ruleId, finding.quotedText), finding]),
      );

      await tx
        .delete(findings)
        .where(and(eq(findings.contractId, contractId), eq(findings.source, "rule")));
      if (results.length > 0) {
        await tx.insert(findings).values(
          results.map((result) => {
            const earlier = decided.get(key(result.ruleId, result.quotedText));
            return {
              orgId: contract.orgId,
              contractId,
              clauseId:
                result.clauseOrdinal === null
                  ? null
                  : (rows.find((row) => row.ordinal === result.clauseOrdinal)?.id ??
                    null),
              kind: "risk" as const,
              source: "rule" as const,
              ruleId: result.ruleId,
              title: result.title,
              category: result.category,
              clauseType: result.clauseType,
              severity: result.severity,
              likelihood: result.likelihood,
              quotedText: result.quotedText,
              reasoning: result.reasoning,
              suggestedFix: result.suggestedFix,
              status: earlier?.status ?? ("open" as const),
              reviewedBy: earlier?.reviewedBy ?? null,
              reviewedAt: earlier?.reviewedAt ?? null,
            };
          }),
        );
      }

      await rescoreContract(tx, contractId);
    });
  },

  /**
   * The judgment pass: one reasoning-tier call that re-scores the rule
   * findings in context, reports material deviations from the playbook, and
   * writes the summary.
   */
  async assess({ scope, ai }, { contractId, jobId }) {
    const loaded = await scope(async (tx) => {
      const { contract } = await loadText(tx, contractId);
      const [org] = await tx.select().from(orgs).where(eq(orgs.id, contract.orgId));
      return {
        contract,
        orgName: org?.name ?? "",
        rows: await loadClauses(tx, contractId),
        positions: (await ensurePlaybook(tx, contract.orgId)).positions,
        rules: await tx
          .select()
          .from(findings)
          .where(and(eq(findings.contractId, contractId), eq(findings.source, "rule")))
          .orderBy(asc(findings.createdAt), asc(findings.id)),
      };
    });
    const { contract, rows, rules } = loaded;
    if (rows.length === 0) return;

    const result = await assessContract(ai, {
      clauses: rows,
      positions: loaded.positions,
      ruleFindings: rules.map((finding, index) => ({
        index,
        title: finding.title,
        severity: finding.severity,
        likelihood: finding.likelihood,
        quotedText: finding.quotedText,
      })),
      // Only known when one party is recognisably the organisation itself.
      perspective: contract.counterparty ? loaded.orgName : null,
    });

    await scope(async (tx) => {
      for (const judgment of result.judgments) {
        const finding = rules[judgment.index];
        await tx
          .update(findings)
          .set({
            severity: judgment.severity,
            likelihood: judgment.likelihood,
            reasoning: judgment.note
              ? `${finding.reasoning} In this contract: ${judgment.note}`
              : finding.reasoning,
            model: result.modelId,
            usedFallback: result.usedFallback,
            updatedAt: new Date(),
          })
          .where(eq(findings.id, finding.id));
      }

      // Replace earlier model findings, keeping a reviewer's decision on the
      // same deviation (same clause type, same quoted words).
      const previous = await tx
        .select()
        .from(findings)
        .where(and(eq(findings.contractId, contractId), eq(findings.source, "model")));
      const key = (type: string | null, quote: string | null) => `${type}|${quote ?? ""}`;
      const decided = new Map(
        previous
          .filter((finding) => finding.status !== "open")
          .map((finding) => [key(finding.clauseType, finding.quotedText), finding]),
      );
      await tx
        .delete(findings)
        .where(and(eq(findings.contractId, contractId), eq(findings.source, "model")));
      if (result.deviations.length > 0) {
        await tx.insert(findings).values(
          result.deviations.map((deviation) => {
            const earlier = decided.get(key(deviation.clauseType, deviation.quotedText));
            return {
              orgId: contract.orgId,
              contractId,
              clauseId:
                rows.find((row) => row.ordinal === deviation.clauseOrdinal)?.id ?? null,
              kind: "deviation" as const,
              source: "model" as const,
              title: deviation.title,
              category: deviation.category,
              clauseType: deviation.clauseType,
              severity: deviation.severity,
              likelihood: deviation.likelihood,
              quotedText: deviation.quotedText,
              reasoning: deviation.reasoning,
              suggestedFix: deviation.suggestedFix,
              model: result.modelId,
              usedFallback: result.usedFallback,
              status: earlier?.status ?? ("open" as const),
              reviewedBy: earlier?.reviewedBy ?? null,
              reviewedAt: earlier?.reviewedAt ?? null,
            };
          }),
        );
      }

      await tx
        .update(contracts)
        .set({ summary: result.summary || null, updatedAt: new Date() })
        .where(eq(contracts.id, contractId));
      await addUsage(tx, jobId, result.usage);
      await rescoreContract(tx, contractId);
    });
  },
};

/** Runs one stage, recording it on the job first so progress and failures name it. */
export async function runStage(
  deps: AnalysisDeps,
  ids: AnalysisIds,
  stage: AnalyzeStage,
): Promise<void> {
  await deps.scope((tx) =>
    tx
      .update(jobs)
      .set({ stage, status: "running", updatedAt: new Date() })
      .where(eq(jobs.id, ids.jobId)),
  );
  await STAGES[stage](deps, ids);
}

export async function completeAnalysis(
  deps: AnalysisDeps,
  ids: AnalysisIds,
): Promise<void> {
  await deps.scope(async (tx) => {
    await tx
      .update(jobs)
      .set({ stage: "done", status: "succeeded", error: null, updatedAt: new Date() })
      .where(eq(jobs.id, ids.jobId));
    await tx
      .update(contracts)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(contracts.id, ids.contractId));
  });
}

/**
 * Records a failure against whichever stage the job was in. If the document
 * itself could not be read, the contract is failed. If only a model stage
 * failed, the contract stays usable with its rule-based clauses.
 */
export async function failAnalysis(
  deps: AnalysisDeps,
  ids: AnalysisIds,
  error: unknown,
  /** The stage that failed, when later stages have run since. */
  failedStage?: AnalyzeStage,
): Promise<{ stage: string; error: string }> {
  let stage: string = failedStage ?? "parse";
  let message = GENERIC_FAILURE;
  try {
    await deps.scope(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, ids.jobId));
      if (!job) return;
      // "ocr" is a label within the parse stage, not a stage of its own.
      if (!failedStage) {
        stage = job.stage === "queued" || job.stage === "ocr" ? "parse" : job.stage;
      }
      // Already recorded (the job runner reports a failure twice): keep the first message.
      if (job.status === "failed") {
        message = job.error ?? message;
        return;
      }
      const modelStage = MODEL_STAGES.has(stage);

      // Only messages written for users are shown to them; anything else
      // could expose internals, so it is logged and replaced.
      message =
        error instanceof DocumentError
          ? error.message
          : modelStage
            ? MODEL_FAILURE
            : GENERIC_FAILURE;

      await tx
        .update(jobs)
        .set({ stage, status: "failed", error: message, updatedAt: new Date() })
        .where(eq(jobs.id, ids.jobId));
      await tx
        .update(contracts)
        .set({ status: modelStage ? "ready" : "failed", updatedAt: new Date() })
        .where(eq(contracts.id, ids.contractId));
    });
  } catch (secondary) {
    console.error("[pipeline] could not record the failure:", secondary);
  }
  if (!(error instanceof DocumentError)) {
    console.error(
      `[pipeline] analyze failed at ${stage} for contract ${ids.contractId}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return { stage, error: message };
}

export function isModelStage(stage: string): boolean {
  return MODEL_STAGES.has(stage);
}

/**
 * Runs every stage in order, in this process. If a model stage fails, the
 * remaining model stages are skipped but the stages that need no model still
 * run, so the contract ends up with its rule findings and score.
 */
export async function runAnalysis(
  deps: AnalysisDeps,
  ids: AnalysisIds,
): Promise<AnalysisResult> {
  let modelFailure: { stage: AnalyzeStage; error: unknown } | null = null;
  try {
    for (const stage of ANALYZE_STAGES) {
      if (modelFailure && isModelStage(stage)) continue;
      try {
        await runStage(deps, ids, stage);
      } catch (error) {
        if (!isModelStage(stage)) throw error;
        modelFailure = { stage, error };
      }
    }
    if (modelFailure) {
      const failure = await failAnalysis(
        deps,
        ids,
        modelFailure.error,
        modelFailure.stage,
      );
      return { ok: false, ...failure };
    }
    await completeAnalysis(deps, ids);
    return { ok: true };
  } catch (error) {
    return { ok: false, ...(await failAnalysis(deps, ids, error)) };
  }
}
