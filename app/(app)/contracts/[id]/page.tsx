import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AnalysisProgress } from "@/components/contracts/analysis-progress";
import { ContractViewer } from "@/components/contracts/contract-viewer";
import { AskPanel } from "@/components/ask/ask-panel";
import { WorkflowControls } from "@/components/collab/workflow-controls";
import { ComplianceMatrix } from "@/components/contracts/compliance-matrix";
import { KeyDetails } from "@/components/contracts/key-details";
import { OurPartySelect } from "@/components/contracts/our-party-select";
import { RetryAnalysis } from "@/components/contracts/retry-analysis";
import { RiskSummary } from "@/components/contracts/risk-summary";
import { StatusBadge } from "@/components/contracts/status-badge";
import { UploadDropzone } from "@/components/contracts/upload-dropzone";
import { Skeleton } from "@/components/ui/skeleton";
import { canEditContracts, getAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { getContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { getComplianceResults } from "@/lib/compliance/store";
import { listComments, listMembers } from "@/lib/collab/workflow";
import { listObligations } from "@/lib/obligations/queries";
import { getWeights } from "@/lib/playbook/queries";

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
  const loaded = isUuid(id)
    ? await withOrg(org.id, async (tx) => ({
        detail: await getContract(tx, id),
        weights: await getWeights(tx),
        compliance: await getComplianceResults(tx, id),
        obligations: await listObligations(tx, { contractId: id }),
        comments: await listComments(tx, id),
        members: await listMembers(tx),
      }))
    : null;
  if (!loaded?.detail) notFound();
  const { detail, weights, compliance, obligations, comments, members } = loaded;

  const { contract, clauses, entities, findings, job } = detail;

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
          {job && job.tokensIn + job.tokensOut > 0
            ? ` · last analysis used ${(job.tokensIn + job.tokensOut).toLocaleString("en-IN")} tokens`
            : ""}
          {contract.version > 1 ? ` · version ${contract.version}` : ""}
        </p>
      </div>

      {contract.status === "ready" && (
        <WorkflowControls
          contractId={contract.id}
          status={contract.workflowStatus}
          assigneeId={contract.assigneeId}
          members={members}
          canEdit={canEditContracts(user)}
        />
      )}

      {contract.status === "ready" && (
        <nav aria-label="Contract actions" className="flex flex-wrap gap-2 text-sm">
          {[
            { href: `/contracts/${contract.id}/report`, label: "Risk report" },
            ...(canEditContracts(user)
              ? [{ href: `/contracts/${contract.id}/negotiate`, label: "Negotiate" }]
              : []),
            ...(contract.parentId
              ? [
                  {
                    href: `/contracts/${contract.id}/compare`,
                    label: "Compare with previous version",
                  },
                ]
              : []),
            {
              href: `/api/contracts/${contract.id}/export?format=csv`,
              label: "Findings CSV",
            },
            {
              href: `/api/contracts/${contract.id}/export?format=json`,
              label: "Findings JSON",
            },
            {
              href: `/api/contracts/${contract.id}/export?format=docx`,
              label: "Word redline (accepted fixes)",
            },
          ].map((action) => (
            <a
              key={action.href}
              href={action.href}
              className="hover:bg-muted rounded-md border px-3 py-1.5"
            >
              {action.label}
            </a>
          ))}
        </nav>
      )}

      {contract.status === "ready" && contract.text !== null ? (
        <>
          {job?.status === "failed" && (
            <RetryAnalysis
              contractId={contract.id}
              message={job.error ?? "The analysis did not finish."}
              canRetry={canEditContracts(user)}
            />
          )}
          {contract.ocrUsed && (
            <p
              role="note"
              className="text-muted-foreground rounded-lg border px-5 py-3 text-sm"
            >
              This document was a scan, so its text was read by OCR and may contain
              misread characters. Check important wording against the original before
              relying on it.
            </p>
          )}
          <KeyDetails contractType={contract.type} entities={entities} />
          <OurPartySelect
            contractId={contract.id}
            parties={entities.filter((e) => e.kind === "party").map((e) => e.value)}
            current={contract.ourParty}
            canEdit={canEditContracts(user)}
          />
          {contract.summary && (
            <section aria-label="Summary" className="rounded-lg border px-5 py-4">
              <h2 className="text-sm font-medium">Summary</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed">{contract.summary}</p>
            </section>
          )}
          <RiskSummary findings={findings} weights={weights} />
          <ContractViewer
            text={contract.text}
            clauses={clauses}
            findings={findings}
            canReview={canEditContracts(user)}
            comments={comments.map((c) => ({
              ...c,
              createdAt: c.createdAt.toISOString(),
            }))}
          />
          <ComplianceMatrix results={compliance} clauses={clauses} />
          {obligations.length > 0 && (
            <section
              aria-label="Obligations"
              className="rounded-lg border px-5 py-4 text-sm"
            >
              <h2 className="font-medium">Obligations and deadlines</h2>
              <ul className="mt-2 grid gap-1.5">
                {obligations.map((item) => (
                  <li key={item.id}>
                    <span className="tabular-nums">
                      {item.dueDate ?? "No fixed date"}
                    </span>
                    {" · "}
                    {item.description}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <AskPanel contractId={contract.id} />
          {canEditContracts(user) && (
            <section aria-label="Upload a new version">
              <h2 className="mb-2 text-sm font-medium">Received a revised draft?</h2>
              <UploadDropzone
                parentId={contract.id}
                prompt="Drop the new version here to compare it with this one"
              />
            </section>
          )}
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
