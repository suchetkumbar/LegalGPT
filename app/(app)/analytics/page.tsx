import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  exposureByCounterparty,
  riskDistribution,
  topRecurringFindings,
  upcomingRenewals,
  workflowCounts,
} from "@/lib/analytics/portfolio";
import { getAuthContext } from "@/lib/auth/context";
import { WORKFLOW_LABELS, type WorkflowState } from "@/lib/collab/workflow";
import { withOrg } from "@/lib/db";

export const metadata: Metadata = { title: "Portfolio" };

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const BANDS = [
  ["low", "Low (0–29)", "bg-emerald-600"],
  ["medium", "Medium (30–59)", "bg-amber-500"],
  ["high", "High (60–79)", "bg-orange-600"],
  ["critical", "Critical (80–100)", "bg-red-600"],
] as const;

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { org } = await getAuthContext();
  const data = await withOrg(org.id, async (tx) => ({
    distribution: await riskDistribution(tx),
    recurring: await topRecurringFindings(tx),
    exposure: await exposureByCounterparty(tx),
    renewals: await upcomingRenewals(tx),
    workflow: await workflowCounts(tx),
  }));
  const max = Math.max(1, ...Object.values(data.distribution.bands));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Across {data.distribution.scored} analysed contract
          {data.distribution.scored === 1 ? "" : "s"}.{" "}
          {data.workflow
            .map(
              (w) =>
                `${w.count} ${WORKFLOW_LABELS[w.status as WorkflowState]?.toLowerCase() ?? w.status}`,
            )
            .join(" · ")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Risk distribution" className="rounded-lg border px-5 py-4">
          <h2 className="text-sm font-medium">Risk distribution</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            {BANDS.map(([band, label, colour]) => (
              <div
                key={band}
                className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="contents">
                  <span className="bg-muted h-2 rounded-full" aria-hidden>
                    <span
                      className={`block h-full rounded-full ${colour}`}
                      style={{ width: `${(100 * data.distribution.bands[band]) / max}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">
                    {data.distribution.bands[band]}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-label="Renewals in the next 90 days"
          className="rounded-lg border px-5 py-4"
        >
          <h2 className="text-sm font-medium">
            Renewals and expiries in the next 90 days
          </h2>
          {data.renewals.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">None.</p>
          ) : (
            <ul className="mt-3 grid gap-1.5 text-sm">
              {data.renewals.map((item) => (
                <li key={item.id}>
                  <span className="tabular-nums">{item.dueDate}</span> ·{" "}
                  <Link
                    href={`/contracts/${item.contractId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    {item.kind === "expiry" ? "expires" : "last day to stop renewal"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Most common issues" className="rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-medium">Most common issues</h2>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-5 py-2 font-normal">Issue</th>
              <th className="px-5 py-2 text-right font-normal">Contracts</th>
              <th className="px-5 py-2 text-right font-normal">Worst severity</th>
            </tr>
          </thead>
          <tbody>
            {data.recurring.map((row) => (
              <tr key={`${row.kind}-${row.title}`} className="border-t">
                <td className="px-5 py-2">{row.title}</td>
                <td className="px-5 py-2 text-right tabular-nums">{row.contracts}</td>
                <td className="px-5 py-2 text-right tabular-nums">{row.maxSeverity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Exposure by counterparty" className="rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-medium">
          Exposure by counterparty
        </h2>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-5 py-2 font-normal">Counterparty</th>
              <th className="px-5 py-2 text-right font-normal">Contracts</th>
              <th className="px-5 py-2 text-right font-normal">Value (INR)</th>
              <th className="px-5 py-2 text-right font-normal">Highest risk</th>
            </tr>
          </thead>
          <tbody>
            {data.exposure.map((row) => (
              <tr key={row.counterparty} className="border-t">
                <td className="px-5 py-2">{row.counterparty}</td>
                <td className="px-5 py-2 text-right tabular-nums">{row.contracts}</td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {row.value ? rupees.format(row.value) : "–"}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {row.maxRisk ?? "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground border-t px-5 py-2 text-xs">
          The counterparty is filled in when one party is recognisably your organisation,
          or when you choose &ldquo;Which party are we?&rdquo; on a contract.
        </p>
      </section>
    </div>
  );
}
