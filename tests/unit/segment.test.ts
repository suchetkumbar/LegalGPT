import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normaliseText } from "@/lib/pipeline/parse";
import { segmentContract, type Segment } from "@/lib/pipeline/segment";

function fixture(name: string): string {
  return normaliseText(readFileSync(`tests/fixtures/contracts/${name}.txt`, "utf8"));
}

function labels(segments: Segment[]): string[] {
  return segments.map((s) => s.number ?? s.heading ?? "?");
}

function find(segments: Segment[], number: string): Segment {
  const segment = segments.find((s) => s.number === number);
  if (!segment) throw new Error(`no clause ${number}`);
  return segment;
}

describe("segmentContract on the sample contracts", () => {
  it("splits a numbered NDA into sub-clauses with inherited headings", () => {
    const segments = segmentContract(fixture("mutual-nda"));

    expect(labels(segments)).toEqual([
      "Preamble",
      "Recitals",
      "1.1",
      "1.2",
      "2.1",
      "2.2",
      "2.3",
      "3",
      "4.1",
      "4.2",
      "4.3",
      "5",
      "6",
      "7",
      "8.1",
      "8.2",
      "8.3",
      "9.1",
      "9.2",
      "9.3",
      "Signatures",
    ]);
    expect(find(segments, "2.2").heading).toBe("Obligations of the Receiving Party");
    expect(find(segments, "8.2").heading).toBe("Governing Law and Dispute Resolution");
    expect(find(segments, "8.2").text).toContain(
      "Arbitration and Conciliation Act, 1996",
    );
  });

  it("does not treat a wrapped line that starts with a number as a clause", () => {
    const clause = find(segmentContract(fixture("mutual-nda")), "4.2");
    expect(clause.text).toContain("by giving\n30 days written notice");
  });

  it("keeps lettered items inside their parent clause", () => {
    const clause = find(segmentContract(fixture("mutual-nda")), "3");
    expect(clause.text).toContain("(a) is or becomes publicly available");
    expect(clause.text).toContain("(d) is required to be disclosed by law");
  });

  it("handles headings without a dot after the number, and keeps schedules whole", () => {
    const segments = segmentContract(fixture("services-agreement"));

    expect(labels(segments)).toEqual([
      "Preamble",
      "Recitals",
      "1.1",
      "1.2",
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "3",
      "4.1",
      "4.2",
      "5.1",
      "5.2",
      "6.1",
      "6.2",
      "6.3",
      "7.1",
      "7.2",
      "8.1",
      "8.2",
      "9",
      "10",
      "Signatures",
      "Schedule A Fees",
      "Schedule B Service Levels",
    ]);
    expect(find(segments, "6.3").heading).toBe("Limitation of Liability");

    // The numbered list inside a schedule must not restart clause numbering.
    const scheduleA = segments.find((s) => s.heading === "Schedule A Fees");
    expect(scheduleA?.text).toContain("1. Monthly retainer");
    expect(scheduleA?.text).toContain("3. Travel outside Hyderabad");
  });

  it('handles "Clause N: Title" headings and ignores a clause reference mid-sentence', () => {
    const segments = segmentContract(fixture("employment-agreement"));

    expect(labels(segments)).toEqual([
      "Preamble",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "Signatures",
    ]);
    expect(find(segments, "7").heading).toBe("Non-Compete");
    expect(find(segments, "5").text).toContain("Clause 5 shall survive termination");
  });

  it.each(["mutual-nda", "services-agreement", "employment-agreement"])(
    "covers %s with exact, ordered, non-overlapping offsets",
    (name) => {
      const source = fixture(name);
      const segments = segmentContract(source);

      let previousEnd = 0;
      segments.forEach((segment, index) => {
        expect(segment.ordinal).toBe(index);
        expect(source.slice(segment.startOffset, segment.endOffset)).toBe(segment.text);
        expect(segment.startOffset).toBeGreaterThanOrEqual(previousEnd);
        // Only whitespace may fall between two segments.
        expect(source.slice(previousEnd, segment.startOffset).trim()).toBe("");
        previousEnd = segment.endOffset;
      });
      expect(segments[0].startOffset).toBe(0);
      expect(source.slice(previousEnd).trim()).toBe("");
    },
  );
});

