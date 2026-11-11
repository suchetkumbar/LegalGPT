import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

type Schema = typeof schema;

export type OrgTx = PgTransaction<
  PgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Driver-independent core of `withOrg`, kept separate so the row-level
 * security tests can run it against an in-process Postgres.
 *
 * Both settings are transaction-local, so a pooled connection never carries
 * one tenant's identity into the next request.
 */
export function runAsOrg<Q extends PgQueryResultHKT, T>(
  db: PgDatabase<Q, Schema>,
  orgId: string,
  fn: (tx: OrgTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(orgId)) throw new Error("withOrg: orgId must be a UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`set local role app_user`);
    return fn(tx as unknown as OrgTx);
  });
}
