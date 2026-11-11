import { asc, eq, sql } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

import type { PipelineAi, TokenUsage } from "./ai";
import { classifySegments } from "./classify";
import { extractEntities, pickCounterparty } from "./extract";
import { detectFileKind } from "./file-type";
import { DocumentError, parseDocument } from "./parse";
import { segmentContract, type Segment } from "./segment";

const { contracts, clauses, entities, jobs, orgs } = schema;

/**
 * The `analyze` job: parse → segment → classify → extract → embed.
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
] as const;
export type AnalyzeStage = (typeof ANALYZE_STAGES)[number];

/** Stages that need a model. If one fails, the rule-based clauses are still usable. */
const MODEL_STAGES: ReadonlySet<string> = new Set(["classify", "extract", "embed"]);

export type AnalysisDeps = {
  /** Runs a callback in a transaction limited to the contract's org. */
  scope: <T>(fn: (tx: OrgTx) => Promise<T>) => Promise<T>;
  readFile: (key: string) => Promise<Uint8Array>;
  ai: PipelineAi;
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
  async parse({ scope, readFile }, { contractId }) {
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
    const parsed = await parseDocument(bytes, kind);

    await scope((tx) =>
      tx
        .update(contracts)
        .set({ text: parsed.text, pageCount: parsed.pageCount, updatedAt: new Date() })
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
): Promise<{ stage: string; error: string }> {
  let stage = "parse";
  let message = GENERIC_FAILURE;
  try {
    await deps.scope(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, ids.jobId));
      if (!job) return;
      stage = job.stage === "queued" ? "parse" : job.stage;
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
        .set({ status: "failed", error: message, updatedAt: new Date() })
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

/** Runs every stage in order, in this process. */
export async function runAnalysis(
  deps: AnalysisDeps,
  ids: AnalysisIds,
): Promise<AnalysisResult> {
  try {
    for (const stage of ANALYZE_STAGES) await runStage(deps, ids, stage);
    await completeAnalysis(deps, ids);
    return { ok: true };
  } catch (error) {
    return { ok: false, ...(await failAnalysis(deps, ids, error)) };
  }
}
