CREATE TYPE "public"."compliance_verdict" AS ENUM('pass', 'warn', 'fail');--> statement-breakpoint
CREATE TABLE "compliance_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"pack_code" text NOT NULL,
	"pack_version" text NOT NULL,
	"rule_id" text NOT NULL,
	"title" text NOT NULL,
	"reference" text NOT NULL,
	"verdict" "compliance_verdict" NOT NULL,
	"clause_id" uuid,
	"quoted_text" text,
	"explanation" text NOT NULL,
	"fix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rule_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_packs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_packs" ADD CONSTRAINT "rule_packs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_results_contract_idx" ON "compliance_results" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_packs_org_code_idx" ON "rule_packs" USING btree ("org_id","code");--> statement-breakpoint
CREATE POLICY "compliance_results_tenant_isolation" ON "compliance_results" AS PERMISSIVE FOR ALL TO "app_user" USING ("compliance_results"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("compliance_results"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rule_packs_tenant_isolation" ON "rule_packs" AS PERMISSIVE FOR ALL TO "app_user" USING ("rule_packs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("rule_packs"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);