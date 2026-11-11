import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { adminDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { sendEmail } from "@/lib/obligations/reminders";

const { contracts, bulkScans, users } = schema;

/**
 * Called after each analysis. If the contract belonged to a bulk scan and it
 * was the last one still running, emails the organisation's admins once.
 */
export async function notifyBulkScanIfDone(contractId: string): Promise<void> {
  const db = adminDb();
  const [contract] = await db
    .select({ bulkScanId: contracts.bulkScanId })
    .from(contracts)
    .where(eq(contracts.id, contractId));
  if (!contract?.bulkScanId) return;

  const counts = await db
    .select({ status: contracts.status, count: sql<number>`count(*)::int` })
    .from(contracts)
    .where(eq(contracts.bulkScanId, contract.bulkScanId))
    .groupBy(contracts.status);
  const pending = counts
    .filter((c) => c.status === "uploaded" || c.status === "processing")
    .reduce((sum, c) => sum + c.count, 0);
  if (pending > 0) return;

  // Claim the notification atomically so two finishing jobs do not both send it.
  const [scan] = await db
    .update(bulkScans)
    .set({ notifiedAt: new Date() })
    .where(and(eq(bulkScans.id, contract.bulkScanId), isNull(bulkScans.notifiedAt)))
    .returning();
  if (!scan) return;

  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.orgId, scan.orgId), inArray(users.role, ["admin"])));
  const ready = counts.find((c) => c.status === "ready")?.count ?? 0;
  const failed = counts.find((c) => c.status === "failed")?.count ?? 0;
  const appUrl = process.env.APP_URL || "";
  await sendEmail({
    to: admins.map((a) => a.email).filter(Boolean),
    subject: `Bulk scan finished: ${scan.fileName}`,
    text: `The bulk scan of ${scan.fileName} has finished.\n\n${ready} analysed, ${failed} could not be processed, ${(scan.skipped as unknown[]).length} skipped.${appUrl ? `\n\n${appUrl}/bulk` : ""}\n\nNot legal advice.`,
  }).catch((error) => console.error("[bulk] email failed:", error));
}
