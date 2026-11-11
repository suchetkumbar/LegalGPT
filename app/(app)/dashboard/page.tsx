import type { Metadata } from "next";
import { Suspense } from "react";

import { ContractList } from "@/components/contracts/contract-list";
import { LoadSamples } from "@/components/contracts/contract-admin";
import { UploadDropzone } from "@/components/contracts/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { canEditContracts, getAuthContext } from "@/lib/auth/context";
import { listContracts } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    // Everything here reads the session, so it streams in behind the boundary.
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { org, user } = await getAuthContext();
  const contracts = await withOrg(org.id, listContracts);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <Badge variant="secondary" className="capitalize">
            {user.role}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">Signed in as {user.email}</p>
      </div>

      {canEditContracts(user) && <UploadDropzone />}

      <section aria-label="Contracts">
        <ContractList contracts={contracts} />
        {contracts.length === 0 && canEditContracts(user) && <LoadSamples />}
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
