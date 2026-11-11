import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import {
  mapClerkRole,
  removeMembership,
  removeOrg,
  upsertMembership,
  upsertOrg,
} from "@/lib/auth/sync";
import * as schema from "@/lib/db/schema";

const { orgs, users, auditLog } = schema;
const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("mapClerkRole", () => {
  it.each([
    ["org:admin", "admin"],
    ["org:member", "reviewer"],
    ["org:reviewer", "reviewer"],
    ["org:viewer", "viewer"],
    ["org:something_else", "viewer"],
    [null, "viewer"],
    [undefined, "viewer"],
  ])("maps %s to %s", (clerkRole, expected) => {
    expect(mapClerkRole(clerkRole)).toBe(expected);
  });
});

describe("Clerk sync", () => {
  it("creates an org once and renames it on a repeat call", async () => {
    const first = await upsertOrg(db, { clerkOrgId: "org_1", name: "Acme" });
    const second = await upsertOrg(db, { clerkOrgId: "org_1", name: "Acme Legal LLP" });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Acme Legal LLP");
    expect(second.region).toBe("in");
    expect(await db.select().from(orgs)).toHaveLength(1);
  });

  it("adds a member once, audits it, and stays quiet when nothing changed", async () => {
    const org = await upsertOrg(db, { clerkOrgId: "org_1", name: "Acme Legal LLP" });
    const input = {
      orgId: org.id,
      clerkUserId: "user_1",
      email: "priya@example.com",
      clerkRole: "org:admin",
    };

    const first = await upsertMembership(db, input);
    const second = await upsertMembership(db, input);

    expect(first.role).toBe("admin");
    expect(second.id).toBe(first.id);
    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, org.id));
    expect(audit.map((a) => a.action)).toEqual(["member.added"]);
  });

  it("records a role change in the audit log", async () => {
    const org = await upsertOrg(db, { clerkOrgId: "org_1", name: "Acme Legal LLP" });
    const updated = await upsertMembership(db, {
      orgId: org.id,
      clerkUserId: "user_1",
      email: "priya@example.com",
      clerkRole: "org:member",
    });

    expect(updated.role).toBe("reviewer");
    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, org.id));
    expect(audit.at(-1)).toMatchObject({
      action: "member.updated",
      diff: { role: ["admin", "reviewer"] },
    });
  });

  it("removes a member but keeps the audit trail", async () => {
    await removeMembership(db, { clerkOrgId: "org_1", clerkUserId: "user_1" });

    expect(await db.select().from(users)).toHaveLength(0);
    const audit = await db.select().from(auditLog);
    expect(audit.at(-1)?.action).toBe("member.removed");
  });

  it("ignores a removal for an org it has never seen", async () => {
    await expect(
      removeMembership(db, { clerkOrgId: "org_unknown", clerkUserId: "user_1" }),
    ).resolves.toBeUndefined();
  });

  it("deletes an org together with its members and audit entries", async () => {
    const org = await upsertOrg(db, { clerkOrgId: "org_2", name: "Gone Pvt Ltd" });
    await upsertMembership(db, {
      orgId: org.id,
      clerkUserId: "user_2",
      email: "arjun@example.com",
    });

    await removeOrg(db, "org_2");

    expect(await db.select().from(users).where(eq(users.orgId, org.id))).toHaveLength(0);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.orgId, org.id)),
    ).toHaveLength(0);
  });
});
