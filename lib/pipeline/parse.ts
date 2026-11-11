import type { FileKind } from "./file-type";

export type ParsedDocument = {
  /** Normalised plain text. Every clause offset indexes into this string. */
  text: string;
  pageCount: number | null;
};

/** A problem with the document itself, safe to show to the user as written. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

/** Below this many characters per page, a PDF is almost certainly a scan. */
const MIN_CHARS_PER_PDF_PAGE = 80;

/**
 * One canonical form for all extracted text, so offsets stay stable and the
 * segmenter only has to deal with "\n" line breaks and plain spaces.
 */
export function normaliseText(raw: string): string {
  return (
    raw
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      // Form feeds and vertical tabs mark page or section breaks.
      .replace(/[\f\v]/g, "\n")
      // Zero-width characters, soft hyphens and the byte-order mark.
      .replace(/[​-‍⁠­﻿]/g, "")
      // Non-breaking and other unusual spaces, and tabs, become plain spaces.
      .replace(/[\t   -   　]/g, " ")
      .replace(/ +$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const { extractTextItems } = await import("unpdf");
  let pages;
  try {
    // unpdf takes ownership of the buffer, so hand it a copy.
    pages = await extractTextItems(new Uint8Array(bytes));
  } catch {
    throw new DocumentError(
      "This PDF could not be read. It may be damaged or password-protected.",
    );
  }

  // Rebuild lines from the positioned text runs: line breaks carry the clause
  // numbering the segmenter depends on.
  const pageTexts = pages.items.map((items) => {
    let page = "";
    for (const item of items) {
      page += item.str;
      if (item.hasEOL) page += "\n";
    }
    return page;
  });

  const text = normaliseText(pageTexts.join("\n\n"));
  if (text.length < MIN_CHARS_PER_PDF_PAGE * Math.max(1, pages.totalPages)) {
    throw new DocumentError(
      "This PDF looks like a scan: it has pages but almost no selectable text. " +
        "Scanned documents are not supported yet.",
    );
  }
  return { text, pageCount: pages.totalPages };
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  let raw;
  try {
    raw = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  } catch {
    throw new DocumentError("This Word document could not be read. It may be damaged.");
  }
  return { text: normaliseText(raw.value), pageCount: null };
}

export async function parseDocument(
  bytes: Uint8Array,
  kind: FileKind,
): Promise<ParsedDocument> {
  const parsed =
    kind === "pdf"
      ? await parsePdf(bytes)
      : kind === "docx"
        ? await parseDocx(bytes)
        : {
            text: normaliseText(new TextDecoder("utf-8").decode(bytes)),
            pageCount: null,
          };

  if (parsed.text.length === 0) {
    throw new DocumentError("This document has no text in it.");
  }
  return parsed;
}
