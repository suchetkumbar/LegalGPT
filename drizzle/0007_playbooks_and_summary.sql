CREATE TABLE "playbook_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"clause_type" text NOT NULL,
	"standard_text" text NOT NULL,
	"fallback_text" text,
	"walkaway" text,
	"risk_weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbook_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "playbook_positions" ADD CONSTRAINT "playbook_positions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_positions" ADD CONSTRAINT "playbook_positions_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_positions_type_idx" ON "playbook_positions" USING btree ("playbook_id","clause_type");--> statement-breakpoint
CREATE INDEX "playbooks_org_idx" ON "playbooks" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "playbook_positions_tenant_isolation" ON "playbook_positions" AS PERMISSIVE FOR ALL TO "app_user" USING ("playbook_positions"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("playbook_positions"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "playbooks_tenant_isolation" ON "playbooks" AS PERMISSIVE FOR ALL TO "app_user" USING ("playbooks"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("playbooks"."org_id" = nullif(current_setting('app.org_id', true), '')::uuid);