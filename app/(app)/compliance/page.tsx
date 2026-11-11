import type { Metadata } from "next";
import { Suspense } from "react";

import { PolicyBuilder } from "@/components/compliance/policy-builder";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { BUILT_IN_PACKS } from "@/lib/compliance/packs";
import { listPolicies } from "@/lib/compliance/store";
import { withOrg } from "@/lib/db";

export const metadata: Metadata = { title: "Policies" };

export default function CompliancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { org, user } = await getAuthContext();
  const { version, rules } = await withOrg(org.id, listPolicies);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Every contract is checked against the rule packs below, and against your own
          policies. A pack is used only when it applies to the contract. Checks look for
          required and prohibited terms; they do not judge how well a clause is drafted,
          and are not legal advice.
        </p>
      </div>

      <section aria-label="Built-in rule packs">
        <h2 className="text-sm font-medium">Built-in rule packs</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {BUILT_IN_PACKS.map((pack) => (
            <li key={pack.code} className="rounded-lg border px-4 py-3 text-sm">
              <p className="font-medium">{pack.name}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Version {pack.version} · {pack.rules.length} rules · reviewed{" "}
                {pack.reviewedOn}
              </p>
              <p className="text-muted-foreground mt-1.5">
                {pack.applicability.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Internal policies">
        <h2 className="text-sm font-medium">
          Internal policies{" "}
          {version > 0 && (
            <span className="text-muted-foreground font-normal">version {version}</span>
          )}
        </h2>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">
          {user.role === "admin"
            ? "Rules your organisation adds for itself."
            : "Rules your organisation has added. Only an admin can change them."}
        </p>
        <PolicyBuilder
          canEdit={user.role === "admin"}
          policies={rules.map((rule) => ({
            id: rule.id,
            title: rule.title,
            description: rule.description,
            mode: rule.mode,
            phrases: rule.phrases,
            clauseType: rule.check.clauseTypes?.[0] ?? null,
            severity:
              (rule.mode === "require" ? rule.check.ifMissing : rule.check.ifForbidden) ??
              "fail",
          }))}
        />
      </section>
    </div>
  );
}
