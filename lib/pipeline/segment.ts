/**
 * Rule-based clause segmentation: the "heading and numbering heuristics" pass
 * that runs before any model sees the contract. It is deterministic and free,
 * and gets well-formatted contracts right on its own. The model pass that
 * follows only has to repair boundaries and assign clause types.
 *
 * Granularity is two levels deep. "4. CONFIDENTIALITY" with sub-clauses 4.1,
 * 4.2 and 4.3 yields three clauses, each carrying the heading
 * "Confidentiality"; lettered items such as (a) and (i) stay inside their
 * parent. Review findings need to point at something that specific.
 *
 * Every segment's text is exactly `source.slice(startOffset, endOffset)`.
 */

export type Segment = {
  ordinal: number;
  /** The label as printed: "4", "4.2", "IV", or null for unnumbered parts. */
  number: string | null;
  heading: string | null;
  text: string;
  startOffset: number;
  endOffset: number;
};

type Line = { text: string; start: number; end: number };

type Marker =
  | {
      kind: "top";
      start: number;
      number: string;
      heading: string | null;
      hasBody: boolean;
    }
  | { kind: "sub"; start: number; number: string }
  | { kind: "part"; start: number; heading: string };

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanToInt(value: string): number | null {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const current = ROMAN[value[i]];
    const next = ROMAN[value[i + 1]];
    if (!current) return null;
    total += next && next > current ? -current : current;
  }
  return total > 0 ? total : null;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const text of source.split("\n")) {
    lines.push({ text, start, end: start + text.length });
    start += text.length + 1;
  }
  return lines;
}

const SENTENCE_END = /[.;,]$/;

