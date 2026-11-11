/**
 * Calendar export and reminder scheduling for obligations. Pure functions,
 * so the date logic is testable without a clock or a database.
 */

export type CalendarObligation = {
  id: string;
  contractId: string;
  contractTitle: string;
  description: string;
  dueDate: string | null;
  quotedText: string | null;
};

/** The reminder thresholds from the plan: 30, 7 and 1 days before the date. */
export const REMINDER_DAYS = [30, 7, 1] as const;

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Lines longer than 75 octets are folded, as RFC 5545 requires. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** An iCalendar file with one all-day event per dated obligation. */
export function toIcs(items: CalendarObligation[], now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LegalGPT//Obligations//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Contract obligations",
  ];
  for (const item of items) {
    if (!item.dueDate) continue;
    const day = item.dueDate.replace(/-/g, "");
    const next = new Date(`${item.dueDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.id}@legalgpt`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(`${item.contractTitle}: ${item.description}`)}`,
      `DESCRIPTION:${escapeIcs(
        `${item.quotedText ? `"${item.quotedText}"\n\n` : ""}Not legal advice. Check the contract before acting.`,
      )}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P7D",
      `DESCRIPTION:${escapeIcs(item.description)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export function daysUntil(dueDate: string, today: string): number {
  const ms = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The reminder threshold due today for an obligation, if any. A threshold is
 * due once the date is that close and it has not been sent yet; if the sweep
 * missed a day, the nearest unsent threshold is used, so nothing is skipped
 * and nothing repeats.
 */
export function dueThreshold(
  dueDate: string | null,
  today: string,
  sent: number[],
): number | null {
  if (!dueDate) return null;
  const days = daysUntil(dueDate, today);
  if (days < 0) return null;
  // The nearest threshold the date has passed. Once it is sent, any larger
  // threshold that was missed is moot: a "30 days" reminder must never follow
  // a "7 days" one.
  const reached = REMINDER_DAYS.filter((threshold) => days <= threshold);
  if (reached.length === 0) return null;
  const nearest = Math.min(...reached);
  return sent.includes(nearest) ? null : nearest;
}
