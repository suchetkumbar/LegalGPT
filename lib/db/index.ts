import "server-only";

import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";
import { runAsOrg, type OrgTx } from "./tenant";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

let cached: ReturnType<typeof createDb> | undefined;

/**
 * Owner connection. It bypasses row-level security, so use it only for
 * cross-tenant system work (Clerk sync, webhooks, cron). Request handlers
 * should use `withOrg` instead.
 */
export function adminDb() {
  return (cached ??= createDb());
}

/** Run `fn` in a transaction that can only see and write the given org's rows. */
export function withOrg<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>): Promise<T> {
  return runAsOrg(adminDb(), orgId, fn);
}

export async function pingDb(): Promise<void> {
  await adminDb().execute(sql`select 1`);
}

export { schema };
export type { OrgTx };
