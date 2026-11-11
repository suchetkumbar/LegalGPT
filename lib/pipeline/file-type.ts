export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type FileKind = "pdf" | "docx" | "txt";

export const MIME_TYPES: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides what a file is from its contents, not from the name or the MIME
 * type the browser sent, since both are under the uploader's control. The
 * extension is only used to tell a .docx from other zip-based formats and to
 * require that plain text was meant to be plain text.
 */
export function detectFileKind(bytes: Uint8Array, fileName: string): FileKind | null {
  const extension = fileName.toLowerCase().split(".").pop();

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return extension === "docx" ? "docx" : null; // zip container
  }
  if (extension === "txt" && bytes.length > 0 && isUtf8Text(bytes)) return "txt";
  return null;
}
