import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";
import type { Org, User, UserRole } from "@/lib/db/schema";

const { orgs, users, auditLog } = schema;

/**
 * Mirrors Clerk organisations and memberships into Postgres. Called from the
 * Clerk webhook and, as a safety net, on first page load (webhooks can lag or
 * be unconfigured in local development). Every function is idempotent.
 *
 * These run on the owner connection because they act across tenants.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Clerk's built-in roles are org:admin and org:member. Custom org:reviewer and
 * org:viewer roles map directly once they are created in the Clerk dashboard.
 * Unknown roles get the least privilege.
 */
export function mapClerkRole(clerkRole: string | null | undefined): UserRole {
  switch (clerkRole?.replace(/^org:/, "")) {
    case "admin":
      return "admin";
    case "member":
    case "reviewer":
      return "reviewer";
    default:
      return "viewer";
  }
}

export async function upsertOrg(
  db: Db,
  input: { clerkOrgId: string; name: string },
): Promise<Org> {
  const [org] = await db
    .insert(orgs)
    .values(input)
    .onConflictDoUpdate({
      target: orgs.clerkOrgId,
      set: { name: input.name, updatedAt: new Date() },
    })
    .returning();
  return org;
}

export async function upsertMembership(
  db: Db,
  input: { orgId: string; clerkUserId: string; email: string; clerkRole?: string | null },
): Promise<User> {
  const role = mapClerkRole(input.clerkRole);
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, input.orgId), eq(users.clerkUserId, input.clerkUserId)));

  if (existing && existing.role === role && existing.email === input.email) {
    return existing;
  }

  const [user] = await db
    .insert(users)
    .values({
      orgId: input.orgId,
      clerkUserId: input.clerkUserId,
      email: input.email,
      role,
    })
    .onConflictDoUpdate({
      target: [users.orgId, users.clerkUserId],
      set: { email: input.email, role, updatedAt: new Date() },
    })
    .returning();

  await db.insert(auditLog).values({
    orgId: input.orgId,
    actorId: null,
    action: existing ? "member.updated" : "member.added",
    target: `user:${user.id}`,
    diff: existing
      ? { role: [existing.role, role], email: [existing.email, input.email] }
      : { role, email: input.email },
  });

  return user;
}

export async function removeMembership(
  db: Db,
  input: { clerkOrgId: string; clerkUserId: string },
): Promise<void> {
  const [org] = await db.select().from(orgs).where(eq(orgs.clerkOrgId, input.clerkOrgId));
  if (!org) return;

  const removed = await db
    .delete(users)
    .where(and(eq(users.orgId, org.id), eq(users.clerkUserId, input.clerkUserId)))
    .returning();

  for (const user of removed) {
    await db.insert(auditLog).values({
      orgId: org.id,
      actorId: null,
      action: "member.removed",
      target: `user:${user.id}`,
      diff: { role: user.role, email: user.email },
    });
  }
}

/** Deletes the org and, by cascade, everything it owns. */
export async function removeOrg(db: Db, clerkOrgId: string): Promise<void> {
  await db.delete(orgs).where(eq(orgs.clerkOrgId, clerkOrgId));
}

export async function findOrgByClerkId(db: Db, clerkOrgId: string): Promise<Org | null> {
  const [org] = await db.select().from(orgs).where(eq(orgs.clerkOrgId, clerkOrgId));
  return org ?? null;
}
