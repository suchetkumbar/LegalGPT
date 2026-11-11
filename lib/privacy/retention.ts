import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

const { contracts, orgs, auditLog } = schema;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, any>;

export const RETENTION_CHOICES = [30, 90, 365] as const;

/**
 * Deletes one contract and everything derived from it (clauses, findings,
 * entities, obligations, comments and jobs go by cascade). Returns the
 * storage key so the caller can delete the file. The audit log keeps a record
 * that it existed and who deleted it, but not its content.
 */
export async function deleteContract(
  tx: OrgTx,
  input: { contractId: string; actorId: string | null; reason: string },
): Promise<{ storageKey: string } | null> {
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(eq(contracts.id, input.contractId));
  if (!contract) return null;
  // Later versions point at this one; detach them rather than delete them.
  await tx
    .update(contracts)
    .set({ parentId: null })
    .where(eq(contracts.parentId, contract.id));
  await tx.delete(contracts).where(eq(contracts.id, contract.id));
  await tx.insert(auditLog).values({
    orgId: contract.orgId,
    actorId: input.actorId,
    action: "contract.deleted",
    target: `contract:${contract.id}`,
    diff: { title: contract.title, reason: input.reason },
  });
  return { storageKey: contract.blobUrl };
}

/** Every contract in the organisation. Used by "delete all data". */
export async function deleteAllContracts(tx: OrgTx, actorId: string): Promise<string[]> {
  const all = await tx.select({ id: contracts.id }).from(contracts);
  const keys: string[] = [];
  for (const { id } of all) {
    const deleted = await deleteContract(tx, {
      contractId: id,
      actorId,
      reason: "organisation data deleted",
    });
    if (deleted) keys.push(deleted.storageKey);
  }
  return keys;
}

/**
 * The daily retention sweep, across organisations (owner connection). Finds
 * contracts older than their organisation's retention period.
 */
export async function expiredContracts(db: AnyDb, now = new Date()) {
  return db
    .select({ id: contracts.id, orgId: contracts.orgId, storageKey: contracts.blobUrl })
    .from(contracts)
    .innerJoin(orgs, eq(orgs.id, contracts.orgId))
    .where(
      and(
        isNotNull(orgs.retentionDays),
        lt(
          contracts.createdAt,
          sql`${now.toISOString()}::timestamptz - make_interval(days => ${orgs.retentionDays})`,
        ),
      ),
    );
}

export async function purgeExpired(
  db: AnyDb,
  removeFile: (key: string) => Promise<void>,
  now = new Date(),
) {
  const expired = await expiredContracts(db, now);
  for (const item of expired) {
    await db.transaction(async (tx) => {
      await tx
        .update(contracts)
        .set({ parentId: null })
        .where(eq(contracts.parentId, item.id));
      await tx.delete(contracts).where(eq(contracts.id, item.id));
      await tx.insert(auditLog).values({
        orgId: item.orgId,
        actorId: null,
        action: "contract.deleted",
        target: `contract:${item.id}`,
        diff: { reason: "retention period ended" },
      });
    });
    await removeFile(item.storageKey).catch(() => {});
  }
  return { deleted: expired.length };
}

export async function setRetention(
  tx: OrgTx,
  input: { orgId: string; days: number | null; actorId: string },
) {
  await tx
    .update(orgs)
    .set({ retentionDays: input.days, updatedAt: new Date() })
    .where(eq(orgs.id, input.orgId));
  await tx.insert(auditLog).values({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "privacy.retention_set",
    target: `org:${input.orgId}`,
    diff: { days: input.days },
  });
}

/** An earlier, analysed upload of the same file, so it need not be analysed (and paid for) again. */
export async function findDuplicate(tx: OrgTx, fileHash: string) {
  const [existing] = await tx
    .select({ id: contracts.id, title: contracts.title })
    .from(contracts)
    .where(and(eq(contracts.fileHash, fileHash), eq(contracts.status, "ready")))
    .limit(1);
  return existing ?? null;
}
