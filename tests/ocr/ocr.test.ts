import { describe, expect, it } from "vitest";

import { detectFileKind } from "@/lib/pipeline/file-type";
import { MAX_OCR_PAGES, acceptOcr } from "@/lib/pipeline/ocr";
import { parseDocument } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";

import { canDrawText, makeScannedPdf } from "../helpers/scanned-pdf";

const LINES = [
  "RENT AGREEMENT",
  "This Agreement is made at Jaipur between the Owner and the Tenant.",
  "1. Rent",
  "The Tenant shall pay rent of Rs. 25,000 per month.",
  "2. Security Deposit",
  "The Tenant shall pay a deposit of Rs. 75,000.",
  "3. Notice Period",
  "Either party may terminate by giving 30 days notice.",
];

describe("acceptOcr", () => {
  it("passes text through when the scan was read confidently", () => {
    const text = "1. Rent\nThe Tenant shall pay rent of Rs. 25,000 per month.";
    expect(acceptOcr({ text, pageCount: 1, confidence: 90 })).toBe(text);
  });

  it("refuses an empty or unreliable result with a message for the user", () => {
    expect(() => acceptOcr({ text: " \n", pageCount: 1, confidence: 90 })).toThrow(
      /no readable text/,
    );
    const garbled = "l. R3nt Th3 T3nant sha11 pay r3nt 0f Rs. 2S,OOO p3r m0nth";
    expect(() => acceptOcr({ text: garbled, pageCount: 1, confidence: 40 })).toThrow(
      /too faint or skewed/,
    );
  });

  it("has a page cap", () => {
    expect(MAX_OCR_PAGES).toBe(40);
  });
});

// Real Tesseract on a real image-only PDF. Needs a system font to draw the
// test page; machines without one skip it rather than fail.
describe.skipIf(!canDrawText())("OCR of a scanned PDF", () => {
  it("reads an image-only PDF with Tesseract and finds its clauses", async () => {
    const pdf = makeScannedPdf(LINES);
    expect(detectFileKind(pdf, "scan.pdf")).toBe("pdf");

    const parsed = await parseDocument(pdf, "pdf");

    expect(parsed.ocr).toBe(true);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.text).toContain("RENT AGREEMENT");
    expect(parsed.text).toMatch(/25,000 per month/);
    expect(parsed.text).toMatch(/30 days notice/);

    const segments = segmentContract(parsed.text);
    expect(segments.map((s) => s.number)).toEqual([null, "1", "2", "3"]);
    expect(segments[2].heading).toBe("Security Deposit");
  }, 120_000);
});
