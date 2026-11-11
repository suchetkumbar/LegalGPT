import type { ClauseType } from "@/lib/pipeline/clause-types";

import {
  CITIES,
  LIBRARY,
  PARTY_NAMES,
  PERSON_NAMES,
  type LibraryClause,
} from "./clauses";

/**
 * Generates Indian-style contracts with exact gold labels, for measuring
 * clause segmentation and typing. Everything is driven by a seed, so the same
 * seed always yields the same contract.
 *
 * What varies between contracts is what breaks segmenters in practice: the
 * numbering style, heading case, whether sub-clauses are numbered, hard line
 * wraps of the kind PDF extraction produces, recitals and schedules.
 *
 * A third of the set is also "noisy": it carries the damage that PDF text
 * extraction really causes, which rules alone cannot undo. Two clauses run
 * together on one line, a clause number separated from its heading, and page
 * headers and footers dropped into the text. These are the cases the model
 * pass exists to repair.
 *
 * Gold granularity follows the product's own convention: one clause per
 * numbered sub-clause where sub-numbering exists (the first sub-clause starts
 * at its parent's heading line), otherwise one per top-level clause.
 */

export type GoldClause = { start: number; type: ClauseType; label: string };

export type GoldContract = {
  id: string;
  style: string;
  kind: string;
  /** Whether PDF-extraction damage was applied. */
  noisy: boolean;
  text: string;
  clauses: GoldClause[];
};

type Style = {
  id: string;
  /** The heading line of top-level clause n. Null means the heading is inline. */
  top: (n: number, heading: string) => string;
  /** Whether paragraphs are numbered n.1, n.2, ... */
  subs: boolean;
  /** "1. Term. This Agreement..." with the body on the heading line. */
  inline?: boolean;
  upper?: boolean;
};

const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
  "XXI",
  "XXII",
  "XXIII",
  "XXIV",
];

export const STYLES: Style[] = [
  { id: "dotted-caps-subs", top: (n, h) => `${n}. ${h}`, subs: true, upper: true },
  { id: "nodot-title-subs", top: (n, h) => `${n} ${h}`, subs: true },
  { id: "dotted-title-flat", top: (n, h) => `${n}. ${h}`, subs: false },
  { id: "clause-colon", top: (n, h) => `Clause ${n}: ${h}`, subs: false },
  {
    id: "article-roman",
    top: (n, h) => `ARTICLE ${ROMAN[n - 1]} - ${h}`,
    subs: false,
    upper: true,
  },
  { id: "section-dash-subs", top: (n, h) => `Section ${n} - ${h}`, subs: true },
  { id: "inline-heading", top: (n, h) => `${n}. ${h}.`, subs: false, inline: true },
  { id: "caps-unnumbered", top: (_, h) => h, subs: false, upper: true },
  { id: "paren-number", top: (n, h) => `${n}) ${h}`, subs: false },
  { id: "bracket-number", top: (n, h) => `(${n}) ${h}`, subs: false, upper: true },
];

/** How many contracts to build per style: 10 styles x 3 = 30. */
const PER_STYLE = 3;

type Kind = { id: string; title: string; core: ClauseType[]; optional: ClauseType[] };

const KINDS: Kind[] = [
  {
    id: "services",
    title: "MASTER SERVICES AGREEMENT",
    core: [
      "definitions",
      "scope_of_work",
      "payment",
      "term_and_renewal",
      "intellectual_property",
      "confidentiality",
      "limitation_of_liability",
      "termination",
      "governing_law_and_jurisdiction",
      "general_provisions",
    ],
    optional: [
      "data_protection",
      "warranties_and_representations",
      "indemnity",
      "force_majeure",
      "dispute_resolution",
      "notices",
      "insurance",
      "audit_and_records",
      "service_levels",
      "compliance_and_anti_corruption",
      "non_solicitation",
      "assignment_and_subcontracting",
      "stamp_duty_and_costs",
      "taxes",
    ],
  },
  {
    id: "nda",
    title: "NON-DISCLOSURE AGREEMENT",
    core: [
      "definitions",
      "confidentiality",
      "term_and_renewal",
      "governing_law_and_jurisdiction",
      "general_provisions",
    ],
    optional: [
      "intellectual_property",
      "dispute_resolution",
      "notices",
      "stamp_duty_and_costs",
      "non_solicitation",
      "indemnity",
      "assignment_and_subcontracting",
    ],
  },
  {
    id: "employment",
    title: "EMPLOYMENT AGREEMENT",
    core: [
      "employment_terms",
      "confidentiality",
      "intellectual_property",
      "termination",
      "governing_law_and_jurisdiction",
    ],
    optional: [
      "non_compete",
      "non_solicitation",
      "notices",
      "general_provisions",
      "dispute_resolution",
      "data_protection",
      "compliance_and_anti_corruption",
    ],
  },
  {
    id: "consulting",
    title: "CONSULTING AGREEMENT",
    core: [
      "scope_of_work",
      "payment",
      "term_and_renewal",
      "confidentiality",
      "termination",
      "governing_law_and_jurisdiction",
    ],
    optional: [
      "definitions",
      "taxes",
      "intellectual_property",
      "indemnity",
      "non_compete",
      "limitation_of_liability",
      "force_majeure",
      "notices",
      "general_provisions",
      "warranties_and_representations",
      "dispute_resolution",
      "stamp_duty_and_costs",
    ],
  },
];

