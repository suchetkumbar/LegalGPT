import { readFileSync } from "node:fs";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  alignClauses,
  compareVersions,
  summariseChanges,
  type CompareClause,
} from "@/lib/compare/compare";
import { BUILT_IN_PACKS } from "@/lib/compliance/packs";
import {
  assembleDraft,
  contractTypeFor,
  refineDraft,
  reviewDraft,
  type Requirements,
} from "@/lib/drafting/generate";
import { TEMPLATES } from "@/lib/drafting/templates";
import {
  draftDocx,
  findingsToCsv,
  redlineDocx,
  redlineRuns,
  safeFileName,
} from "@/lib/export/export";
import {
  draftProposals,
  playbookProposals,
  type NegotiationInput,
} from "@/lib/negotiate/negotiate";
import type { PipelineAi } from "@/lib/pipeline/ai";
import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";
import { DEFAULT_POSITIONS } from "@/lib/playbook/defaults";

const requirements = (templateId: string): Requirements => ({
  templateId,
  partyA: "Narmada Retail Private Limited",
  partyB: "Tungabhadra Software Solutions Private Limited",
  city: "Mumbai",
  effectiveDate: "2026-12-01",
  termMonths: 24,
  value: 4800000,
  paymentDays: 30,
  scope: "development of a point-of-sale application",
});

/** A model stand-in that returns a fixed object for any structured request. */
const fixedAi = (object: unknown): PipelineAi => ({
  async generateStructured(request) {
    return {
      object: request.schema.parse(object),
      modelId: "fake-model",
      usedFallback: false,
      usage: { tokensIn: 10, tokensOut: 5 },
    };
  },
  async embed() {
    throw new Error("not used");
  },
});

describe("drafting", () => {
  it.each(TEMPLATES.map((t) => t.id))(
    "builds a complete, low-risk %s draft from the playbook",
    (id) => {
      const template = TEMPLATES.find((t) => t.id === id)!;
      const text = assembleDraft(template, requirements(id), DEFAULT_POSITIONS);

      expect(text).not.toMatch(/\{[A-Z_]+\}/);
      expect(text).toContain("Narmada Retail Private Limited");
      expect(text).toContain("1 December 2026");
      expect(text).toMatch(/IN WITNESS WHEREOF/);
      // The segmenter reads the draft back as numbered clauses.
      expect(segmentContract(text).filter((s) => s.number).length).toBeGreaterThanOrEqual(
        3,
      );

      // The plan's target: generated drafts score under 30 on the org's own playbook.
      const review = reviewDraft(text, BUILT_IN_PACKS, contractTypeFor(id));
      expect(review.score).toBeLessThan(30);
      expect(review.findings.filter((f) => f.severity >= 4)).toEqual([]);
    },
  );

  it("is deterministic and uses Indian number formatting", () => {
    const template = TEMPLATES.find((t) => t.id === "msa")!;
    const a = assembleDraft(template, requirements("msa"), DEFAULT_POSITIONS);
    expect(assembleDraft(template, requirements("msa"), DEFAULT_POSITIONS)).toBe(a);
    expect(a).toContain("INR 48,00,000");
    expect(a).toContain("within 30 days of receipt");
  });

  it("uses the organisation's own playbook wording when it has changed", () => {
    const template = TEMPLATES.find((t) => t.id === "msa")!;
    const custom = DEFAULT_POSITIONS.map((p) =>
      p.clauseType === "limitation_of_liability"
        ? { ...p, standardText: "Liability is capped at twice the annual fees." }
        : p,
    );
    expect(assembleDraft(template, requirements("msa"), custom)).toContain(
      "Liability is capped at twice the annual fees.",
    );
  });

  it("refines a draft with one model call and normalises the result", async () => {
    const result = await refineDraft(
      fixedAi({ text: "1. TERM\r\n\r\n\r\nOne year.", changes: ["Shortened the term"] }),
      {
        text: "1. TERM\n\nTwo years.",
        instructions: "Make the term one year.",
      },
    );
    expect(result).toMatchObject({
      text: "1. TERM\n\nOne year.",
      changes: ["Shortened the term"],
      modelId: "fake-model",
    });
  });
});

