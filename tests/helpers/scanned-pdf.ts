import { GlobalFonts, createCanvas } from "@napi-rs/canvas";

/** Whether this machine has any font to draw text with. */
export function canDrawText(): boolean {
  return GlobalFonts.families.length > 0;
}

/**
 * Builds a PDF the way a scanner does: each page is a single image of the
 * text, with no selectable text at all.
 */
export function makeScannedPdf(lines: string[]): Uint8Array {
  const width = 1240;
  const height = 1754; // A4 at about 150 dpi
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.font = "30px sans-serif";
  lines.forEach((line, index) => context.fillText(line, 100, 140 + index * 52));
  const jpeg = canvas.toBuffer("image/jpeg", 92);

  const content = `q ${width / 2} 0 0 ${height / 2} 0 0 cm /Im0 Do Q`;
  const head = (body: string) => Buffer.from(body, "latin1");
  const objects: Buffer[] = [
    head("<< /Type /Catalog /Pages 2 0 R >>"),
    head("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    head(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width / 2} ${height / 2}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
    ),
    head(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
    Buffer.concat([
      head(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      head("\nendstream"),
    ]),
  ];

  const parts: Buffer[] = [head("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([
      head(`${index + 1} 0 obj\n`),
      body,
      head("\nendobj\n"),
    ]);
    parts.push(object);
    length += object.length;
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(head(tail));

  return new Uint8Array(Buffer.concat(parts));
}
