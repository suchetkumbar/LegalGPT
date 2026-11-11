CREATE TYPE "public"."entity_kind" AS ENUM('party', 'date', 'amount', 'law', 'jurisdiction', 'term');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"clause_id" uuid,
	"kind" "entity_kind" NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"normalized" jsonb
);
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "public"."clauses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_contract_idx" ON "entities" USING btree ("contract_id");--> statement-breakpoint
CREATE POLICY "entities_tenant_isolation" ON "entities" AS PERMISSIVE FOR ALL TO "app_user" USING ("entities"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("entities"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);