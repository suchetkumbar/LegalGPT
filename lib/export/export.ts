import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

/**
 * Exports. Findings as CSV or JSON, and the contract as a Word document in
 * which each proposed change is shown redline-style: the current words struck
 * through in red, the replacement underlined in blue straight after.
 *
 * These are formatting marks, not Word's tracked changes, so the other side
 * sees the proposal but cannot accept it with one click.
 */

export const DISCLAIMER = "Not legal advice. Review findings with a qualified lawyer.";

export type ExportFinding = {
  id: string;
  title: string;
  kind: string;
  category: string;
  severity: number;
  likelihood: number;
  status: string;
  clause: string | null;
  quotedText: string | null;
  reasoning: string;
  suggestedFix: string | null;
  model: string | null;
};

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function findingsToCsv(findings: ExportFinding[]): string {
  const columns: (keyof ExportFinding)[] = [
    "title",
    "kind",
    "category",
    "severity",
    "likelihood",
    "status",
    "clause",
    "quotedText",
    "reasoning",
    "suggestedFix",
    "model",
  ];
  const rows = [
    columns.join(","),
    ...findings.map((finding) =>
      columns.map((column) => csvCell(finding[column])).join(","),
    ),
  ];
  // A leading byte-order mark makes Excel read the file as UTF-8 (for ₹ and Hindi).
  return `﻿${rows.join("\r\n")}\r\n`;
}

export type RedlineClause = { text: string };
export type Replacement = { quote: string; text: string };

/** Splits a clause into runs, marking each replaced quote and its replacement. */
export function redlineRuns(
  clauseText: string,
  replacements: Replacement[],
): { text: string; mark?: "removed" | "added" }[] {
  const hits = replacements
    .map((replacement) => ({ ...replacement, at: clauseText.indexOf(replacement.quote) }))
    .filter((hit) => hit.at >= 0 && hit.quote.length > 0)
    .sort((a, b) => a.at - b.at);

  const runs: { text: string; mark?: "removed" | "added" }[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.at < cursor) continue; // overlapping quotes: keep the first
    if (hit.at > cursor) runs.push({ text: clauseText.slice(cursor, hit.at) });
    runs.push({ text: hit.quote, mark: "removed" });
    runs.push({ text: ` ${hit.text}`, mark: "added" });
    cursor = hit.at + hit.quote.length;
  }
  if (cursor < clauseText.length) runs.push({ text: clauseText.slice(cursor) });
  return runs;
}

export async function redlineDocx(input: {
  title: string;
  clauses: { text: string; replacements: Replacement[] }[];
  note?: string;
}): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: input.title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({ text: input.note ?? DISCLAIMER, italics: true, size: 18 }),
      ],
      spacing: { after: 240 },
    }),
  ];

  for (const clause of input.clauses) {
    for (const [index, line] of clause.text.split("\n").entries()) {
      // Replacements are matched against the whole clause, so apply them to
      // the first line only when the clause is a single line; otherwise per line.
      const runs = redlineRuns(line, clause.replacements);
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: index === clause.text.split("\n").length - 1 ? 200 : 60 },
          children: runs.map(
            (run) =>
              new TextRun({
                text: run.text,
                ...(run.mark === "removed" ? { strike: true, color: "C00000" } : {}),
                ...(run.mark === "added" ? { underline: {}, color: "1F4E9E" } : {}),
              }),
          ),
        }),
      );
    }
  }

  return Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
}

/** A plain Word document, for a generated draft. */
export function draftDocx(title: string, text: string): Promise<Buffer> {
  return redlineDocx({
    title,
    clauses: text.split(/\n{2,}/).map((block) => ({ text: block, replacements: [] })),
    note: `Draft prepared with LegalGPT. ${DISCLAIMER}`,
  });
}

export function safeFileName(title: string, extension: string): string {
  const base =
    title
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "contract";
  return `${base}.${extension}`;
}
