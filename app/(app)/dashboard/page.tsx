import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Reads the session, so it streams in behind the boundary. */}
      <Suspense fallback={<Skeleton className="h-14 w-72" />}>
        <WorkspaceHeading />
      </Suspense>

      <section className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-20 text-center">
        <FileText className="text-muted-foreground size-8" aria-hidden />
        <h2 className="mt-4 font-medium">No contracts yet</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          Contract upload arrives in the next phase. Once it does, uploaded contracts and
          their risk scores will appear here.
        </p>
      </section>
    </div>
  );
}

async function WorkspaceHeading() {
  const { org, user } = await getAuthContext();
  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <Badge variant="secondary" className="capitalize">
          {user.role}
        </Badge>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">Signed in as {user.email}</p>
    </div>
  );
}
