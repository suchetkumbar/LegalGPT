import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tenant isolation.
 *
 * Every request-scoped query runs inside `withOrg()` (see ./index.ts), which
 * switches to the `app_user` role and sets `app.org_id` for the transaction.
 * The policies below then restrict every table to that one org. The role is
 * created in a hand-written migration because the connection owner on Neon
 * bypasses row-level security.
 */
export const appUser = pgRole("app_user").existing();

const currentOrgId = sql`nullif(current_setting('app.org_id', true), '')::uuid`;

export const userRole = pgEnum("user_role", ["admin", "reviewer", "viewer"]);

export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkOrgId: text("clerk_org_id").notNull().unique(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("free"),
    // Data-residency region. India first; the Vercel function region is bom1.
    region: text("region").notNull().default("in"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("orgs_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.id} = ${currentOrgId}`,
      withCheck: sql`${t.id} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per membership: the same person can belong to several orgs.
    uniqueIndex("users_org_clerk_user_idx").on(t.orgId, t.clerkUserId),
    pgPolicy("users_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Null for system actions (webhooks, cron). Kept when the user is removed.
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target").notNull(),
    diff: jsonb("diff"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_at_idx").on(t.orgId, t.at),
    // Append-only: select and insert policies only, so update and delete are denied.
    pgPolicy("audit_log_select", {
      for: "select",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
    }),
    pgPolicy("audit_log_insert", {
      for: "insert",
      to: appUser,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type AuditLogEntry = typeof auditLog.$inferSelect;
