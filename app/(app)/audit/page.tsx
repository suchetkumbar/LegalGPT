import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import { listAudit } from "@/lib/collab/workflow";
import { withOrg } from "@/lib/db";

export const metadata: Metadata = { title: "Audit trail" };

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default function AuditPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Trail />
    </Suspense>
  );
}

async function Trail() {
  const { org, user } = await getAuthContext();
  if (user.role !== "admin") {
    return <p className="text-sm">Only an admin can see the audit trail.</p>;
  }
  const entries = await withOrg(org.id, (tx) => listAudit(tx, { limit: 300 }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The latest {entries.length} actions in your organisation. Entries cannot be
          edited or deleted.
        </p>
      </div>
      <table className="w-full rounded-lg border text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-4 py-2 font-normal">When</th>
            <th className="px-4 py-2 font-normal">Who</th>
            <th className="px-4 py-2 font-normal">Action</th>
            <th className="px-4 py-2 font-normal">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t align-top">
              <td className="px-4 py-2 whitespace-nowrap">
                {timeFormat.format(entry.at)}
              </td>
              <td className="px-4 py-2">{entry.actor ?? "System"}</td>
              <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
              <td className="text-muted-foreground px-4 py-2 font-mono text-xs break-all">
                {entry.target}
                {entry.diff ? ` ${JSON.stringify(entry.diff)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
