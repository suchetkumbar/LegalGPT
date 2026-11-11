import { OrganizationList } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Choose a workspace" };

/** Reached when a signed-in user has no active organisation. */
export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a workspace</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Contracts, playbooks and findings belong to an organisation. Create one or join
          one you were invited to.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-sm" />}>
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
        />
      </Suspense>
    </main>
  );
}
