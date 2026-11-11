import { eq } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

import { getContract, type ContractDetail } from "./queries";

/** A contract with each clause's text cut from the stored contract text. */
export type FullContract = ContractDetail & {
  clauseTexts: Map<string, string>;
};

export async function getFullContract(
  tx: OrgTx,
  id: string,
): Promise<FullContract | null> {
  const detail = await getContract(tx, id);
  if (!detail) return null;
  const text = detail.contract.text ?? "";
  const clauseTexts = new Map(
    detail.clauses.map((clause) => [
      clause.id,
      text.slice(clause.startOffset, clause.endOffset),
    ]),
  );
  return { ...detail, clauseTexts };
}

/** Earlier and later versions of a contract, oldest first. */
export async function listVersions(tx: OrgTx, id: string) {
  const all = await tx
    .select({
      id: schema.contracts.id,
      title: schema.contracts.title,
      version: schema.contracts.version,
      parentId: schema.contracts.parentId,
      createdAt: schema.contracts.createdAt,
      riskScore: schema.contracts.riskScore,
    })
    .from(schema.contracts);
  const byId = new Map(all.map((row) => [row.id, row]));
  // Walk up to the first version, then collect everything descended from it.
  let root = byId.get(id);
  while (root?.parentId && byId.has(root.parentId)) root = byId.get(root.parentId);
  if (!root) return [];
  const family = new Set([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parentId && family.has(row.parentId) && !family.has(row.id)) {
        family.add(row.id);
        grew = true;
      }
    }
  }
  return all
    .filter((row) => family.has(row.id))
    .sort(
      (a, b) => a.version - b.version || a.createdAt.getTime() - b.createdAt.getTime(),
    );
}

export async function parentVersion(tx: OrgTx, parentId: string) {
  const [parent] = await tx
    .select({
      id: schema.contracts.id,
      version: schema.contracts.version,
      title: schema.contracts.title,
    })
    .from(schema.contracts)
    .where(eq(schema.contracts.id, parentId));
  return parent ?? null;
}
