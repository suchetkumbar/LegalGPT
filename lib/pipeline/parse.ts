import { DocumentError } from "./errors";
import type { FileKind } from "./file-type";
import { acceptOcr, type OcrFunction } from "./ocr";

export { DocumentError };

export type ParsedDocument = {
  /** Normalised plain text. Every clause offset indexes into this string. */
  text: string;
  pageCount: number | null;
  /** True when the text came from OCR of a scan rather than from the file itself. */
  ocr: boolean;
};

export type ParseOptions = {
  /** Reads a scanned PDF. Defaults to Tesseract (./ocr.ts); tests pass a fake. */
  ocr?: OcrFunction;
  /** Called when OCR starts, so progress can say why this document is slow. */
  onOcrStart?: () => void | Promise<void>;
};

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
      .replace(/[\u200b-\u200d\u2060\u00ad\ufeff]/g, "")
      // Non-breaking and other unusual spaces, and tabs, become plain spaces.
      .replace(/[\t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
      .replace(/ +$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

async function parsePdf(
  bytes: Uint8Array,
  options: ParseOptions,
): Promise<ParsedDocument> {
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
  if (text.length >= MIN_CHARS_PER_PDF_PAGE * Math.max(1, pages.totalPages)) {
    return { text, pageCount: pages.totalPages, ocr: false };
  }

  // Pages but almost no selectable text: a scan. Read the page images instead.
  await options.onOcrStart?.();
  const ocr = options.ocr ?? (await import("./ocr")).ocrPdf;
  const result = await ocr(bytes);
  return {
    text: normaliseText(acceptOcr(result)),
    pageCount: result.pageCount,
    ocr: true,
  };
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  let raw;
  try {
    raw = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  } catch {
    throw new DocumentError("This Word document could not be read. It may be damaged.");
  }
  return { text: normaliseText(raw.value), pageCount: null, ocr: false };
}

export async function parseDocument(
  bytes: Uint8Array,
  kind: FileKind,
  options: ParseOptions = {},
): Promise<ParsedDocument> {
  const parsed =
    kind === "pdf"
      ? await parsePdf(bytes, options)
      : kind === "docx"
        ? await parseDocx(bytes)
        : {
            text: normaliseText(new TextDecoder("utf-8").decode(bytes)),
            pageCount: null,
            ocr: false,
          };

  if (parsed.text.length === 0) {
    throw new DocumentError("This document has no text in it.");
  }
  return parsed;
}
