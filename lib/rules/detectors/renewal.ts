import { MUTUAL, PARTY, describeDays, durationByMatch, patternRule } from "../helpers";
import type { Rule } from "../types";

export const renewalRules: Rule[] = [
  patternRule({
    id: "renewal.automatic",
    title: "Automatic renewal",
    category: "renewal",
    severity: 2,
    likelihood: 4,
    pattern:
      /\brenew(?:s|ed)? automatically\b|\bautomatically (?:be )?(?:renew|extend)(?:s|ed)?\b|\bautomatic (?:renewal|extension)\b|\bdeemed (?:to be )?renewed\b|\bevergreen\b/i,
    explanation:
      "The contract rolls over on its own. Unless someone diarises the deadline and gives notice in time, the organisation is committed for another term.",
    suggestion:
      "Require active renewal by written agreement, or track the notice date and keep the notice period short.",
    examples: {
      hit: ["This Agreement shall renew automatically for successive periods of 1 year."],
      miss: ["This Agreement may be renewed by written agreement of the parties."],
    },
  }),
  patternRule({
    id: "renewal.long-non-renewal-notice",
    title: "Long notice needed to stop renewal",
    category: "renewal",
    severity: 3,
    likelihood: 4,
    pattern:
      /\bnon-?renewal\b|\bnot to renew\b|\bnot renew\b|\bintention not to\b|\bnot wish to renew\b/i,
    check: (match, sentence) => {
      const notice = durationByMatch(sentence, match[0], 70);
      if (!notice || notice.days <= 60) return false;
      return `Notice to stop the renewal must be given ${describeDays(notice.days)} ahead.`;
    },
    explanation:
      "The window to prevent renewal closes months before the term ends, so it is easy to miss and be held to another full term.",
    suggestion: "Cut the non-renewal notice to 30 to 60 days.",
    examples: {
      hit: [
        "It shall renew for 1 year unless either party gives written notice of non-renewal at least 120 days before the end of the term.",
      ],
      miss: [
        "It shall renew for 1 year unless either party gives written notice of non-renewal at least 30 days before the end of the term.",
      ],
    },
  }),
  patternRule({
    id: "renewal.long-initial-term",
    title: "Long initial term",
    category: "renewal",
    severity: 2,
    likelihood: 3,
    types: ["term_and_renewal"],
    pattern:
      /\b(?:initial term|term of|period of|remain in force for|continue for|valid for)\b/i,
    check: (match, sentence) => {
      const term = durationByMatch(sentence, match[0], 40);
      if (!term || term.days <= 1095) return false;
      return `The initial term is ${describeDays(term.days)}.`;
    },
    explanation: "The commitment runs for more than three years before it can lapse.",
    suggestion:
      "Shorten the term, or add a right to terminate for convenience after the first year.",
    examples: {
      hit: ["This Agreement shall continue for an initial term of 5 years."],
      miss: ["This Agreement shall continue for an initial term of 2 years."],
    },
  }),
  patternRule({
    id: "renewal.price-on-renewal",
    title: "Price resets on renewal",
    category: "renewal",
    severity: 3,
    likelihood: 3,
    pattern:
      /\brenew[^.;]{0,140}\b(?:then[- ]current|prevailing|revised|increased?|new)\s+(?:rates?|fees|prices?|charges)\b/i,
    explanation: "On renewal the price moves to whatever the supplier is then charging.",
    suggestion:
      "Fix renewal pricing, or cap any increase at a stated percentage or index.",
    examples: {
      hit: ["On renewal, the fees shall be the Vendor's then-current rates."],
      miss: ["On renewal, the fees shall remain unchanged."],
    },
  }),
  patternRule({
    id: "renewal.perpetual-term",
    title: "No fixed end date",
    category: "renewal",
    severity: 2,
    likelihood: 3,
    types: ["term_and_renewal"],
    pattern:
      /\bperpetual\b|\bin perpetuity\b|\bindefinite(?:ly)?\b|\buntil terminated\b/i,
    explanation:
      "The contract has no end date and continues until someone terminates it.",
    suggestion: "Make sure both parties can terminate on reasonable notice.",
    examples: {
      hit: [
        "This Agreement shall continue indefinitely until terminated in accordance with Clause 9.",
      ],
      miss: ["This Agreement shall continue for 2 years."],
    },
  }),
  patternRule({
    id: "renewal.one-sided-option",
    title: "Only one party can renew or extend",
    category: "renewal",
    severity: 2,
    likelihood: 3,
    pattern: new RegExp(
      `${PARTY}\\s+(?:may|shall have the (?:right|option) to)\\s+(?:renew|extend)\\b`,
    ),
    unless: MUTUAL,
    explanation: "One party alone decides whether the contract continues.",
    suggestion: "Make renewal subject to mutual written agreement.",
    examples: {
      hit: [
        "The Licensor may extend the term for a further period of 2 years at its option.",
      ],
      miss: ["The parties may extend the term by mutual written agreement."],
    },
  }),
];
