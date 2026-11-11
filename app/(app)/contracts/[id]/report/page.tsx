import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PrintButton } from "@/components/contracts/print-button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { getComplianceResults } from "@/lib/compliance/store";
import { isUuid } from "@/lib/contracts/ids";
import { getContract } from "@/lib/contracts/queries";
import { withOrg } from "@/lib/db";
import { DISCLAIMER } from "@/lib/export/export";
import { getWeights } from "@/lib/playbook/queries";
import { CATEGORY_LABELS, RISK_CATEGORIES } from "@/lib/rules/types";
import { computeRiskScore } from "@/lib/scoring/score";

export const metadata: Metadata = { title: "Risk report" };

const SEVERITY = ["", "Note", "Low", "Medium", "High", "Critical"];

/** A printable risk report. "Save as PDF" in the browser's print dialog makes the PDF. */
export default function ReportPage({ params }: PageProps<"/contracts/[id]/report">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Report params={params} />
    </Suspense>
  );
}

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await getAuthContext();
  if (!isUuid(id)) notFound();
  const data = await withOrg(org.id, async (tx) => ({
    detail: await getContract(tx, id),
    weights: await getWeights(tx),
    compliance: await getComplianceResults(tx, id),
  }));
  if (!data.detail) notFound();
  const { contract, findings, entities } = data.detail;
  const open = findings.filter((f) => f.status !== "dismissed");
  const score = computeRiskScore(findings, data.weights);
  const dateFormat = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeZone: "Asia/Kolkata",
  });

  return (
    <article className="mx-auto max-w-3xl text-sm leading-relaxed print:max-w-none">
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <p className="text-muted-foreground">
          Use your browser&apos;s print dialog and choose “Save as PDF”.
        </p>
        <PrintButton />
      </div>

      <header className="border-b pb-4">
        <p className="text-muted-foreground text-xs uppercase">LegalGPT risk report</p>
        <h1 className="mt-1 text-2xl font-semibold">{contract.title}</h1>
        <p className="text-muted-foreground mt-1">
          {contract.fileName} · prepared {dateFormat.format(new Date())} for {org.name}
        </p>
        <p className="mt-3 font-medium">{DISCLAIMER}</p>
      </header>

      <section className="mt-6">
        <h2 className="text-base font-semibold">
          Overall risk: {score.score} / 100 ({score.band})
        </h2>
        {contract.summary && <p className="mt-2">{contract.summary}</p>}
        <table className="mt-3 w-full">
          <tbody>
            {RISK_CATEGORIES.map((category) => (
              <tr key={category} className="border-b">
                <td className="py-1">{CATEGORY_LABELS[category]}</td>
                <td className="py-1 text-right tabular-nums">
                  {score.byCategory[category]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {entities.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-semibold">Key details</h2>
          <ul className="mt-2 list-disc pl-5">
            {entities.map((entity) => (
              <li key={entity.id}>
                {entity.label.replace(/_/g, " ")}: {entity.value}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-base font-semibold">Findings ({open.length})</h2>
        {open.map((finding) => (
          <div key={finding.id} className="mt-3 break-inside-avoid border-l-2 pl-3">
            <p className="font-medium">
              {SEVERITY[finding.severity]}: {finding.title}
              {finding.status === "accepted" ? " (accepted by reviewer)" : ""}
            </p>
            {finding.quotedText && (
              <p className="text-muted-foreground italic">“{finding.quotedText}”</p>
            )}
            <p>{finding.reasoning}</p>
            {finding.suggestedFix && <p>Suggested: {finding.suggestedFix}</p>}
          </div>
        ))}
      </section>

      {data.compliance.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-semibold">Compliance</h2>
          <table className="mt-2 w-full">
            <tbody>
              {data.compliance.map((result) => (
                <tr key={result.id} className="border-b align-top">
                  <td className="w-12 py-1 font-medium uppercase">{result.verdict}</td>
                  <td className="py-1">
                    {result.title}{" "}
                    <span className="text-muted-foreground">
                      ({result.reference}; {result.packCode} {result.packVersion})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="text-muted-foreground mt-8 border-t pt-3 text-xs">
        {DISCLAIMER}
      </footer>
    </article>
  );
}
