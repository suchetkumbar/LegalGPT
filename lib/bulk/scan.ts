import JSZip from "jszip";

import {
  MAX_UPLOAD_BYTES,
  detectFileKind,
  type FileKind,
} from "@/lib/pipeline/file-type";

/**
 * Bulk scan: a zip of contracts, each analysed like a normal upload. The plan
 * used the paid Batch API; on the free tier the analyses are queued instead
 * and run one at a time per organisation, throttled to stay inside the model
 * quota, so a large batch finishes over hours rather than minutes.
 */

export const MAX_BULK_FILES = 200;
/** Zip bombs: refuse archives that would expand to more than this. */
const MAX_TOTAL_UNCOMPRESSED = 400 * 1024 * 1024;

export type BulkFile = { name: string; bytes: Uint8Array; kind: FileKind };
export type BulkSkip = { name: string; reason: string };

export class BulkError extends Error {}

export async function readArchive(
  bytes: Uint8Array,
): Promise<{ files: BulkFile[]; skipped: BulkSkip[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new BulkError("That file is not a valid zip archive.");
  }

  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !/(^|\/)(__MACOSX|\.)/.test(entry.name),
  );
  if (entries.length === 0) throw new BulkError("The archive is empty.");
  if (entries.length > MAX_BULK_FILES) {
    throw new BulkError(
      `The archive has ${entries.length} files; the limit is ${MAX_BULK_FILES}.`,
    );
  }

  const files: BulkFile[] = [];
  const skipped: BulkSkip[] = [];
  let total = 0;
  for (const entry of entries) {
    const name = entry.name.split("/").pop()!.slice(0, 255);
    const content = await entry.async("uint8array");
    total += content.length;
    if (total > MAX_TOTAL_UNCOMPRESSED)
      throw new BulkError("The archive expands to more than 400 MB.");
    if (content.length === 0) {
      skipped.push({ name, reason: "empty" });
      continue;
    }
    if (content.length > MAX_UPLOAD_BYTES) {
      skipped.push({ name, reason: "larger than 20 MB" });
      continue;
    }
    const kind = detectFileKind(content, name);
    if (!kind) {
      skipped.push({ name, reason: "not a PDF, Word or text file" });
      continue;
    }
    files.push({ name, bytes: content, kind });
  }
  return { files, skipped };
}
