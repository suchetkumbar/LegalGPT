import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { NegotiationPanel } from "@/components/negotiate/negotiation-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { isUuid } from "@/lib/contracts/ids";
import { getContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { ensurePlaybook } from "@/lib/playbook/queries";

export const metadata: Metadata = { title: "Negotiate" };

export default function NegotiatePage({
  params,
}: PageProps<"/contracts/[id]/negotiate">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await getAuthContext();
  if (!isUuid(id)) notFound();
  const data = await withOrg(org.id, async (tx) => ({
    detail: await getContract(tx, id),
    positions: (await ensurePlaybook(tx, org.id)).positions,
  }));
  if (!data.detail) notFound();
  const types = new Set(data.positions.map((p) => p.clauseType));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/contracts/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to the contract
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Negotiate {data.detail.contract.title}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Counter-proposals respect your playbook&apos;s standard, fallback and walk-away
          points. Choose a tone for each and download the contract with the changes
          marked.
        </p>
      </div>
      <NegotiationPanel
        contractId={id}
        findings={data.detail.findings
          .filter((f) => f.status !== "dismissed")
          .map((f) => ({
            id: f.id,
            title: f.title,
            severity: f.severity,
            quotedText: f.quotedText,
            hasPosition: f.clauseType ? types.has(f.clauseType) : false,
          }))}
      />
    </div>
  );
}
