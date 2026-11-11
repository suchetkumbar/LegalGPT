CREATE TYPE "public"."contract_status" AS ENUM('uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"number" text,
	"heading" text,
	"text" text NOT NULL,
	"type" text,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
ALTER TABLE "clauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"counterparty" text,
	"status" "contract_status" DEFAULT 'uploaded' NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"file_hash" text NOT NULL,
	"text" text,
	"page_count" integer,
	"parent_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"risk_score" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parent_id_contracts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clauses_contract_ordinal_idx" ON "clauses" USING btree ("contract_id","ordinal");--> statement-breakpoint
CREATE INDEX "clauses_embedding_idx" ON "clauses" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "contracts_org_created_idx" ON "contracts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_contract_created_idx" ON "jobs" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE POLICY "clauses_tenant_isolation" ON "clauses" AS PERMISSIVE FOR ALL TO "app_user" USING ("clauses"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("clauses"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "contracts_tenant_isolation" ON "contracts" AS PERMISSIVE FOR ALL TO "app_user" USING ("contracts"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("contracts"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "jobs_tenant_isolation" ON "jobs" AS PERMISSIVE FOR ALL TO "app_user" USING ("jobs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("jobs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);