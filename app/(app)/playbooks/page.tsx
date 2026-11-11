import type { Metadata } from "next";
import { Suspense } from "react";

import { PositionEditor } from "@/components/playbook/position-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import { ensurePlaybook } from "@/lib/playbook/queries";

export const metadata: Metadata = { title: "Playbook" };

export default function PlaybookPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PlaybookContent />
    </Suspense>
  );
}

async function PlaybookContent() {
  const { org, user } = await getAuthContext();
  // Created from the defaults the first time anyone opens this page.
  const { playbook, positions } = await withOrg(org.id, (tx) =>
    ensurePlaybook(tx, org.id),
  );
  const canEdit = user.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{playbook.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Your organisation&apos;s standard position for each clause type. Contracts are
          compared against these, and the risk weight sets how much a finding in that kind
          of clause counts towards the score. Version {playbook.version}.
          {!canEdit && " Only an admin can make changes."}
        </p>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          These start as balanced defaults under Indian law. They are a starting point for
          your own positions, not legal advice.
        </p>
      </div>

      <ul className="rounded-lg border">
        {positions.map((position) => (
          <PositionEditor key={position.id} position={position} canEdit={canEdit} />
        ))}
      </ul>
    </div>
  );
}
