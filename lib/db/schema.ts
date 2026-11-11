import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
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
    // Monthly ceiling on model tokens. Null means no limit.
    monthlyTokenBudget: integer("monthly_token_budget"),
    // Contracts older than this many days are deleted by the daily sweep. Null keeps them.
    retentionDays: integer("retention_days"),
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

/**
 * Embedding width. gemini-embedding-001 can return 768, 1536 or 3072
 * dimensions; 768 keeps the index small and is within pgvector's HNSW limit.
 */
export const EMBEDDING_DIMENSIONS = 768;

export const contractStatus = pgEnum("contract_status", [
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Contract type (NDA, MSA, ...) and counterparty are filled in by extraction.
    type: text("type"),
    counterparty: text("counterparty"),
    // Which party the organisation is, chosen by a reviewer. Sets whose side
    // the judgment pass takes.
    ourParty: text("our_party"),
    status: contractStatus("status").notNull().default("uploaded"),
    // Storage key of the original file, not a public URL.
    blobUrl: text("blob_url").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    fileHash: text("file_hash").notNull(),
    // Normalised plain text. Clause offsets index into this string.
    text: text("text"),
    pageCount: integer("page_count"),
    // True when the text was read from a scan by OCR, so it may contain misreads.
    ocrUsed: boolean("ocr_used").notNull().default(false),
    // Earlier version of the same contract, if any.
    parentId: uuid("parent_id").references((): AnyPgColumn => contracts.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    riskScore: integer("risk_score"),
    // Review workflow: draft → in_review → approved → signed.
    workflowStatus: text("workflow_status").notNull().default("in_review"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    bulkScanId: uuid("bulk_scan_id"),
    // Executive summary written by the model pass.
    summary: text("summary"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_org_created_idx").on(t.orgId, t.createdAt),
    pgPolicy("contracts_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const clauses = pgTable(
  "clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    // The label as printed in the document, such as "4.2" or "Schedule A".
    number: text("number"),
    heading: text("heading"),
    text: text("text").notNull(),
    // Clause type, assigned by classification. Null until then.
    type: text("type"),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    uniqueIndex("clauses_contract_ordinal_idx").on(t.contractId, t.ordinal),
    // Full-text search for "ask the contract", alongside the vector index.
    index("clauses_fts_idx").using("gin", sql`to_tsvector('english', ${t.text})`),
    index("clauses_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    pgPolicy("clauses_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const entityKind = pgEnum("entity_kind", [
  "party",
  "date",
  "amount",
  "law",
  "jurisdiction",
  "term",
]);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    // The clause the supporting quote was found in.
    clauseId: uuid("clause_id").references(() => clauses.id, { onDelete: "set null" }),
    kind: entityKind("kind").notNull(),
    // A party's role ("Client"), or a field name such as "effective_date".
    label: text("label").notNull(),
    value: text("value").notNull(),
    // Machine-readable form where one exists: { iso } or { amount, currency }.
    normalized: jsonb("normalized"),
  },
  (t) => [
    index("entities_contract_idx").on(t.contractId),
    pgPolicy("entities_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Bumped on every edit, so a report can say which version it was checked against.
    version: integer("version").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("playbooks_org_idx").on(t.orgId),
    pgPolicy("playbooks_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const playbookPositions = pgTable(
  "playbook_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    clauseType: text("clause_type").notNull(),
    standardText: text("standard_text").notNull(),
    fallbackText: text("fallback_text"),
    walkaway: text("walkaway"),
    riskWeight: real("risk_weight").notNull().default(1),
  },
  (t) => [
    uniqueIndex("playbook_positions_type_idx").on(t.playbookId, t.clauseType),
    pgPolicy("playbook_positions_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

/**
 * An organisation's own compliance rules (the INTERNAL pack). Built-in packs
 * live in code (lib/compliance/packs.ts); only org-written ones are stored.
 */
export const rulePacks = pgTable(
  "rule_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    rules: jsonb("rules")
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rule_packs_org_code_idx").on(t.orgId, t.code),
    pgPolicy("rule_packs_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const complianceVerdict = pgEnum("compliance_verdict", ["pass", "warn", "fail"]);

export const complianceResults = pgTable(
  "compliance_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    packCode: text("pack_code").notNull(),
    // The pack version the verdict was made with, so old reports stay traceable.
    packVersion: text("pack_version").notNull(),
    ruleId: text("rule_id").notNull(),
    title: text("title").notNull(),
    reference: text("reference").notNull(),
    verdict: complianceVerdict("verdict").notNull(),
    clauseId: uuid("clause_id").references(() => clauses.id, { onDelete: "set null" }),
    quotedText: text("quoted_text"),
    explanation: text("explanation").notNull(),
    fix: text("fix"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("compliance_results_contract_idx").on(t.contractId),
    pgPolicy("compliance_results_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const findingKind = pgEnum("finding_kind", ["risk", "deviation", "compliance"]);
export const findingSource = pgEnum("finding_source", ["rule", "model"]);
export const findingStatus = pgEnum("finding_status", ["open", "accepted", "dismissed"]);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    // The clause the quote is in. Null when the finding is that something is
    // missing from the contract, or while clauses are being rebuilt.
    clauseId: uuid("clause_id").references(() => clauses.id, { onDelete: "set null" }),
    kind: findingKind("kind").notNull(),
    source: findingSource("source").notNull(),
    // The detector that produced it, for rule findings.
    ruleId: text("rule_id"),
    title: text("title").notNull(),
    category: text("category").notNull(),
    // The clause type used to weight the finding in the risk score.
    clauseType: text("clause_type"),
    severity: integer("severity").notNull(),
    likelihood: integer("likelihood").notNull(),
    // Verbatim from the contract. Null only for a "missing clause" finding.
    quotedText: text("quoted_text"),
    reasoning: text("reasoning").notNull(),
    suggestedFix: text("suggested_fix"),
    // The model that produced or judged it, and whether that was a fallback model.
    model: text("model"),
    usedFallback: boolean("used_fallback").notNull().default(false),
    status: findingStatus("status").notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("findings_contract_idx").on(t.contractId),
    pgPolicy("findings_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const obligations = pgTable(
  "obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    clauseId: uuid("clause_id").references(() => clauses.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    ownerParty: text("owner_party"),
    description: text("description").notNull(),
    // Null when the contract gives no fixed date (a payment term, a notice period).
    dueDate: text("due_date"),
    recurrence: text("recurrence"),
    noticeDays: integer("notice_days"),
    quotedText: text("quoted_text"),
    // The reminder thresholds (30, 7, 1 days) already emailed, so none repeats.
    remindersSent: jsonb("reminders_sent")
      .notNull()
      .default(sql`'[]'::jsonb`),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("obligations_due_idx").on(t.dueDate),
    index("obligations_contract_idx").on(t.contractId),
    pgPolicy("obligations_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    // The pipeline stage currently running, or the one that failed.
    stage: text("stage").notNull().default("queued"),
    status: jobStatus("status").notNull().default("queued"),
    error: text("error"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_contract_created_idx").on(t.contractId, t.createdAt),
    pgPolicy("jobs_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_contract_idx").on(t.contractId, t.createdAt),
    pgPolicy("comments_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

export const bulkScans = pgTable(
  "bulk_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    total: integer("total").notNull(),
    skipped: jsonb("skipped")
      .notNull()
      .default(sql`'[]'::jsonb`),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("bulk_scans_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

/** Model use outside the analysis pipeline (questions, drafting, negotiation). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_org_at_idx").on(t.orgId, t.at),
    pgPolicy("usage_events_tenant_isolation", {
      for: "all",
      to: appUser,
      using: sql`${t.orgId} = ${currentOrgId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId}`,
    }),
  ],
).enableRLS();

/**
 * Fixed-window request counters for rate limiting. A system table: it is
 * only touched through the owner connection, so row-level security is on with
 * no policy, which denies the application role entirely.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}).enableRLS();

export type Comment = typeof comments.$inferSelect;
export type BulkScan = typeof bulkScans.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ContractStatus = (typeof contractStatus.enumValues)[number];
export type Clause = typeof clauses.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type PlaybookPositionRow = typeof playbookPositions.$inferSelect;
export type RulePackRow = typeof rulePacks.$inferSelect;
export type ComplianceResult = typeof complianceResults.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type FindingStatus = (typeof findingStatus.enumValues)[number];
export type Obligation = typeof obligations.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type AuditLogEntry = typeof auditLog.$inferSelect;
