import os from "node:os";
import path from "node:path";

import { DocumentError } from "./errors";

/**
 * OCR for scanned PDFs, run entirely inside the app with Tesseract: nothing
 * is sent to an outside service. Each page is rendered to an image and read.
 *
 * It is slower and less exact than reading a text PDF (a few seconds a page,
 * and the odd misread character), so the result is flagged and the UI tells
 * the reader to check wording against the original.
 */

export type OcrResult = {
  text: string;
  pageCount: number;
  /** Tesseract's own mean confidence across pages, 0-100. */
  confidence: number;
};

export type OcrFunction = (bytes: Uint8Array) => Promise<OcrResult>;

/** Long scans would run past the function time limit; refuse them clearly. */
export const MAX_OCR_PAGES = 40;
/** Below this, the text is too unreliable to build a review on. */
const MIN_CONFIDENCE = 55;
/** Render at twice the PDF's nominal size: roughly 150 dpi, which Tesseract needs. */
const RENDER_SCALE = 2;

/** English language data, shipped with the app rather than downloaded at run time. */
const LANGUAGE_DATA = path.join(
  process.cwd(),
  "node_modules",
  "@tesseract.js-data",
  "eng",
  "4.0.0_best_int",
);

export const ocrPdf: OcrFunction = async (bytes) => {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const { createWorker } = await import("tesseract.js");

  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new DocumentError(
      "This PDF could not be read. It may be damaged or password-protected.",
    );
  }
  const pageCount = pdf.numPages;
  if (pageCount > MAX_OCR_PAGES) {
    throw new DocumentError(
      `This is a scanned document of ${pageCount} pages. Scans of more than ${MAX_OCR_PAGES} pages are not supported yet.`,
    );
  }

  const worker = await createWorker("eng", 1, {
    langPath: LANGUAGE_DATA,
    gzip: true,
    cachePath: os.tmpdir(),
  });
  try {
    const pages: string[] = [];
    let confidence = 0;
    for (let page = 1; page <= pageCount; page++) {
      const image = await renderPageAsImage(pdf, page, {
        scale: RENDER_SCALE,
        canvasImport: () => import("@napi-rs/canvas"),
      });
      const { data } = await worker.recognize(Buffer.from(image));
      pages.push(data.text);
      confidence += data.confidence;
    }
    return { text: pages.join("\n\n"), pageCount, confidence: confidence / pageCount };
  } finally {
    await worker.terminate();
  }
};

/** Turns an OCR result into usable text, or explains why it is not usable. */
export function acceptOcr(result: OcrResult): string {
  if (result.text.trim().length < 40) {
    throw new DocumentError(
      "This PDF is a scan and no readable text could be found in it, even with OCR.",
    );
  }
  if (result.confidence < MIN_CONFIDENCE) {
    throw new DocumentError(
      "This PDF is a scan and it is too faint or skewed to read reliably. Try a clearer scan.",
    );
  }
  return result.text;
}