describe("segmentContract edge cases", () => {
  it("returns nothing for empty text", () => {
    expect(segmentContract("")).toEqual([]);
    expect(segmentContract("  \n\n ")).toEqual([]);
  });

  it("returns the whole text as one segment when there is no structure", () => {
    const text = "The parties agree to cooperate in good faith.";
    expect(segmentContract(text)).toMatchObject([
      { ordinal: 0, heading: "Preamble", text, startOffset: 0, endOffset: text.length },
    ]);
  });

  it("requires numbering to start at 1 and run in sequence", () => {
    const text = [
      "AGREEMENT",
      "",
      "1. Term",
      "This Agreement lasts for",
      "12. months from signing.",
      "",
      "2. Fees",
      "Fees are payable monthly.",
    ].join("\n");

    expect(labels(segmentContract(text))).toEqual(["Preamble", "1", "2"]);
  });

  it("tolerates one clause number lost in extraction", () => {
    const text = [
      "1. Term",
      "One year.",
      "",
      "3. Fees",
      "Monthly.",
      "",
      "4. Law",
      "India.",
    ].join("\n");
    expect(labels(segmentContract(text))).toEqual(["1", "3", "4"]);
  });

  it("takes an inline heading from the start of the clause", () => {
    const text = [
      "1. Term. This Agreement begins on the Effective Date.",
      "",
      "2. The Supplier shall deliver the goods within thirty days of the order.",
    ].join("\n");
    const segments = segmentContract(text);

    expect(segments[0]).toMatchObject({ number: "1", heading: "Term" });
    expect(segments[1]).toMatchObject({ number: "2", heading: null });
  });

  it("reads roman-numbered articles", () => {
    const text = [
      "ARTICLE I - DEFINITIONS",
      "Terms have the meanings given.",
      "",
      "ARTICLE II - SERVICES",
      "The services are described below.",
      "",
      "ARTICLE III - FEES",
      "Fees are due monthly.",
    ].join("\n");
    const segments = segmentContract(text);

    expect(labels(segments)).toEqual(["I", "II", "III"]);
    expect(segments[1].heading).toBe("Services");
  });

  it("keeps an introduction that sits between a heading and its first sub-clause", () => {
    const text = [
      "1. PAYMENT",
      "The following terms apply to all invoices raised under this Agreement.",
      "The Client accepts them in full.",
      "1.1 Invoices are due in 30 days.",
      "1.2 Late invoices attract interest.",
    ].join("\n");

    expect(labels(segmentContract(text))).toEqual(["1", "1.1", "1.2"]);
  });

  it('reads "1)" and "(1)" numbering, and leaves a bracketed list inside a clause alone', () => {
    const paren = [
      "1) Term",
      "One year.",
      "",
      "2) Fees",
      "Monthly.",
      "",
      "3) Law",
      "India.",
    ];
    expect(labels(segmentContract(paren.join("\n")))).toEqual(["1", "2", "3"]);

    const bracket = ["(1) TERM", "One year.", "", "(2) FEES", "Monthly."];
    expect(labels(segmentContract(bracket.join("\n")))).toEqual(["1", "2"]);

    // The document numbers clauses "1.", so "(2)" is a list item, not clause 2.
    const mixed = [
      "1. Conditions",
      "The following conditions apply:",
      "(1) the goods are delivered; and",
      "(2) the invoice is received.",
      "",
      "2. Fees",
      "Monthly.",
    ];
    const segments = segmentContract(mixed.join("\n"));
    expect(labels(segments)).toEqual(["1", "2"]);
    expect(segments[0].text).toContain("(2) the invoice is received.");
  });

  it("rejoins a clause number that was split from its heading", () => {
    const text = [
      "1.",
      "TERM",
      "One year.",
      "",
      "2.",
      "FEES",
      "",
      "2.1 Fees are payable monthly.",
      "2.2 Late fees attract interest.",
    ].join("\n");
    const segments = segmentContract(text);

    expect(labels(segments)).toEqual(["1", "2.1", "2.2"]);
    expect(segments[0].heading).toBe("Term");
    expect(segments[1].heading).toBe("Fees");
  });

  it("recovers after several clause headings are lost in a row", () => {
    const text = [
      "1. TERM",
      "One year.",
      "",
      "2. FEES",
      "Monthly. 3. TAXES Extra. 4. NOTICES By post. 5. WAIVER None.",
      "",
      "6. GOVERNING LAW",
      "India.",
      "",
      "7. GENERAL",
      "Entire agreement.",
    ].join("\n");

    expect(labels(segmentContract(text))).toEqual(["1", "2", "6", "7"]);
  });

  it("does not jump ahead on a number that merely starts a wrapped sentence", () => {
    const text = [
      "1. TERM",
      "The term is one year and may be extended by",
      "5. years at the option of the Client.",
      "",
      "2. FEES",
      "Monthly.",
    ].join("\n");

    expect(labels(segmentContract(text))).toEqual(["1", "2"]);
  });

  it("picks up sub-clauses whose parent heading was lost", () => {
    const text = [
      "1. TERM",
      "",
      "1.1 One year.",
      "1.2 Renewable. 2. FEES",
      "",
      "2.1 Fees are payable monthly.",
      "2.2 Late fees attract interest.",
      "",
      "3. LAW",
      "India.",
    ].join("\n");
    const segments = segmentContract(text);

    expect(labels(segments)).toEqual(["1.1", "1.2", "2.1", "2.2", "3"]);
    // The lost heading is not guessed: 2.1 must not inherit "Term".
    expect(segments[2].heading).toBeNull();
    expect(segments[3].heading).toBeNull();
  });

  it("keeps recitals and the signature block in a contract with no numbering", () => {
    const text = [
      "LEAVE AND LICENCE AGREEMENT",
      "Made at Mumbai between the Licensor and the Licensee.",
      "",
      "WHEREAS the Licensor owns the premises;",
      "",
      "LICENCE FEE",
      "Rs. 45,000 per month.",
      "",
      "SECURITY DEPOSIT",
      "Rs. 2,00,000, interest free.",
      "",
      "LOCK-IN PERIOD",
      "Eleven months.",
      "",
      "IN WITNESS WHEREOF the parties have signed.",
      "",
      "SCHEDULE A - PREMISES",
      "",
      "FLAT 12, SEA VIEW",
    ].join("\n");

    expect(segmentContract(text).map((s) => s.heading)).toEqual([
      "Preamble",
      "Recitals",
      "Licence Fee",
      "Security Deposit",
      "Lock-In Period",
      "Signatures",
      "Schedule A Premises",
    ]);
  });

  it("falls back to capitalised headings when nothing is numbered", () => {
    const text = [
      "LEAVE AND LICENCE AGREEMENT",
      "Made at Mumbai.",
      "",
      "LICENCE FEE",
      "The licensee shall pay Rs. 45,000 per month.",
      "",
      "SECURITY DEPOSIT",
      "An interest-free deposit of Rs. 2,00,000 is payable.",
      "",
      "LOCK-IN PERIOD",
      "Neither party may terminate for 11 months.",
    ].join("\n");

    expect(segmentContract(text).map((s) => s.heading)).toEqual([
      "Preamble",
      "Licence Fee",
      "Security Deposit",
      "Lock-In Period",
    ]);
  });
});