const clause = (
  ordinal: number,
  number: string,
  heading: string,
  type: string,
  text: string,
): CompareClause => ({
  id: `c${ordinal}-${number}`,
  ordinal,
  number,
  heading,
  type,
  text,
});

describe("version compare", () => {
  const before = [
    clause(
      0,
      "1",
      "Term",
      "term_and_renewal",
      "1. Term\nThis Agreement lasts for two years from the Effective Date.",
    ),
    clause(
      1,
      "2",
      "Payment",
      "payment",
      "2. Payment\nThe Client shall pay each invoice within 30 days of receipt.",
    ),
    clause(
      2,
      "3",
      "Liability",
      "limitation_of_liability",
      "3. Liability\nThe total liability of each party shall not exceed the fees paid in the 12 months preceding the claim.",
    ),
    clause(
      3,
      "4",
      "Audit",
      "audit_and_records",
      "4. Audit\nThe Client may audit the records once a year on notice.",
    ),
  ];
  const after = [
    clause(
      0,
      "1",
      "Term",
      "term_and_renewal",
      "1. Term\nThis Agreement lasts for two years from the Effective Date.",
    ),
    // Moved up and renumbered, and the cap is now very low.
    clause(
      1,
      "2",
      "Liability",
      "limitation_of_liability",
      "2. Liability\nThe total liability of the Service Provider shall not exceed the fees paid in the 3 months preceding the claim.",
    ),
    clause(
      2,
      "3",
      "Payment",
      "payment",
      "3. Payment\nThe Client shall pay each invoice within 90 days of receipt.",
    ),
    clause(3, "4", "Notices", "notices", "4. Notices\nNotices shall be sent by email."),
  ];

  it("pairs clauses by content even when they move and are renumbered", () => {
    const pairs = alignClauses(before, after);
    const pairOf = (heading: string) => pairs.find(([, now]) => now?.heading === heading);
    expect(pairOf("Liability")?.[0]?.heading).toBe("Liability");
    expect(pairOf("Payment")?.[0]?.heading).toBe("Payment");
    expect(pairOf("Notices")?.[0]).toBeNull(); // added
    expect(pairs.some(([old, now]) => old?.heading === "Audit" && now === null)).toBe(
      true,
    ); // removed
  });

  it("marks changes that add a known risk as unfavourable, and shows the words that changed", () => {
    const changes = compareVersions(before, after);
    const byHeading = (heading: string) =>
      changes.find((c) => (c.after ?? c.before)!.heading === heading)!;

    expect(byHeading("Term").assessment).toBe("unchanged");
    expect(byHeading("Liability")).toMatchObject({
      assessment: "unfavourable",
      introduced: ["Liability cap is very low"],
    });
    expect(byHeading("Payment")).toMatchObject({
      assessment: "unfavourable",
      introduced: ["Long payment period"],
    });
    const payment = byHeading("Payment").diff;
    expect(payment.some((p) => p.removed && p.text.includes("30"))).toBe(true);
    expect(payment.some((p) => p.added && p.text.includes("90"))).toBe(true);

    // Reversing the direction makes the same changes favourable.
    const reversed = compareVersions(after, before);
    expect(reversed.find((c) => c.after?.heading === "Payment")).toMatchObject({
      assessment: "favourable",
      resolved: ["Long payment period"],
    });

    expect(summariseChanges(changes)).toMatchObject({
      unchanged: 1,
      unfavourable: 2,
      added: 1,
      removed: 1,
    });
  });
});