/** Clauses that conventionally come first or last; the rest keep library order. */
const FIRST: ClauseType[] = ["definitions"];
const LAST: ClauseType[] = [
  "governing_law_and_jurisdiction",
  "dispute_resolution",
  "notices",
  "stamp_duty_and_costs",
  "general_provisions",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Greedy hard wrap, the way text extracted from a PDF arrives. */
function hardWrap(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      let current = "";
      for (const word of line.split(" ")) {
        if (current && current.length + 1 + word.length > width) {
          out.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      out.push(current);
      return out.join("\n");
    })
    .join("\n");
}

const titleCase = (heading: string) => heading;
const paraText = (para: LibraryClause["paras"][number]) =>
  typeof para === "string" ? para : para.text;
const paraType = (para: LibraryClause["paras"][number], fallback: ClauseType) =>
  typeof para === "string" ? fallback : para.type;

export function generateContract(
  seed: number,
  style: Style,
  noisy = false,
): GoldContract {
  const random = mulberry32(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const chance = (p: number) => random() < p;

  const kind = pick(KINDS);
  const city = pick(CITIES);
  const partyA = pick(PARTY_NAMES);
  const partyB =
    kind.id === "employment"
      ? pick(PERSON_NAMES)
      : pick(PARTY_NAMES.filter((name) => name !== partyA));
  const [roleA, roleB] =
    kind.id === "employment"
      ? ["the Company", "the Employee"]
      : kind.id === "nda"
        ? ["the Disclosing Party", "the Receiving Party"]
        : kind.id === "consulting"
          ? ["the Client", "the Consultant"]
          : ["the Client", "the Service Provider"];
  const wrap = chance(0.4) ? 72 + Math.floor(random() * 16) : null;
  const fill = (text: string) =>
    text.replaceAll("{A}", roleA).replaceAll("{B}", roleB).replaceAll("{CITY}", city);
  const body = (text: string) => (wrap ? hardWrap(fill(text), wrap) : fill(text));

  // Choose and order the clauses.
  const chosen = new Set<ClauseType>(kind.core);
  for (const type of kind.optional) if (chance(0.45)) chosen.add(type);
  const available = LIBRARY.filter((clause) => chosen.has(clause.type));
  const rank = (clause: LibraryClause) =>
    FIRST.includes(clause.type)
      ? 0
      : LAST.includes(clause.type)
        ? 2 + LAST.indexOf(clause.type)
        : 1;
  const ordered = [...available].sort((a, b) => rank(a) - rank(b));

  let text = "";
  const clauses: GoldClause[] = [];
  const add = (
    block: string,
    gold?: { type: ClauseType; label: string },
    separator = "\n\n",
  ) => {
    if (text) text += separator;
    if (gold) clauses.push({ start: text.length, ...gold });
    text += block;
  };

  // Damage, applied only to noisy contracts.
  let page = 1;
  const pages = 6 + Math.floor(random() * 10);
  /** A lost line break: this clause starts in the middle of the previous line. */
  const separatorFor = (index: number) =>
    noisy && index > 0 && chance(0.2) ? " " : "\n\n";
  /** "4. CONFIDENTIALITY" extracted as "4." and "CONFIDENTIALITY" on separate lines. */
  const damageHeading = (line: string) =>
    noisy && chance(0.2) ? line.replace(/^(\(?\d+[.)]?) /, "$1\n") : line;
  /** A page footer and the next page's header, landing between two paragraphs. */
  const pageFurniture = () => {
    if (!noisy || !chance(0.3) || page >= pages) return;
    page += 1;
    add(`Page ${page - 1} of ${pages}\n\nSTRICTLY CONFIDENTIAL`);
  };

  // Preamble.
  const day = 1 + Math.floor(random() * 28);
  const month = pick([
    "January",
    "March",
    "April",
    "June",
    "August",
    "October",
    "December",
  ]);
  const year = pick([2025, 2026]);
  const describeB =
    kind.id === "employment"
      ? `${partyB}, an individual residing at ${pick(CITIES)}`
      : `${partyB}, having its registered office at ${pick(CITIES)}`;
  add(
    `${kind.title}\n\n` +
      body(
        `This Agreement is made at ${city} on ${day} ${month} ${year} (the "Effective Date") between ${partyA}, a company incorporated under the Companies Act, 2013 and having its registered office at ${city} (hereinafter referred to as "${roleA.replace("the ", "")}") and ${describeB} (hereinafter referred to as "${roleB.replace("the ", "")}").`,
      ),
    { type: "preamble", label: "Preamble" },
  );

  if (chance(0.7)) {
    add(
      body(
        `WHEREAS ${roleA} carries on business in India and wishes to enter into the arrangement set out in this Agreement;`,
      ) +
        "\n\n" +
        body(`AND WHEREAS ${roleB} has agreed to the same on the terms set out below;`) +
        "\n\n" +
        body("NOW, THEREFORE, the parties agree as follows:"),
      { type: "recitals", label: "Recitals" },
    );
  }

  // Numbered clauses.
  ordered.forEach((clause, index) => {
    const n = index + 1;
    const rawHeading = pick(clause.headings);
    const heading = style.upper ? rawHeading.toUpperCase() : titleCase(rawHeading);
    const headingLine = damageHeading(style.top(n, heading));
    const separator = separatorFor(index);
    // Vary length: sometimes drop the last paragraph.
    const paras =
      clause.paras.length > 2 && chance(0.3) ? clause.paras.slice(0, -1) : clause.paras;

    if (style.inline) {
      const [first, ...rest] = paras.map((para) => fill(paraText(para)));
      const block = [body(`${headingLine} ${first}`), ...rest.map(body)].join("\n\n");
      add(block, { type: clause.type, label: String(n) }, separator);
      pageFurniture();
      return;
    }

    if (style.subs && paras.length > 1) {
      paras.forEach((para, subIndex) => {
        const line = body(`${n}.${subIndex + 1} ${paraText(para)}`);
        add(
          subIndex === 0 ? `${headingLine}\n\n${line}` : line,
          { type: paraType(para, clause.type), label: `${n}.${subIndex + 1}` },
          subIndex === 0 ? separator : "\n\n",
        );
      });
      pageFurniture();
      return;
    }

    add(
      `${headingLine}\n\n${paras.map((para) => body(paraText(para))).join("\n\n")}`,
      { type: clause.type, label: String(n) },
      separator,
    );
    pageFurniture();
  });

  // Signatures.
  add(
    body(
      "IN WITNESS WHEREOF the parties have executed this Agreement on the date first written above.",
    ) +
      `\n\nFor ${partyA}\nName: ${pick(PERSON_NAMES)}\nDesignation: Director` +
      `\n\n${kind.id === "employment" ? partyB : `For ${partyB}`}\nName: ${kind.id === "employment" ? partyB : pick(PERSON_NAMES)}`,
    { type: "signature_block", label: "Signatures" },
  );

  if (chance(0.4)) {
    add(
      "SCHEDULE A - DETAILS\n\n" +
        [
          "1. Place of performance: " + city + ".",
          "2. Contact person: " + pick(PERSON_NAMES) + ".",
          "3. Working days: Monday to Friday, excluding public holidays.",
        ].join("\n"),
      { type: "schedule", label: "Schedule A" },
    );
  }

  return {
    id: `${style.id}-${seed}${noisy ? "-noisy" : ""}`,
    style: style.id,
    kind: kind.id,
    noisy,
    text,
    clauses,
  };
}

/**
 * The fixed evaluation set: three contracts in each of the ten styles, the
 * third of which is noisy. 20 clean and 10 noisy contracts in all.
 */
export function generateEvalSet(): GoldContract[] {
  return STYLES.flatMap((style, styleIndex) =>
    Array.from({ length: PER_STYLE }, (_, i) =>
      generateContract(1000 + styleIndex * 100 + i * 7, style, i === PER_STYLE - 1),
    ),
  );
}
