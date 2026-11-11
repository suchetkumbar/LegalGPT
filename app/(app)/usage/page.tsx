import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { BudgetForm } from "@/components/usage/budget-form";
import { getAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import { monthUsage } from "@/lib/usage/budget";

export const metadata: Metadata = { title: "Usage" };

const KIND_LABELS: Record<string, string> = {
  ask: "Questions",
  ask_deep: "Questions (deep analysis)",
  negotiate: "Counter-proposals",
  draft_refine: "Draft refinement",
};
const number = new Intl.NumberFormat("en-IN");

export default function UsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Usage />
    </Suspense>
  );
}

async function Usage() {
  const { org, user } = await getAuthContext();
  const usage = await withOrg(org.id, (tx) => monthUsage(tx));
  const rows: [string, number][] = [
    ["Contract analysis", usage.analysis],
    ...Object.entries(usage.other).map(
      ([kind, tokens]) => [KIND_LABELS[kind] ?? kind, tokens] as [string, number],
    ),
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI usage this month</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tokens sent to and received from the AI models since the start of the month
          (UTC). On the free tier this costs nothing, but each model has a daily quota.
          When a budget is set and used up, analyses fall back to the rule-based review
          and the AI buttons stop working until next month.
        </p>
      </div>

      <table className="w-full rounded-lg border text-sm">
        <tbody>
          {rows.map(([label, tokens]) => (
            <tr key={label} className="border-b">
              <td className="px-4 py-2">{label}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {number.format(tokens)}
              </td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="px-4 py-2">Total</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {number.format(usage.total)}
            </td>
          </tr>
          <tr>
            <td className="text-muted-foreground px-4 py-2">Budget</td>
            <td className="text-muted-foreground px-4 py-2 text-right tabular-nums">
              {usage.budget === null
                ? "No limit"
                : `${number.format(usage.budget)} (${number.format(usage.remaining ?? 0)} left)`}
            </td>
          </tr>
        </tbody>
      </table>

      {user.role === "admin" ? (
        <BudgetForm current={usage.budget} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Only an admin can change the budget.
        </p>
      )}
    </div>
  );
}
