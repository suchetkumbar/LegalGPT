import { describe, expect, it } from "vitest";

import { detectFileKind } from "@/lib/pipeline/file-type";
import { DocumentError, normaliseText, parseDocument } from "@/lib/pipeline/parse";
import { segmentContract } from "@/lib/pipeline/segment";

import { makeDocx, makePdf } from "../helpers/documents";

const encode = (text: string) => new TextEncoder().encode(text);

const CONTRACT_LINES = [
  "SERVICE AGREEMENT",
  "This Agreement is made at New Delhi between Yamuna Traders Pvt Ltd and Ganga Exports LLP.",
  "1. Term",
  "This Agreement is valid for one year from the date of signing.",
  "2. Fees",
  "The fees are Rs. 1,50,000 per month, payable within 30 days of invoice.",
  "3. Governing Law",
  "This Agreement is governed by the laws of India.",
];

describe("detectFileKind", () => {
  it("recognises each supported type from its contents", async () => {
    expect(detectFileKind(makePdf(["hello"]), "contract.pdf")).toBe("pdf");
    expect(detectFileKind(await makeDocx(["hello"]), "contract.docx")).toBe("docx");
    expect(detectFileKind(encode("Plain text contract"), "contract.txt")).toBe("txt");
  });

  it("goes by content, not by the file name", () => {
    expect(detectFileKind(makePdf(["hello"]), "renamed.txt")).toBe("pdf");
  });

  it("rejects files that are not what they claim to be", async () => {
    // An executable renamed to .pdf.
    expect(
      detectFileKind(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), "invoice.pdf"),
    ).toBeNull();
    // A zip that is not a Word document.
    expect(detectFileKind(await makeDocx(["hello"]), "archive.zip")).toBeNull();
    // Binary data with a .txt name.
    expect(detectFileKind(new Uint8Array([0x00, 0xff, 0xfe]), "notes.txt")).toBeNull();
    expect(detectFileKind(new Uint8Array([]), "empty.txt")).toBeNull();
    expect(detectFileKind(encode("<html></html>"), "page.html")).toBeNull();
  });
});

describe("normaliseText", () => {
  it("produces one canonical form", () => {
    const raw = "﻿Line one\r\nLine two  \r\n\r\n\r\n\r\nLine\tthree​\f";
    expect(normaliseText(raw)).toBe("Line one\nLine two\n\nLine three");
  });
});

describe("parseDocument", () => {
  it("reads plain text", async () => {
    const parsed = await parseDocument(encode(CONTRACT_LINES.join("\r\n")), "txt");
    expect(parsed).toEqual({ text: CONTRACT_LINES.join("\n"), pageCount: null });
  });

  it("reads a PDF and keeps its line structure, so clauses can be found", async () => {
    const parsed = await parseDocument(makePdf(CONTRACT_LINES), "pdf");

    expect(parsed.pageCount).toBe(1);
    expect(parsed.text).toContain("Rs. 1,50,000 per month");
    expect(segmentContract(parsed.text).map((s) => s.number)).toEqual([
      null,
      "1",
      "2",
      "3",
    ]);
  });

  it("reads a Word document", async () => {
    const parsed = await parseDocument(await makeDocx(CONTRACT_LINES), "docx");

    expect(parsed.text).toContain("Yamuna Traders Pvt Ltd");
    expect(segmentContract(parsed.text).map((s) => s.heading)).toEqual([
      "Preamble",
      "Term",
      "Fees",
      "Governing Law",
    ]);
  });

  it("reports a PDF with no selectable text as a scan", async () => {
    await expect(parseDocument(makePdf([""]), "pdf")).rejects.toThrow(
      /looks like a scan/,
    );
  });

  it("reports unreadable files without leaking parser internals", async () => {
    const brokenPdf = encode("%PDF-1.4 this is not really a pdf");
    await expect(parseDocument(brokenPdf, "pdf")).rejects.toBeInstanceOf(DocumentError);

    const brokenDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expect(parseDocument(brokenDocx, "docx")).rejects.toThrow(/could not be read/);
  });

  it("rejects a document with no text", async () => {
    await expect(parseDocument(encode("  \n \n"), "txt")).rejects.toThrow(/no text/);
  });
});
