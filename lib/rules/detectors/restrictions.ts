import { MUTUAL, PARTY, describeDays, durations, patternRule } from "../helpers";
import type { Rule } from "../types";

export const restrictionRules: Rule[] = [
  patternRule({
    id: "restrictions.post-termination-non-compete",
    title: "Non-compete continues after the contract ends",
    category: "restrictions",
    severity: 4,
    likelihood: 4,
    pattern:
      /\b(?:shall not|not to|agrees not to|undertakes not to|will not)\b[^.;]{0,160}\b(?:compet|engage any other|carry on|be employed by|be engaged in|be associated with|similar (?:business|services)|same or similar)/i,
    check: (_match, sentence) => {
      if (
        !/\b(?:after|following|thereafter|post-?termination|subsequent to)\b/i.test(
          sentence,
        )
      ) {
        return false;
      }
      const period = durations(sentence)[0];
      return period
        ? `The restriction runs for ${describeDays(period.days)} after the contract ends.`
        : "The restriction continues after the contract ends.";
    },
    explanation:
      "The restriction applies after termination. Section 27 of the Indian Contract Act, 1872 makes an agreement in restraint of trade void, and the courts apply that strictly to post-termination non-competes, however reasonable the period (Percept D'Mark v. Zaheer Khan, 2006). It is therefore unlikely to be enforceable, while still deterring the restricted party in practice.",
    suggestion:
      "Limit the non-compete to the term of the contract, and rely on confidentiality and non-solicitation afterwards.",
    examples: {
      hit: [
        "For a period of 24 months after the termination of employment, the Employee shall not be employed by any business that competes with the Company.",
      ],
      miss: [
        "During the term, the Consultant shall not provide similar services to a competitor of the Client.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.exclusivity",
    title: "Exclusivity",
    category: "restrictions",
    severity: 3,
    likelihood: 3,
    pattern:
      /\bexclusive(?:ly)?\b|\bsole (?:and exclusive )?(?:supplier|provider|vendor|distributor|agent)\b/i,
    unless:
      /\bnon-exclusive\b|\bexclusive (?:jurisdiction|property|remedy|right, title|owner)|\bexclusive of\b|\bsole and exclusive (?:property|remedy)\b|\bexclusively (?:governed|by the courts|owned)\b/i,
    explanation:
      "One party is tied to the other for this business and cannot use or serve anyone else.",
    suggestion:
      "Remove the exclusivity, or tie it to minimum volumes and a short period.",
    examples: {
      hit: ["The Distributor shall purchase the products exclusively from the Supplier."],
      miss: [
        "The courts at Mumbai shall have exclusive jurisdiction.",
        "All fees are exclusive of Goods and Services Tax.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.long-non-solicit",
    title: "Long non-solicitation period",
    category: "restrictions",
    severity: 2,
    likelihood: 3,
    pattern: /\bsolicit|\bpoach|\bentice\b/i,
    check: (_match, sentence) => {
      const period = durations(sentence).find((d) => d.days > 365);
      return period ? `The restriction lasts ${describeDays(period.days)}.` : false;
    },
    explanation:
      "The ban on hiring or approaching the other party's people or customers runs for more than a year. Long restrictions are harder to justify and to enforce under section 27 of the Indian Contract Act.",
    suggestion:
      "Limit non-solicitation to 12 months and to people actually involved in the work.",
    examples: {
      hit: [
        "For 3 years after termination, neither party shall solicit the employees of the other.",
      ],
      miss: [
        "For 12 months after termination, neither party shall solicit the employees of the other.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.employment-bond",
    title: "Service bond or repayment of training costs",
    category: "restrictions",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:service|training|employment) bond\b|\bbond (?:amount|period)\b|\bminimum service period\b|\b(?:repay|reimburse|refund)\b[^.;]{0,100}\b(?:training|recruitment|relocation)\s+(?:costs?|expenses)\b/i,
    explanation:
      "The employee must pay if they leave early. Indian courts enforce such bonds only up to the employer's actual, reasonable loss (section 74 of the Indian Contract Act), not as a fixed penalty.",
    suggestion:
      "Limit recovery to documented training costs, reducing pro rata over the bond period.",
    examples: {
      hit: [
        "If the Employee resigns within 2 years, the Employee shall repay the training costs incurred by the Company.",
      ],
      miss: ["The Company shall bear the cost of all training required for the role."],
    },
  }),
  patternRule({
    id: "restrictions.unilateral-amendment",
    title: "One party can change the terms",
    category: "restrictions",
    severity: 4,
    likelihood: 3,
    pattern:
      /\b(?:may|reserves the right to|shall be entitled to|shall have the right to)\s+(?:amend|modify|change|vary|update|revise)\b[^.;]{0,100}\b(?:this Agreement|these terms|the terms|its policies|the policy)\b/i,
    unless: /\b(?:mutual|both parties|signed by|written (?:agreement|consent) of)\b/i,
    explanation:
      "The contract can be rewritten by one party without the other's agreement.",
    suggestion: "Require any amendment to be in writing and signed by both parties.",
    examples: {
      hit: [
        "The Company reserves the right to modify the terms of this Agreement at any time.",
      ],
      miss: [
        "No amendment shall be valid unless made in writing and signed by both parties.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.one-sided-assignment",
    title: "Only one party can assign the contract",
    category: "restrictions",
    severity: 3,
    likelihood: 3,
    pattern: new RegExp(
      `${PARTY}\\s+may\\s+(?:freely\\s+)?(?:assign|transfer|novate)\\b[^.;]{0,120}\\bwithout\\b[^.;]{0,40}\\bconsent\\b`,
    ),
    unless: MUTUAL,
    explanation:
      "One party can hand the contract to someone else without asking, so the other may find itself dealing with a stranger.",
    suggestion:
      "Require consent, not to be unreasonably withheld, for assignment by either party.",
    examples: {
      hit: [
        "The Vendor may assign this Agreement to any third party without the consent of the Client.",
      ],
      miss: [
        "Neither party may assign this Agreement without the prior written consent of the other.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.change-of-control",
    title: "Change of control provision",
    category: "restrictions",
    severity: 2,
    likelihood: 2,
    pattern: /\bchange (?:of|in) control\b/i,
    explanation:
      "A sale or restructuring of one party gives the other a right, usually to terminate. This matters in any future fundraising or acquisition.",
    suggestion:
      "Check the consequence, and narrow it to a change of control in favour of a competitor.",
    examples: {
      hit: [
        "The Client may terminate this Agreement on a change of control of the Vendor.",
      ],
      miss: [
        "The Vendor shall notify the Client of any change in its registered address.",
      ],
    },
  }),
  patternRule({
    id: "restrictions.most-favoured",
    title: "Most favoured customer clause",
    category: "restrictions",
    severity: 3,
    likelihood: 2,
    pattern: /\bmost[- ]favou?red\b/i,
    explanation:
      "One party promises the other terms at least as good as it gives anyone else, which constrains every later deal it makes.",
    suggestion:
      "Delete, or limit to like-for-like customers and volumes, with no audit right.",
    examples: {
      hit: ["The Supplier shall offer the Buyer most favoured customer pricing."],
      miss: ["The Supplier shall offer the Buyer the prices set out in Schedule A."],
    },
  }),
  patternRule({
    id: "restrictions.minimum-commitment",
    title: "Minimum purchase commitment",
    category: "restrictions",
    severity: 3,
    likelihood: 3,
    pattern:
      /\bminimum (?:purchase|order|commitment|volume|guarantee|billing|quantity)\b|\btake[- ]or[- ]pay\b/i,
    explanation: "A minimum must be bought or paid for, whether or not it is needed.",
    suggestion: "Remove the minimum, or allow it to be reduced if needs change.",
    examples: {
      hit: ["The Buyer shall meet a minimum purchase commitment of 10,000 units a year."],
      miss: ["The Buyer may order such quantities as it requires."],
    },
  }),
];
