import { asc, count, desc, eq } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { Clause, Contract, Entity, Job } from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

const { contracts, clauses, entities, jobs, auditLog } = schema;

/**
 * All contract reads and writes. Every function takes a tenant-scoped
 * transaction, so row-level security decides what it can see: there is no
 * org filter to forget.
 */

export type NewContract = {
  id: string;
  orgId: string;
  createdBy: string;
  title: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileHash: string;
};

/** Creates the contract, queues its analysis job and records the upload. */
export async function createContract(
  tx: OrgTx,
  input: NewContract,
): Promise<{ contract: Contract; job: Job }> {
  const [contract] = await tx
    .insert(contracts)
    .values({
      id: input.id,
      orgId: input.orgId,
      createdBy: input.createdBy,
      title: input.title,
      blobUrl: input.storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      fileHash: input.fileHash,
    })
    .returning();

  const [job] = await tx
    .insert(jobs)
    .values({ orgId: input.orgId, contractId: contract.id, kind: "analyze" })
    .returning();

  await tx.insert(auditLog).values({
    orgId: input.orgId,
    actorId: input.createdBy,
    action: "contract.uploaded",
    target: `contract:${contract.id}`,
    diff: { title: input.title, fileName: input.fileName, sizeBytes: input.sizeBytes },
  });

  return { contract, job };
}

export type ContractListItem = Pick<
  Contract,
  "id" | "title" | "status" | "fileName" | "pageCount" | "createdAt"
> & { clauseCount: number };

export async function listContracts(tx: OrgTx): Promise<ContractListItem[]> {
  const rows = await tx
    .select({
      id: contracts.id,
      title: contracts.title,
      status: contracts.status,
      fileName: contracts.fileName,
      pageCount: contracts.pageCount,
      createdAt: contracts.createdAt,
      clauseCount: count(clauses.id),
    })
    .from(contracts)
    .leftJoin(clauses, eq(clauses.contractId, contracts.id))
    .groupBy(contracts.id)
    .orderBy(desc(contracts.createdAt));
  return rows;
}

export type ClauseOutline = Pick<
  Clause,
  "id" | "ordinal" | "number" | "heading" | "type" | "startOffset" | "endOffset"
>;

export type EntitySummary = Pick<
  Entity,
  "id" | "kind" | "label" | "value" | "normalized" | "clauseId"
>;

export type ContractDetail = {
  contract: Contract;
  clauses: ClauseOutline[];
  entities: EntitySummary[];
  job: Job | null;
};

export async function getContract(tx: OrgTx, id: string): Promise<ContractDetail | null> {
  const [contract] = await tx.select().from(contracts).where(eq(contracts.id, id));
  if (!contract) return null;

  const outline = await tx
    .select({
      id: clauses.id,
      ordinal: clauses.ordinal,
      number: clauses.number,
      heading: clauses.heading,
      type: clauses.type,
      startOffset: clauses.startOffset,
      endOffset: clauses.endOffset,
    })
    .from(clauses)
    .where(eq(clauses.contractId, id))
    .orderBy(asc(clauses.ordinal));

  const found = await tx
    .select({
      id: entities.id,
      kind: entities.kind,
      label: entities.label,
      value: entities.value,
      normalized: entities.normalized,
      clauseId: entities.clauseId,
    })
    .from(entities)
    .where(eq(entities.contractId, id));

  return {
    contract,
    clauses: outline,
    entities: found,
    job: await getLatestJob(tx, id),
  };
}

export async function getLatestJob(tx: OrgTx, contractId: string): Promise<Job | null> {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.contractId, contractId))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return job ?? null;
}

/** A job that has not moved for this long is treated as dead and may be replaced. */
const STALE_JOB_MS = 10 * 60 * 1000;

/**
 * Queues a fresh analysis of an existing contract. Returns "busy" while an
 * earlier job is still genuinely in progress, so two runs never overlap.
 */
export async function createAnalysisJob(
  tx: OrgTx,
  input: { contractId: string; actorId: string },
): Promise<Job | "not-found" | "busy"> {
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(eq(contracts.id, input.contractId));
  if (!contract) return "not-found";

  const latest = await getLatestJob(tx, input.contractId);
  const active = latest && (latest.status === "queued" || latest.status === "running");
  if (active && Date.now() - latest.updatedAt.getTime() < STALE_JOB_MS) return "busy";

  const [job] = await tx
    .insert(jobs)
    .values({ orgId: contract.orgId, contractId: contract.id, kind: "analyze" })
    .returning();
  await tx
    .update(contracts)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(contracts.id, contract.id));
  await tx.insert(auditLog).values({
    orgId: contract.orgId,
    actorId: input.actorId,
    action: "contract.reanalysed",
    target: `contract:${contract.id}`,
  });
  return job;
}