describe("exports", () => {
  it("quotes CSV cells and defuses spreadsheet formulas", () => {
    const csv = findingsToCsv([
      {
        id: "1",
        title: 'Cap "very" low, really',
        kind: "risk",
        category: "liability",
        severity: 4,
        likelihood: 3,
        status: "open",
        clause: "6.1",
        quotedText: '=HYPERLINK("x")',
        reasoning: "line one\nline two",
        suggestedFix: null,
        model: null,
      },
    ]);
    expect(csv.startsWith("﻿title,kind,")).toBe(true);
    expect(csv).toContain('"Cap ""very"" low, really"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"line one\nline two"');
  });

  it("marks each replaced quote as removed and its replacement as added", () => {
    const runs = redlineRuns("The Client shall pay within 90 days of receipt.", [
      { quote: "within 90 days", text: "within 30 days" },
      { quote: "not in the clause", text: "ignored" },
    ]);
    expect(runs).toEqual([
      { text: "The Client shall pay " },
      { text: "within 90 days", mark: "removed" },
      { text: " within 30 days", mark: "added" },
      { text: " of receipt." },
    ]);
  });

  it("writes a valid Word document with strike-through and underline", async () => {
    const file = await redlineDocx({
      title: "Services Agreement",
      clauses: [
        {
          text: "2.2 Pay within 90 days of receipt.",
          replacements: [{ quote: "within 90 days", text: "within 30 days" }],
        },
      ],
    });
    expect(file.subarray(0, 2).toString()).toBe("PK");
    const xml = await (
      await JSZip.loadAsync(file)
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain("<w:strike/>");
    expect(xml).toContain("within 30 days");
    expect(xml).toMatch(/<w:u /);
    expect(xml).toContain("Not legal advice");

    const draft = await draftDocx("NDA", "1. TERM\n\nOne year.");
    expect(draft.subarray(0, 2).toString()).toBe("PK");
  });

  it("builds a safe file name", () => {
    expect(safeFileName('Master "Services" / Agreement: v2', "docx")).toBe(
      "Master-Services-Agreement-v2.docx",
    );
    expect(safeFileName("***", "csv")).toBe("contract.csv");
  });
});

describe("negotiation", () => {
  const text = normaliseText(
    readFileSync("tests/fixtures/contracts/services-agreement.txt", "utf8"),
  );
  const position = DEFAULT_POSITIONS.find((p) => p.clauseType === "payment")!;
  const inputs: NegotiationInput[] = [
    {
      findingId: "f1",
      title: "Long payment period",
      quotedText:
        "The Client shall pay each undisputed invoice within 90 days of receipt.",
      reasoning: "Payment is due long after the invoice.",
      clauseText: text.slice(0, 200),
      position: {
        standardText: position.standardText,
        fallbackText: position.fallbackText,
        walkaway: position.walkaway,
      },
    },
    {
      findingId: "f2",
      title: "No position",
      quotedText: "x",
      reasoning: "y",
      clauseText: null,
      position: null,
    },
  ];

  it("offers playbook wording with no model call", () => {
    const proposals = playbookProposals(inputs);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      findingId: "f1",
      firm: position.standardText,
      balanced: position.fallbackText,
      source: "playbook",
    });
  });

  it("drafts three tones for every finding in a single model call", async () => {
    let calls = 0;
    const ai = fixedAi({
      proposals: [
        {
          index: 0,
          firm: "Within 30 days.",
          balanced: "Within 45 days.",
          conciliatory: "Within 60 days.",
          rationale: "Standard terms.",
        },
        {
          index: 9,
          firm: "Ignored: no such finding.",
          balanced: "",
          conciliatory: "",
          rationale: "",
        },
      ],
    });
    const counted: PipelineAi = {
      ...ai,
      generateStructured: (request) => {
        calls += 1;
        expect(request.prompt).toMatch(/^We are|<document>/m);
        return ai.generateStructured(request);
      },
    };

    const { proposals } = await draftProposals(
      counted,
      inputs,
      "Narmada Retail Private Limited",
    );
    expect(calls).toBe(1);
    expect(proposals).toEqual([
      {
        findingId: "f1",
        firm: "Within 30 days.",
        balanced: "Within 45 days.",
        conciliatory: "Within 60 days.",
        rationale: "Standard terms.",
        source: "model",
      },
    ]);
  });
});
