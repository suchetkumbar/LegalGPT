CREATE TABLE "bulk_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"file_name" text NOT NULL,
	"total" integer NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"finding_id" uuid,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "workflow_status" text DEFAULT 'in_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "bulk_scan_id" uuid;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "monthly_token_budget" integer;--> statement-breakpoint
ALTER TABLE "bulk_scans" ADD CONSTRAINT "bulk_scans_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_scans" ADD CONSTRAINT "bulk_scans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_contract_idx" ON "comments" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_org_at_idx" ON "usage_events" USING btree ("org_id","at");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "bulk_scans_tenant_isolation" ON "bulk_scans" AS PERMISSIVE FOR ALL TO "app_user" USING ("bulk_scans"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("bulk_scans"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO "app_user" USING ("comments"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("comments"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "usage_events_tenant_isolation" ON "usage_events" AS PERMISSIVE FOR ALL TO "app_user" USING ("usage_events"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("usage_events"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);