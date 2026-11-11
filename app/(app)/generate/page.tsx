import type { Metadata } from "next";

import { GenerateWizard } from "@/components/drafting/generate-wizard";
import { TEMPLATES } from "@/lib/drafting/templates";

export const metadata: Metadata = { title: "Draft a contract" };

export default function GeneratePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Draft a contract</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Pick a template and fill in the details. The draft is built from your playbook
          and checked for risks before you see it. Have a qualified lawyer review it
          before use.
        </p>
      </div>
      <GenerateWizard
        templates={TEMPLATES.map(({ id, name, description, roles }) => ({
          id,
          name,
          description,
          roles,
        }))}
      />
    </div>
  );
}
