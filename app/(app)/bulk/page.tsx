import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BulkUpload } from "@/components/bulk/bulk-upload";
import { Skeleton } from "@/components/ui/skeleton";
import { canEditContracts, getAuthContext } from "@/lib/auth/context";
import { withOrg } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export const metadata: Metadata = { title: "Bulk scan" };

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default function BulkPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Scans />
    </Suspense>
  );
}

async function Scans() {
  const { org, user } = await getAuthContext();
  const scans = await withOrg(org.id, (tx) =>
    tx
      .select({
        id: schema.bulkScans.id,
        fileName: schema.bulkScans.fileName,
        total: schema.bulkScans.total,
        skipped: schema.bulkScans.skipped,
        createdAt: schema.bulkScans.createdAt,
        ready: sql<number>`count(*) filter (where ${schema.contracts.status} = 'ready')::int`,
        failed: sql<number>`count(*) filter (where ${schema.contracts.status} = 'failed')::int`,
      })
      .from(schema.bulkScans)
      .leftJoin(schema.contracts, eq(schema.contracts.bulkScanId, schema.bulkScans.id))
      .groupBy(schema.bulkScans.id)
      .orderBy(desc(schema.bulkScans.createdAt))
      .limit(50),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk scan</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Scan a folder of contracts at once. Each is analysed like a single upload and
          appears in your contract list.
        </p>
      </div>
      {canEditContracts(user) && <BulkUpload />}
      <table className="w-full rounded-lg border text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-4 py-2 font-normal">Archive</th>
            <th className="px-4 py-2 font-normal">Uploaded</th>
            <th className="px-4 py-2 text-right font-normal">Progress</th>
          </tr>
        </thead>
        <tbody>
          {scans.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted-foreground px-4 py-6 text-center">
                No bulk scans yet.
              </td>
            </tr>
          )}
          {scans.map((scan) => {
            const done = scan.ready + scan.failed;
            return (
              <tr key={scan.id} className="border-t">
                <td className="px-4 py-2">
                  {scan.fileName}
                  {(scan.skipped as unknown[]).length > 0 && (
                    <span className="text-muted-foreground block text-xs">
                      {(scan.skipped as unknown[]).length} files skipped
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{timeFormat.format(scan.createdAt)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {done} of {scan.total}
                  {scan.failed > 0 ? ` (${scan.failed} failed)` : ""}
                  {done === scan.total ? " · done" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
