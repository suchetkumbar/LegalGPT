CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"clause_id" uuid,
	"kind" text NOT NULL,
	"owner_party" text,
	"description" text NOT NULL,
	"due_date" text,
	"recurrence" text,
	"notice_days" integer,
	"quoted_text" text,
	"reminders_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "obligations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "obligations_due_idx" ON "obligations" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "obligations_contract_idx" ON "obligations" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "clauses_fts_idx" ON "clauses" USING gin (to_tsvector('english', "text"));--> statement-breakpoint
CREATE POLICY "obligations_tenant_isolation" ON "obligations" AS PERMISSIVE FOR ALL TO "app_user" USING ("obligations"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("obligations"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);