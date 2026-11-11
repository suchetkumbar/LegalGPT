import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import { createContract } from "@/lib/contracts/queries";
import * as schema from "@/lib/db/schema";
import { runAsOrg } from "@/lib/db/tenant";
import {
  deleteAllContracts,
  deleteContract,
  findDuplicate,
  purgeExpired,
  setRetention,
} from "@/lib/privacy/retention";
import { hit } from "@/lib/security/rate-limit";

const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });
let orgA: string;
let orgB: string;
let userA: string;

async function addContract(orgId: string, fileHash = "hash", createdAt?: Date) {
  const id = randomUUID();
  await runAsOrg(db, orgId, (tx) =>
    createContract(tx, {
      id,
      orgId,
      createdBy: orgId === orgA ? userA : null!,
      title: "c",
      storageKey: `${orgId}/${id}/original.txt`,
      fileName: "c.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileHash,
    }),
  );
  await db
    .update(schema.contracts)
    .set({ status: "ready", ...(createdAt ? { createdAt } : {}) })
    .where(eq(schema.contracts.id, id));
  return id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [a, b] = await db
    .insert(schema.orgs)
    .values([
      { clerkOrgId: "a", name: "Org A" },
      { clerkOrgId: "b", name: "Org B" },
    ])
    .returning();
  orgA = a.id;
  orgB = b.id;
  const [u] = await db
    .insert(schema.users)
    .values({ orgId: orgA, clerkUserId: "u", email: "a@example.com", role: "admin" })
    .returning();
  userA = u.id;
});

describe("tenant isolation covers every table", () => {
  it("has row-level security on every table, and a policy on every tenant table", async () => {
    const tables = await db.execute<{ tablename: string; rowsecurity: boolean }>(
      sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
    );
    const policies = await db.execute<{ tablename: string }>(
      sql`select distinct tablename from pg_policies where schemaname = 'public'`,
    );
    const withPolicy = new Set(policies.rows.map((r) => r.tablename));

    expect(tables.rows.length).toBeGreaterThanOrEqual(17);
    for (const table of tables.rows) {
      expect(table.rowsecurity, `${table.tablename} has row-level security`).toBe(true);
      // rate_limits is a system table: RLS on with no policy denies the app role entirely.
      if (table.tablename !== "rate_limits") {
        expect(
          withPolicy.has(table.tablename),
          `${table.tablename} has a tenant policy`,
        ).toBe(true);
      }
    }
  });

  it("denies the application role any access to the rate-limit table", async () => {
    await expect(
      runAsOrg(db, orgA, (tx) => tx.select().from(schema.rateLimits)),
    ).resolves.toEqual([]);
    await expect(
      runAsOrg(db, orgA, (tx) =>
        tx
          .insert(schema.rateLimits)
          .values({ key: "x", windowStart: new Date(), count: 1 }),
      ),
    ).rejects.toThrow();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit in a window, then refuses with a retry time, then resets", async () => {
    const rule = { limit: 3, windowSeconds: 600 };
    const now = new Date("2026-11-12T10:01:00Z");
    for (let i = 0; i < 3; i++)
      expect(await hit(db, "ai:user1", rule, now)).toEqual({ ok: true });
    expect(await hit(db, "ai:user1", rule, now)).toEqual({ ok: false, retryAfter: 540 });
    // Other users are counted separately.
    expect(await hit(db, "ai:user2", rule, now)).toEqual({ ok: true });
    // The next window starts afresh.
    expect(await hit(db, "ai:user1", rule, new Date("2026-11-12T10:10:00Z"))).toEqual({
      ok: true,
    });
  });
});

describe("deletion and retention", () => {
  it("deletes a contract and what depends on it, audits it, and detaches later versions", async () => {
    const first = await addContract(orgA);
    const second = await addContract(orgA);
    await db
      .update(schema.contracts)
      .set({ parentId: first })
      .where(eq(schema.contracts.id, second));

    // Another organisation cannot delete it.
    expect(
      await runAsOrg(db, orgB, (tx) =>
        deleteContract(tx, { contractId: first, actorId: null, reason: "x" }),
      ),
    ).toBeNull();

    const result = await runAsOrg(db, orgA, (tx) =>
      deleteContract(tx, {
        contractId: first,
        actorId: userA,
        reason: "deleted by a user",
      }),
    );
    expect(result?.storageKey).toBe(`${orgA}/${first}/original.txt`);
    expect(
      await db.select().from(schema.contracts).where(eq(schema.contracts.id, first)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.jobs).where(eq(schema.jobs.contractId, first)),
    ).toEqual([]);
    const [later] = await db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.id, second));
    expect(later.parentId).toBeNull();
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.target, `contract:${first}`));
    expect(audit.map((a) => a.action)).toContain("contract.deleted");
  });

  it("purges only contracts past their own organisation's retention period", async () => {
    const old = await addContract(orgA, "h1", new Date("2026-01-01T00:00:00Z"));
    const recent = await addContract(orgA, "h2", new Date("2026-11-01T00:00:00Z"));
    const otherOrgOld = await addContract(orgB, "h3", new Date("2026-01-01T00:00:00Z"));
    await runAsOrg(db, orgA, (tx) =>
      setRetention(tx, { orgId: orgA, days: 90, actorId: userA }),
    );

    const removed: string[] = [];
    const result = await purgeExpired(
      db,
      async (key) => void removed.push(key),
      new Date("2026-11-12T00:00:00Z"),
    );

    expect(result.deleted).toBe(1);
    expect(removed).toEqual([`${orgA}/${old}/original.txt`]);
    const left = (
      await db.select({ id: schema.contracts.id }).from(schema.contracts)
    ).map((r) => r.id);
    expect(left).toContain(recent);
    expect(left).toContain(otherOrgOld); // Org B keeps everything
    expect(left).not.toContain(old);
  });

  it("deletes all of an organisation's contracts on request, and nobody else's", async () => {
    await addContract(orgA, "h4");
    const keys = await runAsOrg(db, orgA, (tx) => deleteAllContracts(tx, userA));
    expect(keys.length).toBeGreaterThan(0);
    expect(await runAsOrg(db, orgA, (tx) => tx.select().from(schema.contracts))).toEqual(
      [],
    );
    expect(
      (await runAsOrg(db, orgB, (tx) => tx.select().from(schema.contracts))).length,
    ).toBeGreaterThan(0);
  });
});

describe("duplicate uploads", () => {
  it("finds an analysed contract with the same file, within the organisation only", async () => {
    const id = await addContract(orgA, "same-file");
    expect(
      await runAsOrg(db, orgA, (tx) => findDuplicate(tx, "same-file")),
    ).toMatchObject({ id });
    expect(await runAsOrg(db, orgB, (tx) => findDuplicate(tx, "same-file"))).toBeNull();
    expect(await runAsOrg(db, orgA, (tx) => findDuplicate(tx, "other-file"))).toBeNull();
  });
});
