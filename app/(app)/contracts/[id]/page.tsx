import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AnalysisProgress } from "@/components/contracts/analysis-progress";
import { ContractViewer } from "@/components/contracts/contract-viewer";
import { KeyDetails } from "@/components/contracts/key-details";
import { RetryAnalysis } from "@/components/contracts/retry-analysis";
import { StatusBadge } from "@/components/contracts/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { canEditContracts, getAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { getContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";

export const metadata: Metadata = { title: "Contract" };

export default function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> All contracts
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ContractDetail params={params} />
      </Suspense>
    </div>
  );
}

async function ContractDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, user } = await getAuthContext();
  const detail = isUuid(id) ? await withOrg(org.id, (tx) => getContract(tx, id)) : null;
  if (!detail) notFound();

  const { contract, clauses, entities, job } = detail;

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{contract.title}</h1>
          <StatusBadge status={contract.status} />
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {contract.fileName}
          {contract.pageCount ? ` · ${contract.pageCount} pages` : ""}
        </p>
      </div>

      {contract.status === "ready" && contract.text !== null ? (
        <>
          {job?.status === "failed" && (
            <RetryAnalysis
              contractId={contract.id}
              message={job.error ?? "The analysis did not finish."}
              canRetry={canEditContracts(user)}
            />
          )}
          <KeyDetails contractType={contract.type} entities={entities} />
          <ContractViewer text={contract.text} clauses={clauses} />
        </>
      ) : contract.status === "failed" ? (
        <div role="alert" className="border-destructive/40 rounded-lg border px-6 py-10">
          <h2 className="font-medium">This contract could not be processed</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {job?.error ?? "Something went wrong while processing this document."}
          </p>
        </div>
      ) : (
        <AnalysisProgress
          contractId={contract.id}
          initial={{
            stage: job?.stage ?? "queued",
            status: job?.status ?? "queued",
            error: null,
          }}
        />
      )}
    </>
  );
}
