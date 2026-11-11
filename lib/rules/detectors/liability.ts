import { MUTUAL, PARTY, describeDays, durations, patternRule } from "../helpers";
import type { Rule } from "../types";

const subjects = (text: string, verb: string) =>
  new Set(
    [...text.matchAll(new RegExp(`${PARTY}\\s+shall\\s+(?:fully\\s+)?${verb}`, "g"))]
      .map((match) => match[1].replace(/^the\s+/i, ""))
      .filter((name) => !/^(Each|Either|Neither|Both|No|Any)$/.test(name)),
  );

export const liabilityRules: Rule[] = [
  patternRule({
    id: "liability.unlimited",
    title: "Unlimited liability",
    category: "liability",
    severity: 5,
    likelihood: 4,
    types: ["limitation_of_liability", "warranties_and_representations"],
    pattern:
      /\bunlimited\b|\bwithout (?:any )?(?:limit|cap|ceiling)\b|\bnot (?:be )?subject to any (?:limit|cap|limitation)\b/i,
    unless: /\bindemnif/i,
    explanation:
      "Liability under this clause has no upper limit, so a single claim could exceed the whole value of the contract.",
    suggestion:
      "Cap total liability at a stated amount, commonly the fees paid or payable in the preceding 12 months.",
    examples: {
      hit: ["The liability of the Supplier under this Agreement shall be unlimited."],
      miss: ["Losses include, without limitation, legal fees and court costs."],
    },
  }),
  patternRule({
    id: "liability.uncapped-indemnity",
    title: "Uncapped indemnity",
    category: "liability",
    severity: 5,
    likelihood: 4,
    pattern:
      /\bindemnif[^.;]{0,220}\b(?:without (?:any )?(?:limit|cap|ceiling)\b|unlimited\b|not (?:be )?subject to any (?:limit|cap|limitation))/i,
    explanation:
      "The indemnity is expressly unlimited. An indemnity already recovers more than ordinary damages under section 124 of the Indian Contract Act; without a cap the exposure is open-ended.",
    suggestion:
      "Bring the indemnity under the overall liability cap, or cap it separately, and limit it to third-party claims.",
    examples: {
      hit: [
        "The Client shall indemnify the Service Provider against all claims arising out of the Client's use of the deliverables, without limit.",
      ],
      miss: [
        "Each party shall indemnify the other against third-party claims, subject to the cap in Clause 9.",
      ],
    },
  }),
  patternRule({
    id: "liability.low-cap",
    title: "Liability cap is very low",
    category: "liability",
    severity: 4,
    likelihood: 3,
    types: ["limitation_of_liability"],
    pattern:
      /\b(?:shall not exceed|limited to|capped at|not exceed)\b[^.;]{0,140}\b(?:fees|charges|amounts?)\b[^.;]{0,80}/i,
    check: (_match, sentence) => {
      const period = durations(sentence)[0];
      if (!period || period.days > 183) return false;
      return `The cap is tied to only ${describeDays(period.days)} of fees.`;
    },
    explanation:
      "The cap is a small fraction of the contract value, so most real losses would go unrecovered.",
    suggestion: "Raise the cap to at least the fees for 12 months.",
    examples: {
      hit: [
        "The total liability of the Service Provider shall not exceed the fees paid by the Client in the 3 months preceding the claim.",
      ],
      miss: [
        "The total liability of each party shall not exceed the fees paid in the 12 months preceding the claim.",
      ],
    },
  }),
  patternRule({
    id: "liability.one-sided-indemnity",
    title: "Only one party gives an indemnity",
    category: "liability",
    severity: 3,
    likelihood: 3,
    pattern: new RegExp(
      `${PARTY}\\s+shall\\s+(?:fully\\s+)?(?:indemnify|defend|hold harmless)`,
    ),
    unless: MUTUAL,
    check: (match, _sentence, _clause, context) => {
      const names = subjects(context.text, "(?:indemnify|defend|hold harmless)");
      const mutualElsewhere = /\b(?:each|either) party shall (?:fully )?indemnify/i.test(
        context.text,
      );
      if (names.size !== 1 || mutualElsewhere) return false;
      return `Only ${match[1].replace(/^the\s+/i, "the ")} indemnifies; there is no indemnity in return.`;
    },
    explanation:
      "Indemnities run in one direction only. The other party carries no matching obligation for its own breaches.",
    suggestion:
      "Make the indemnity mutual, or add a corresponding indemnity from the other party.",
    examples: {
      hit: [
        "The Consultant shall indemnify the Client against any loss arising from its negligence.",
      ],
      miss: [
        "Each party shall indemnify the other against losses arising from its breach.",
      ],
    },
  }),
  patternRule({
    id: "liability.one-sided-exclusion",
    title: "Liability excluded for one party only",
    category: "liability",
    severity: 3,
    likelihood: 3,
    types: [
      "limitation_of_liability",
      "warranties_and_representations",
      "service_levels",
    ],
    pattern: new RegExp(
      `${PARTY}\\s+shall\\s+(?:not be|have no|in no event be|under no circumstances be)\\s+(?:liable|liability)|[Ii]n no event shall\\s+${PARTY}\\s+be liable`,
    ),
    unless: MUTUAL,
    explanation:
      "Only one party's liability is excluded. The other remains fully exposed for the same kinds of loss.",
    suggestion: "Apply the exclusion to both parties.",
    examples: {
      hit: [
        "The Service Provider shall not be liable for any loss of data or loss of profit.",
      ],
      miss: ["Neither party shall be liable for any indirect or consequential loss."],
    },
  }),
  patternRule({
    id: "liability.indemnity-covers-consequential",
    title: "Indemnity extends to indirect or consequential loss",
    category: "liability",
    severity: 3,
    likelihood: 2,
    pattern: /\bindemnif[^.;]{0,260}\b(?:indirect|consequential|special|punitive)\b/i,
    unless: /\b(?:exclud|other than|shall not|not (?:be )?liable|except)\b/i,
    explanation:
      "The indemnity reaches indirect and consequential losses, which are otherwise usually excluded and are hard to predict or insure.",
    suggestion: "Limit the indemnity to direct losses and third-party claims.",
    examples: {
      hit: [
        "The Supplier shall indemnify the Buyer against all losses, including indirect and consequential losses.",
      ],
      miss: ["The Supplier shall indemnify the Buyer against direct losses only."],
    },
  }),
  patternRule({
    id: "liability.liquidated-damages",
    title: "Liquidated damages or penalty",
    category: "liability",
    severity: 3,
    likelihood: 3,
    pattern:
      /\bliquidated damages\b|\bby way of penalty\b|\bpenalty of\b|\bpenalt(?:y|ies) (?:at|equal|equivalent)\b/i,
    explanation:
      "A fixed sum is payable on breach. Under section 74 of the Indian Contract Act a court awards only reasonable compensation up to that sum, so the figure may not be recoverable in full, but it still sets the starting point in any dispute.",
    suggestion:
      "Check that the amount is a genuine pre-estimate of loss, and cap the total payable under this clause.",
    examples: {
      hit: [
        "The Contractor shall pay liquidated damages of 1% of the contract value per week of delay.",
      ],
      miss: ["The Contractor shall be liable for damages proved by the Client."],
    },
  }),
  patternRule({
    id: "liability.warranty-disclaimer",
    title: "Warranties disclaimed",
    category: "liability",
    severity: 3,
    likelihood: 3,
    pattern:
      /\bas[- ]is\b|\bwithout (?:any )?warrant(?:y|ies) of any kind\b|\bdisclaims? all (?:other )?warranties\b|\bno warrant(?:y|ies)[^.;]{0,40}\b(?:express|implied)\b/i,
    explanation:
      "The goods or services come with no promise as to quality or fitness, which removes the usual basis for a claim if they do not work.",
    suggestion:
      "Add a warranty that the deliverables conform to the specification for a stated period.",
    examples: {
      hit: ['The software is provided on an "as is" basis without warranty of any kind.'],
      miss: [
        "The Supplier warrants that the goods shall be free from defects for 12 months.",
      ],
    },
  }),
  patternRule({
    id: "liability.sole-remedy",
    title: "Remedy restricted to a single option",
    category: "liability",
    severity: 2,
    likelihood: 3,
    pattern: /\b(?:sole|exclusive)(?: and exclusive)? remedy\b/i,
    explanation:
      "The stated remedy replaces all others, such as damages or termination, for the breach it covers.",
    suggestion:
      "Confirm the single remedy is adequate, or preserve the right to damages.",
    examples: {
      hit: [
        "Service credits shall be the Client's sole and exclusive remedy for any failure.",
      ],
      miss: ["The Client may claim service credits in addition to any other remedy."],
    },
  }),
  patternRule({
    id: "liability.claims-time-bar",
    title: "Short time limit for bringing claims",
    category: "liability",
    severity: 3,
    likelihood: 2,
    pattern:
      /\b(?:claims?|actions?|proceedings?)\b[^.;]{0,100}\b(?:must|shall|may) (?:only )?be (?:brought|made|filed|commenced|notified)\b[^.;]{0,60}\bwithin\b|\bno (?:claim|action)\b[^.;]{0,100}\b(?:after|unless|more than)\b/i,
    check: (_match, sentence) => {
      const limit = durations(sentence)[0];
      if (!limit || limit.days >= 1095) return false;
      return `Claims are barred after ${describeDays(limit.days)}.`;
    },
    explanation:
      "The clause shortens the time to bring a claim below the three years the Limitation Act allows. Section 28 of the Indian Contract Act makes a term that extinguishes rights after a shorter period void, so this may be unenforceable, and it invites a dispute either way.",
    suggestion: "Remove the time bar, or limit it to a notification requirement.",
    examples: {
      hit: [
        "No claim may be brought under this Agreement more than 6 months after the event giving rise to it.",
      ],
      miss: [
        "Any claim may be brought within the period allowed by the law of limitation.",
      ],
    },
  }),
  {
    kind: "contract",
    id: "liability.no-cap",
    title: "No limitation of liability clause",
    category: "liability",
    severity: 4,
    likelihood: 3,
    clauseType: "limitation_of_liability",
    detect: (context) =>
      !context.hasType("limitation_of_liability") &&
      !/\b(?:liability|liable)\b[^.;]{0,80}\b(?:shall not exceed|limited to|capped)\b/i.test(
        context.text,
      ) &&
      !["nda", "employment_agreement"].includes(context.contractType ?? ""),
    explanation:
      "The contract sets no ceiling on what either party can be made to pay, so liability is limited only by the general law of damages.",
    suggestion: "Add a mutual cap on liability and an exclusion of indirect loss.",
  },
  {
    kind: "contract",
    id: "liability.consequential-not-excluded",
    title: "Indirect and consequential loss not excluded",
    category: "liability",
    severity: 3,
    likelihood: 3,
    clauseType: "limitation_of_liability",
    detect: (context) =>
      context.hasType("limitation_of_liability") &&
      !/\b(?:indirect|consequential)\b/i.test(context.text),
    explanation:
      "There is a liability clause, but it does not exclude indirect or consequential loss such as lost profit, which is usually the largest head of claim.",
    suggestion: "Add a mutual exclusion of indirect and consequential loss.",
  },
];
