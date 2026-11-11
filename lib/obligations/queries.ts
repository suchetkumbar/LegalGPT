import { and, asc, eq, isNotNull } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import type { OrgTx } from "@/lib/db/tenant";

const { obligations, contracts } = schema;

export function listObligations(tx: OrgTx, options: { contractId?: string } = {}) {
  return tx
    .select({
      id: obligations.id,
      contractId: obligations.contractId,
      contractTitle: contracts.title,
      clauseId: obligations.clauseId,
      kind: obligations.kind,
      description: obligations.description,
      dueDate: obligations.dueDate,
      recurrence: obligations.recurrence,
      noticeDays: obligations.noticeDays,
      quotedText: obligations.quotedText,
      remindersSent: obligations.remindersSent,
    })
    .from(obligations)
    .innerJoin(contracts, eq(contracts.id, obligations.contractId))
    .where(
      options.contractId ? eq(obligations.contractId, options.contractId) : undefined,
    )
    .orderBy(asc(obligations.dueDate), asc(contracts.title));
}

export function datedObligations(tx: OrgTx) {
  return tx
    .select({
      id: obligations.id,
      contractId: obligations.contractId,
      contractTitle: contracts.title,
      description: obligations.description,
      dueDate: obligations.dueDate,
      quotedText: obligations.quotedText,
      remindersSent: obligations.remindersSent,
    })
    .from(obligations)
    .innerJoin(contracts, eq(contracts.id, obligations.contractId))
    .where(and(isNotNull(obligations.dueDate)));
}
