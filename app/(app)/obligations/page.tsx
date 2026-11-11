import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AskPanel } from "@/components/ask/ask-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import { daysUntil } from "@/lib/obligations/calendar";
import { listObligations } from "@/lib/obligations/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Content />
    </Suspense>
  );
}

const monthFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

async function Content() {
  const { org } = await getAuthContext();
  const items = await withOrg(org.id, (tx) => listObligations(tx));
  // The page reads the session, so it renders per request and "today" is current.
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = items.filter((item) => item.dueDate && item.dueDate >= today);
  const past = items.filter((item) => item.dueDate && item.dueDate < today);
  const undated = items.filter((item) => !item.dueDate);
  const months = new Map<string, typeof upcoming>();
  for (const item of upcoming) {
    const key = item.dueDate!.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Obligations and deadlines
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Worked out from each contract&apos;s effective date and the durations it
            states. Admins get an email 30, 7 and 1 days before each date. Check the
            contract before acting.
          </p>
        </div>
        <a
          href="/api/obligations?format=ics"
          className="hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
        >
          Add to calendar (.ics)
        </a>
      </div>

      {upcoming.length === 0 && undated.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
          No obligations yet. They appear once contracts with dates and terms are
          analysed.
        </p>
      )}

      {[...months].map(([month, rows]) => (
        <section
          key={month}
          aria-label={monthFormat.format(new Date(`${month}-01T00:00:00Z`))}
        >
          <h2 className="text-sm font-medium">
            {monthFormat.format(new Date(`${month}-01T00:00:00Z`))}
          </h2>
          <ul className="mt-2 rounded-lg border">
            {rows.map((item) => {
              const days = daysUntil(item.dueDate!, today);
              return (
                <li
                  key={item.id}
                  className="flex gap-4 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <span
                    className={cn(
                      "w-16 shrink-0 tabular-nums",
                      days <= 7 && "font-semibold text-red-700 dark:text-red-400",
                    )}
                  >
                    {dayFormat.format(new Date(`${item.dueDate}T00:00:00Z`))}
                  </span>
                  <span>
                    <Link
                      href={`/contracts/${item.contractId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.contractTitle}
                    </Link>{" "}
                    {item.description}
                    <span className="text-muted-foreground block text-xs">
                      {days === 0 ? "Today" : `In ${days} day${days === 1 ? "" : "s"}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {undated.length > 0 && (
        <section aria-label="Without a fixed date">
          <h2 className="text-sm font-medium">Without a fixed date</h2>
          <ul className="mt-2 rounded-lg border">
            {undated.map((item) => (
              <li key={item.id} className="border-b px-4 py-3 text-sm last:border-b-0">
                <Link
                  href={`/contracts/${item.contractId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.contractTitle}
                </Link>{" "}
                {item.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {past.length} earlier date{past.length === 1 ? "" : "s"} not shown.
        </p>
      )}

      <AskPanel contractId={null} />
    </div>
  );
}
