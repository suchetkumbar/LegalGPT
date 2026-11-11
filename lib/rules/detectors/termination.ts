import {
  DURATION_SOURCE,
  MUTUAL,
  PARTY,
  describeDays,
  durationByMatch,
  durations,
  patternRule,
} from "../helpers";
import type { Rule } from "../types";

const FOR_CAUSE =
  /\b(?:breach|default|insolv|bankrupt|winding|misconduct|fraud|convict|probation|non-?payment)\b/i;
const NOTICE = new RegExp(
  `${DURATION_SOURCE}['’]?\\s+(?:prior\\s+|advance\\s+)?(?:written\\s+)?notice`,
  "i",
);

export const terminationRules: Rule[] = [
  patternRule({
    id: "termination.unilateral-convenience",
    title: "Only one party can terminate without cause",
    category: "termination",
    severity: 4,
    likelihood: 3,
    pattern: new RegExp(
      `${PARTY}\\s+may\\s+(?:terminate|(?:end|cancel) (?:this|the) (?:Agreement|contract)|bring (?:this|the) (?:Agreement|contract) to an end)\\b[^.;]{0,180}\\b(?:for (?:its )?convenience|without cause|without assigning any reason|without giving (?:any )?reasons?|at any time|whenever it wishes|at its (?:sole )?discretion|for any reason)`,
    ),
    unless: MUTUAL,
    check: (match, _sentence, _clause, context) => {
      const mutual =
        /\b(?:either|each) party may terminate\b[^.;]{0,180}\b(?:convenience|without cause|any reason|notice)/i.test(
          context.text,
        );
      if (mutual) return false;
      return `Only ${match[1].replace(/^The\s/, "the ")} can end the contract without a reason.`;
    },
    explanation:
      "One party can walk away at will while the other is locked in for the full term.",
    suggestion:
      "Give both parties the same right to terminate for convenience on notice.",
    examples: {
      hit: [
        "The Service Provider may terminate this Agreement for convenience by giving 30 days written notice.",
      ],
      miss: [
        "Either party may terminate this Agreement for convenience by giving 30 days written notice.",
      ],
    },
  }),
  patternRule({
    id: "termination.short-notice",
    title: "Short termination notice",
    category: "termination",
    severity: 3,
    likelihood: 3,
    types: ["termination", "term_and_renewal", "employment_terms"],
    pattern: NOTICE,
    unless: FOR_CAUSE,
    check: (match, sentence) => {
      if (!/\bterminat/i.test(sentence)) return false;
      const notice = durations(match[0])[0];
      if (!notice || notice.days >= 30) return false;
      return `The notice period is ${describeDays(notice.days)}.`;
    },
    explanation:
      "The contract can be ended on very short notice, leaving little time to find a replacement or wind down.",
    suggestion:
      "Lengthen the notice period to at least 30 days, or 60 to 90 for a critical service.",
    examples: {
      hit: ["Either party may terminate this Agreement by giving 7 days written notice."],
      miss: [
        "Either party may terminate this Agreement by giving 60 days written notice.",
        "Either party may terminate on 7 days notice if the other commits a material breach.",
      ],
    },
  }),
  patternRule({
    id: "termination.long-notice",
    title: "Long termination notice",
    category: "termination",
    severity: 2,
    likelihood: 3,
    types: ["termination", "term_and_renewal", "employment_terms"],
    pattern: NOTICE,
    check: (match, sentence) => {
      if (!/\bterminat/i.test(sentence)) return false;
      const notice = durations(match[0])[0];
      if (!notice || notice.days <= 90) return false;
      return `The notice period is ${describeDays(notice.days)}.`;
    },
    explanation:
      "Leaving the contract takes a long time, during which fees keep running.",
    suggestion: "Shorten the notice period to 90 days or less.",
    examples: {
      hit: [
        "Either party may terminate this Agreement by giving 6 months written notice.",
      ],
      miss: [
        "Either party may terminate this Agreement by giving 3 months written notice.",
      ],
    },
  }),
  patternRule({
    id: "termination.long-cure-period",
    title: "Long period to cure a breach",
    category: "termination",
    severity: 3,
    likelihood: 3,
    types: ["termination"],
    pattern: /\b(?:remed(?:y|ied)|cured?|uncured|rectif(?:y|ied)|unremedied)\b/i,
    check: (match, sentence) => {
      const cure = durationByMatch(sentence, match[0], 60);
      if (!cure || cure.days <= 45) return false;
      return `The breaching party has ${describeDays(cure.days)} to put things right.`;
    },
    explanation:
      "A breach must be tolerated for a long time before the contract can be ended for it.",
    suggestion:
      "Reduce the cure period to 30 days, and to nothing for breaches that cannot be remedied.",
    examples: {
      hit: [
        "The Client may terminate only for material breach that remains uncured for 90 days after written notice.",
      ],
      miss: [
        "Either party may terminate for material breach not remedied within 30 days of notice.",
      ],
    },
  }),
  patternRule({
    id: "termination.right-restricted",
    title: "Right to terminate is restricted",
    category: "termination",
    severity: 4,
    likelihood: 3,
    pattern:
      /\bmay terminate\b[^.;]{0,100}\bonly\b|\bmay only terminate\b|\bshall not (?:be entitled to )?terminate\b|\b(?:no|waives? (?:its|the)) right to terminate\b/i,
    explanation:
      "A party's ability to leave the contract is narrowed, typically to a serious breach by the other side.",
    suggestion:
      "Restore a general right to terminate for material breach and, ideally, for convenience.",
    examples: {
      hit: [
        "The Client may terminate this Agreement only for material breach by the Service Provider.",
      ],
      miss: ["The Client may terminate this Agreement by giving 30 days written notice."],
    },
  }),
  patternRule({
    id: "termination.no-notice",
    title: "Termination without notice",
    category: "termination",
    severity: 3,
    likelihood: 3,
    pattern:
      /\bterminat[^.;]{0,140}\b(?:without (?:any )?(?:prior )?notice|with immediate effect|forthwith)\b/i,
    unless: FOR_CAUSE,
    explanation:
      "The contract can be ended instantly, with no notice and no stated reason.",
    suggestion:
      "Limit immediate termination to serious breach or insolvency, and require notice otherwise.",
    examples: {
      hit: [
        "The Company may terminate this Agreement with immediate effect at any time.",
      ],
      miss: ["The Company may terminate the employment without notice for misconduct."],
    },
  }),
  patternRule({
    id: "termination.exit-fee",
    title: "Fee payable on termination",
    category: "termination",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:termination|early[- ]termination|exit|cancellation)\s+(?:fees?|charges?|payment|penalt(?:y|ies))\b/i,
    explanation: "Ending the contract early triggers a charge.",
    suggestion:
      "Remove the charge, or limit it to costs actually incurred; as a penalty it is open to challenge under section 74 of the Indian Contract Act.",
    examples: {
      hit: [
        "The Client shall pay an early termination fee equal to three months of fees.",
      ],
      miss: [
        "On termination the Client shall pay fees accrued to the date of termination.",
      ],
    },
  }),
  patternRule({
    id: "termination.lock-in",
    title: "Lock-in period",
    category: "termination",
    severity: 3,
    likelihood: 3,
    pattern: /\block[- ]in\b/i,
    explanation:
      "Neither party, or one of them, cannot terminate during the lock-in period.",
    suggestion: "Shorten the lock-in, or allow termination for breach during it.",
    examples: {
      hit: [
        "There shall be a lock-in period of 11 months during which the Licensee may not terminate.",
      ],
      miss: ["The Licensee may terminate at any time by giving one month's notice."],
    },
  }),
  patternRule({
    id: "termination.pay-for-remaining-term",
    title: "Fees for the unexpired term payable on termination",
    category: "termination",
    severity: 4,
    likelihood: 3,
    pattern:
      /\b(?:balance|remaining|remainder|unexpired)\s+(?:portion\s+)?(?:of the\s+)?(?:term|period)\b[^.;]{0,100}\b(?:pay|fees|charges)\b|\b(?:pay|fees|charges)\b[^.;]{0,100}\b(?:balance|remainder|remaining|unexpired)\s+(?:portion\s+)?(?:of the\s+)?(?:term|period)\b/i,
    explanation:
      "Terminating early does not stop the fees: the full amount for the rest of the term falls due.",
    suggestion:
      "Limit payment on termination to fees for services delivered up to that date.",
    examples: {
      hit: [
        "On termination the Client shall pay the fees for the remaining term of this Agreement.",
      ],
      miss: [
        "On termination the Client shall pay fees for services performed to that date.",
      ],
    },
  }),
  patternRule({
    id: "termination.perpetual-survival",
    title: "Obligations survive indefinitely",
    category: "termination",
    severity: 2,
    likelihood: 3,
    pattern:
      /\bsurviv[^.;]{0,120}\b(?:indefinitely|in perpetuity|perpetual(?:ly)?|forever|without limit(?:ation)? (?:of|as to|in) time)\b/i,
    explanation: "Some obligations never end, even long after the contract has.",
    suggestion:
      "Set a fixed survival period, commonly 3 to 5 years, with trade secrets as the exception.",
    examples: {
      hit: ["The obligations of confidentiality shall survive termination indefinitely."],
      miss: ["The obligations of confidentiality shall survive termination for 3 years."],
    },
  }),
  {
    kind: "contract",
    id: "termination.no-clause",
    title: "No termination clause",
    category: "termination",
    severity: 4,
    likelihood: 3,
    clauseType: "termination",
    detect: (context) =>
      context.contractType !== "nda" &&
      !context.hasType("termination") &&
      !/\bterminat/i.test(context.text),
    explanation:
      "The contract does not say how or when it can be ended, so leaving it early would depend on proving a serious breach.",
    suggestion:
      "Add termination rights for material breach, insolvency and convenience on notice.",
  },
];