/** A short line that reads as a title rather than a sentence. */
function looksLikeHeading(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 90) return false;
  if (!/^["“(]?[A-Z]/.test(trimmed)) return false;
  // "DEFINITIONS." is still a heading; "The Company shall pay." is not.
  const isUpperCase = trimmed === trimmed.toUpperCase();
  return isUpperCase || !SENTENCE_END.test(trimmed);
}

function tidyHeading(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[.:\-–—\s]+$/, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  // "CONFIDENTIALITY" reads better in an outline as "Confidentiality".
  if (cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .replace(
        /(^|[\s(/-])([a-z])/g,
        (_, before, letter) => before + letter.toUpperCase(),
      )
      .replace(/ (Of|And|The|In|To|For|Or|On|By|With)(?= )/g, (word) =>
        word.toLowerCase(),
      );
  }
  return cleaned;
}

/**
 * Splits "Term. This Agreement begins on ..." into a heading and the fact
 * that body text follows on the same line.
 */
function headingFromRest(rest: string): { heading: string | null; hasBody: boolean } {
  const trimmed = rest.trim();
  if (!trimmed) return { heading: null, hasBody: false };
  if (looksLikeHeading(trimmed)) return { heading: tidyHeading(trimmed), hasBody: false };

  const inline = /^([A-Z][A-Za-z0-9 ,&/'’()-]{1,60}?)[.:]\s+\S/.exec(trimmed);
  if (inline && inline[1].split(" ").length <= 8) {
    return { heading: tidyHeading(inline[1]), hasBody: true };
  }
  return { heading: null, hasBody: true };
}

const TOP_NUMBERED = /^ {0,6}(\d{1,3})(\.?)(?:[ ]+|$)(.*)$/;
const TOP_WORDED =
  /^ {0,6}(clause|article|section)\s+(\d{1,3}|[IVXLC]{1,7})\b\s*[.:\-–—]?\s*(.*)$/i;
const SUB_NUMBERED = /^ {0,8}(\d{1,3})\.(\d{1,3})\.?(?:[ ]+|$)(?!\d)/;
const RECITALS = /^ {0,6}(WHEREAS|RECITALS?|BACKGROUND)\b/;
const SIGNATURES = /^ {0,6}IN WITNESS WHEREOF\b/i;
const ATTACHMENT =
  /^ {0,6}(SCHEDULE|ANNEXURE|ANNEX|APPENDIX|EXHIBIT)\b[ ]*([A-Z0-9IVX-]{0,6})\b[ ]*[:.\-–—]?[ ]*(.{0,80})$/;

/** Accepts the next number in sequence, tolerating one that was lost in extraction. */
function follows(previous: number, candidate: number): boolean {
  return candidate > previous && candidate <= previous + 2;
}

function findMarkers(lines: Line[]): Marker[] {
  const markers: Marker[] = [];
  let lastTop = 0;
  let lastSub = 0;
  let recitalsSeen = false;
  let inAttachment = false;
  let signaturesSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text.trim()) continue;

    const attachment = ATTACHMENT.exec(line.text);
    if (attachment && (lastTop > 0 || signaturesSeen)) {
      // Schedules restart their own numbering; keep each one whole.
      const title = [attachment[1], attachment[2], attachment[3]]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      markers.push({
        kind: "part",
        start: line.start,
        heading: tidyHeading(title) ?? "Schedule",
      });
      inAttachment = true;
      continue;
    }
    if (inAttachment) continue;

    if (SIGNATURES.test(line.text)) {
      markers.push({ kind: "part", start: line.start, heading: "Signatures" });
      signaturesSeen = true;
      continue;
    }
    if (signaturesSeen) continue;

    if (lastTop === 0 && !recitalsSeen && RECITALS.test(line.text)) {
      markers.push({ kind: "part", start: line.start, heading: "Recitals" });
      recitalsSeen = true;
      continue;
    }

    const sub = SUB_NUMBERED.exec(line.text);
    if (sub) {
      const major = Number(sub[1]);
      const minor = Number(sub[2]);
      if (major === lastTop && follows(lastSub, minor)) {
        markers.push({ kind: "sub", start: line.start, number: `${major}.${minor}` });
        lastSub = minor;
      }
      continue;
    }

    const worded = TOP_WORDED.exec(line.text);
    if (worded) {
      const value = /^\d+$/.test(worded[2])
        ? Number(worded[2])
        : romanToInt(worded[2].toUpperCase());
      let rest = worded[3];
      // "Clause 5 shall survive termination" is a sentence, not a heading.
      const restIsTitle = !rest.trim() || /^["“(]?[A-Z]/.test(rest.trim());
      if (value !== null && restIsTitle && follows(lastTop, value)) {
        // The title is sometimes on the following line.
        const next = lines[i + 1];
        if (!rest.trim() && next && looksLikeHeading(next.text)) rest = next.text;
        const { heading, hasBody } = headingFromRest(rest);
        markers.push({
          kind: "top",
          start: line.start,
          number: worded[2],
          heading,
          hasBody,
        });
        lastTop = value;
        lastSub = 0;
        continue;
      }
    }

    const numbered = TOP_NUMBERED.exec(line.text);
    if (numbered) {
      const value = Number(numbered[1]);
      const hasDot = numbered[2] === ".";
      const rest = numbered[3];
      // Without a dot ("3 Term"), only a title-like line counts, so that a
      // wrapped line such as "30 days of receipt" is not taken for a clause.
      const plausible = hasDot ? rest.trim().length > 0 : looksLikeHeading(rest);
      if (plausible && follows(lastTop, value) && (lastTop > 0 || value === 1)) {
        const { heading, hasBody } = headingFromRest(rest);
        markers.push({
          kind: "top",
          start: line.start,
          number: numbered[1],
          heading,
          hasBody,
        });
        lastTop = value;
        lastSub = 0;
      }
    }
  }

  return markers;
}

/** For documents with no numbering at all: split on standalone capitalised headings. */
function findUnnumberedHeadings(lines: Line[]): Marker[] {
  const markers: Marker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text.trim();
    const previousBlank = i === 0 || !lines[i - 1].text.trim();
    const isCapsHeading =
      text.length >= 3 &&
      text.length <= 70 &&
      text === text.toUpperCase() &&
      /[A-Z]{3}/.test(text) &&
      !SENTENCE_END.test(text);
    if (previousBlank && isCapsHeading && i > 0) {
      markers.push({
        kind: "part",
        start: lines[i].start,
        heading: tidyHeading(text) ?? text,
      });
    }
  }
  return markers;
}

export function segmentContract(source: string): Segment[] {
  if (!source.trim()) return [];

  const lines = splitLines(source);
  let markers = findMarkers(lines);
  if (!markers.some((marker) => marker.kind === "top")) {
    const headings = findUnnumberedHeadings(lines);
    if (headings.length >= 3) markers = headings;
  }

  type Draft = Omit<Segment, "ordinal" | "text" | "endOffset">;
  const drafts: Draft[] = [];

  if (markers.length === 0 || markers[0].start > 0) {
    drafts.push({ number: null, heading: "Preamble", startOffset: 0 });
  }

  let topHeading: string | null = null;
  // A heading-only line ("4. CONFIDENTIALITY") waiting to be merged into the
  // first sub-clause that follows it.
  let pendingTop: { start: number; number: string } | null = null;

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];

    if (marker.kind === "part") {
      pendingTop = null;
      topHeading = null;
      drafts.push({ number: null, heading: marker.heading, startOffset: marker.start });
      continue;
    }

    if (marker.kind === "top") {
      topHeading = marker.heading;
      const next = markers[i + 1];
      const between = next ? source.slice(marker.start, next.start) : "";
      const headingOnly =
        next?.kind === "sub" && !marker.hasBody && between.trim().split("\n").length <= 2;
      if (headingOnly) {
        pendingTop = { start: marker.start, number: marker.number };
      } else {
        pendingTop = null;
        drafts.push({
          number: marker.number,
          heading: marker.heading,
          startOffset: marker.start,
        });
      }
      continue;
    }

    drafts.push({
      number: marker.number,
      heading: topHeading,
      startOffset: pendingTop ? pendingTop.start : marker.start,
    });
    pendingTop = null;
  }

  const segments: Segment[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const hardEnd = i + 1 < drafts.length ? drafts[i + 1].startOffset : source.length;
    const raw = source.slice(draft.startOffset, hardEnd);
    const text = raw.trimEnd();
    if (!text.trim()) continue;
    segments.push({
      ...draft,
      ordinal: segments.length,
      text,
      endOffset: draft.startOffset + text.length,
    });
  }
  return segments;
}
