import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { adminDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

import { dueThreshold } from "./calendar";

const { obligations, contracts, users, orgs } = schema;

export type ReminderEmail = { to: string[]; subject: string; text: string };

/**
 * Sends one email through Resend. Without RESEND_API_KEY the email is logged
 * instead, so the sweep can be tried locally without an account.
 */
export async function sendEmail(email: ReminderEmail): Promise<"sent" | "logged"> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(
      `[reminders] (no RESEND_API_KEY) would email ${email.to.length} admin(s): ${email.subject}`,
    );
    return "logged";
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REMINDER_FROM_EMAIL || "LegalGPT <onboarding@resend.dev>",
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  return "sent";
}

/**
 * The daily sweep. Runs across every organisation (it is a system job, on the
 * owner connection), emails each organisation's admins about obligations at
 * 30, 7 or 1 days, and records what was sent so nothing is sent twice.
 */
export async function sendDueReminders(today = new Date().toISOString().slice(0, 10)) {
  const db = adminDb();
  const rows = await db
    .select({
      id: obligations.id,
      orgId: obligations.orgId,
      description: obligations.description,
      dueDate: obligations.dueDate,
      remindersSent: obligations.remindersSent,
      contractTitle: contracts.title,
      contractId: contracts.id,
      orgName: orgs.name,
    })
    .from(obligations)
    .innerJoin(contracts, eq(contracts.id, obligations.contractId))
    .innerJoin(orgs, eq(orgs.id, obligations.orgId))
    .where(isNotNull(obligations.dueDate));

  const due = rows
    .map((row) => ({
      ...row,
      threshold: dueThreshold(row.dueDate, today, (row.remindersSent as number[]) ?? []),
    }))
    .filter((row) => row.threshold !== null);

  const byOrg = new Map<string, typeof due>();
  for (const row of due) byOrg.set(row.orgId, [...(byOrg.get(row.orgId) ?? []), row]);

  const appUrl = process.env.APP_URL || "";
  let emails = 0;
  for (const [orgId, items] of byOrg) {
    const admins = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, "admin")));
    const to = admins.map((admin) => admin.email).filter(Boolean);
    if (to.length === 0) continue;

    const lines = items
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
      .map(
        (item) =>
          `- ${item.dueDate} (in ${item.threshold} day${item.threshold === 1 ? "" : "s"}): ${item.contractTitle}. ${item.description}${appUrl ? `\n  ${appUrl}/contracts/${item.contractId}` : ""}`,
      );
    await sendEmail({
      to,
      subject: `${items.length} contract deadline${items.length === 1 ? "" : "s"} coming up`,
      text: `Upcoming contract deadlines for ${items[0].orgName}:\n\n${lines.join("\n")}\n\nDates are worked out from the contract text. Check the contract before acting. Not legal advice.`,
    });
    emails += 1;

    for (const item of items) {
      await db
        .update(obligations)
        .set({
          remindersSent: [...((item.remindersSent as number[]) ?? []), item.threshold!],
          reminderSentAt: new Date(),
        })
        .where(inArray(obligations.id, [item.id]));
    }
  }
  return { checked: rows.length, due: due.length, emails };
}
