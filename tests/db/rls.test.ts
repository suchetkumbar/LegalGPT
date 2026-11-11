import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";
import { runAsOrg } from "@/lib/db/tenant";

const { orgs, users, auditLog } = schema;

const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });

let orgA: string;
let orgB: string;

beforeAll(async () => {
  // Applies the real migration files, so the policies under test are the shipped ones.
  await migrate(db, { migrationsFolder: "./drizzle" });

  const inserted = await db
    .insert(orgs)
    .values([
      { clerkOrgId: "org_a", name: "Acme Legal LLP" },
      { clerkOrgId: "org_b", name: "Bharat Traders Pvt Ltd" },
    ])
    .returning();
  orgA = inserted[0].id;
  orgB = inserted[1].id;

  await db.insert(users).values([
    { orgId: orgA, clerkUserId: "user_a", email: "a@example.com", role: "admin" },
    { orgId: orgB, clerkUserId: "user_b", email: "b@example.com", role: "admin" },
  ]);
  await db.insert(auditLog).values([
    { orgId: orgA, action: "org.created", target: "org" },
    { orgId: orgB, action: "org.created", target: "org" },
  ]);
});

describe("row-level security", () => {
  it("shows an org only its own rows", async () => {
    const seen = await runAsOrg(db, orgA, async (tx) => ({
      orgs: await tx.select().from(orgs),
      users: await tx.select().from(users),
      audit: await tx.select().from(auditLog),
    }));

    expect(seen.orgs.map((o) => o.id)).toEqual([orgA]);
    expect(seen.users.map((u) => u.clerkUserId)).toEqual(["user_a"]);
    expect(seen.audit.map((a) => a.orgId)).toEqual([orgA]);
  });

  it("returns nothing when another org's rows are requested by id", async () => {
    const rows = await runAsOrg(db, orgA, (tx) =>
      tx.select().from(users).where(eq(users.orgId, orgB)),
    );
    expect(rows).toEqual([]);
  });

  it("rejects inserting a row into another org", async () => {
    await expect(
      runAsOrg(db, orgA, (tx) =>
        tx
          .insert(users)
          .values({ orgId: orgB, clerkUserId: "intruder", email: "x@example.com" }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete another org's rows", async () => {
    await runAsOrg(db, orgA, async (tx) => {
      await tx.update(users).set({ role: "viewer" }).where(eq(users.orgId, orgB));
      await tx.delete(users).where(eq(users.orgId, orgB));
    });

    const [b] = await db.select().from(users).where(eq(users.orgId, orgB));
    expect(b.role).toBe("admin");
  });

  it("keeps the audit log append-only for the application role", async () => {
    await runAsOrg(db, orgA, (tx) =>
      tx.insert(auditLog).values({ orgId: orgA, action: "test.append", target: "x" }),
    );

    await expect(
      runAsOrg(db, orgA, (tx) => tx.delete(auditLog).where(eq(auditLog.orgId, orgA))),
    ).rejects.toThrow();
    await expect(
      runAsOrg(db, orgA, (tx) =>
        tx.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.orgId, orgA)),
      ),
    ).rejects.toThrow();
  });

  it("does not leak the tenant identity past the transaction", async () => {
    await runAsOrg(db, orgA, (tx) => tx.select().from(orgs));
    const all = await db.select().from(orgs);
    expect(all).toHaveLength(2);
  });

  it("refuses an org id that is not a UUID", () => {
    expect(() => runAsOrg(db, "'; drop table orgs; --", async () => null)).toThrow();
  });
});
