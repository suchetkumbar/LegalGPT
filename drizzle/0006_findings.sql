CREATE TYPE "public"."finding_kind" AS ENUM('risk', 'deviation', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."finding_source" AS ENUM('rule', 'model');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"clause_id" uuid,
	"kind" "finding_kind" NOT NULL,
	"source" "finding_source" NOT NULL,
	"rule_id" text,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"clause_type" text,
	"severity" integer NOT NULL,
	"likelihood" integer NOT NULL,
	"quoted_text" text,
	"reasoning" text NOT NULL,
	"suggested_fix" text,
	"model" text,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_contract_idx" ON "findings" USING btree ("contract_id");--> statement-breakpoint
CREATE POLICY "findings_tenant_isolation" ON "findings" AS PERMISSIVE FOR ALL TO "app_user" USING ("findings"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("findings"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);