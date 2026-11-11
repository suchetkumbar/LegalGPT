import { MUTUAL, PARTY, patternRule, sentenceAround } from "../helpers";
import type { Rule } from "../types";

const FOREIGN_PLACE =
  "(?:England(?: and Wales)?|Singapore|New York|Delaware|California|the United States|the United Kingdom|Hong Kong|the State of [A-Z][a-z]+|the UAE|Dubai|Switzerland)";
const FOREIGN_SEAT = "(?:Singapore|London|Dubai|Hong Kong|New York|Paris|Geneva|Zurich)";

export const disputeRules: Rule[] = [
  patternRule({
    id: "disputes.foreign-governing-law",
    title: "Governed by foreign law",
    category: "disputes",
    severity: 3,
    likelihood: 3,
    pattern: new RegExp(`\\bgoverned by[^.;]{0,100}\\blaws? of\\s+${FOREIGN_PLACE}`, "i"),
    explanation:
      "The contract is governed by a foreign law, so advice and any dispute need foreign lawyers, and mandatory Indian law such as the Stamp Act, FEMA and the DPDP Act still applies alongside it.",
    suggestion: "Have the contract governed by the laws of India.",
    examples: {
      hit: ["This Agreement shall be governed by the laws of England and Wales."],
      miss: ["This Agreement shall be governed by the laws of India."],
    },
  }),
  patternRule({
    id: "disputes.foreign-seat",
    title: "Arbitration seated outside India",
    category: "disputes",
    severity: 3,
    likelihood: 3,
    pattern: new RegExp(
      `\\b(?:seat|venue|place)\\b[^.;]{0,60}\\barbitration\\b[^.;]{0,60}\\b${FOREIGN_SEAT}\\b|\\barbitration\\b[^.;]{0,120}\\b(?:in|at)\\s+${FOREIGN_SEAT}\\b`,
      "i",
    ),
    explanation:
      "Disputes are to be arbitrated abroad, which multiplies the cost and takes the arbitration outside Part I of the Arbitration and Conciliation Act, 1996, so Indian courts have only a limited supporting role.",
    suggestion: "Seat the arbitration in India, in a city convenient to both parties.",
    examples: {
      hit: ["The seat of arbitration shall be Singapore."],
      miss: ["The seat of arbitration shall be Mumbai."],
    },
  }),
  patternRule({
    id: "disputes.unilateral-arbitrator",
    title: "One party appoints the sole arbitrator",
    category: "disputes",
    severity: 4,
    likelihood: 4,
    pattern:
      /\barbitrator\b[^.;]{0,80}\b(?:appointed|nominated|designated|chosen|selected)\s+(?:solely\s+)?by\s+(?:the\s+)?(?!Parties|Court|High Court|Supreme Court|SIAC|ICC|MCIA|DIAC|LCIA|Mumbai Centre|Delhi International)([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/,
    explanation:
      "The sole arbitrator is chosen by one of the parties. The Supreme Court held in Perkins Eastman Architects v. HSCC (2019) that a party with an interest in the outcome cannot appoint the sole arbitrator, so this appointment mechanism is invalid and will have to be replaced by a court appointment under section 11 of the Arbitration and Conciliation Act, 1996.",
    suggestion:
      "Have the arbitrator appointed by agreement, failing which by an arbitral institution such as MCIA or DIAC.",
    examples: {
      hit: ["Disputes shall be referred to a sole arbitrator appointed by the Company."],
      miss: [
        "Disputes shall be referred to a sole arbitrator appointed by mutual consent of the parties.",
        "Disputes shall be referred to a sole arbitrator appointed by the MCIA.",
      ],
    },
  }),
  {
    kind: "clause",
    id: "disputes.no-seat",
    title: "Arbitration clause does not name a seat",
    category: "disputes",
    severity: 2,
    likelihood: 3,
    types: ["dispute_resolution", "governing_law_and_jurisdiction"],
    detect(clause) {
      const match = /\barbitrat/i.exec(clause.text);
      if (!match || /\b(?:seat|venue|place)\b/i.test(clause.text)) return null;
      return { quote: sentenceAround(clause.text, match.index, match[0].length) };
    },
    explanation:
      "The clause provides for arbitration but does not say where it is seated. The seat decides which courts supervise the arbitration, and its absence is a common cause of preliminary litigation.",
    suggestion:
      "Name the seat of arbitration, and the language and number of arbitrators.",
    examples: {
      hit: [
        "Any dispute shall be referred to arbitration under the Arbitration and Conciliation Act, 1996.",
      ],
      miss: [
        "Any dispute shall be referred to arbitration. The seat of arbitration shall be Chennai.",
      ],
    },
  },
  patternRule({
    id: "disputes.waiver-of-remedies",
    title: "Waiver of the right to go to court",
    category: "disputes",
    severity: 4,
    likelihood: 2,
    pattern:
      /\bwaives?\b[^.;]{0,100}\b(?:right to (?:sue|approach|seek|bring|file)|injuncti|legal proceedings|any claim)\b/i,
    explanation:
      "A party gives up its right to take legal action. Section 28 of the Indian Contract Act, 1872 makes an agreement that absolutely restrains a party from enforcing its rights by legal proceedings void.",
    suggestion:
      "Delete the waiver. An arbitration clause is the lawful way to keep disputes out of court.",
    examples: {
      hit: [
        "The Employee waives the right to bring any claim against the Company in any court.",
      ],
      miss: [
        "Nothing in this clause prevents either party from seeking interim relief from a court.",
      ],
    },
  }),
  patternRule({
    id: "disputes.one-sided-costs",
    title: "One party bears all arbitration costs",
    category: "disputes",
    severity: 2,
    likelihood: 3,
    pattern: new RegExp(
      `${PARTY}\\s+shall\\s+bear\\s+(?:all|the)\\s+(?:costs|fees|expenses)\\s+of\\s+(?:the\\s+)?arbitration`,
    ),
    unless: MUTUAL,
    explanation: "One party pays for the arbitration whatever the outcome.",
    suggestion: "Share costs equally, subject to the tribunal's award.",
    examples: {
      hit: ["The Contractor shall bear all costs of the arbitration."],
      miss: ["Each party shall bear its own costs of the arbitration."],
    },
  }),
  patternRule({
    id: "disputes.one-sided-stamp-duty",
    title: "One party bears all the stamp duty",
    category: "disputes",
    severity: 1,
    likelihood: 4,
    pattern:
      /\bstamp duty\b[^.;]{0,100}\b(?:borne|paid|payable)\s+(?:solely\s+|entirely\s+|exclusively\s+)?by\s+(?:the\s+)?(?!parties|both|each)([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/,
    explanation: "The stamp duty on the contract falls entirely on one party.",
    suggestion: "Share the stamp duty equally, or confirm the amount is acceptable.",
    examples: {
      hit: ["The stamp duty on this Agreement shall be borne by the Licensee."],
      miss: ["The stamp duty on this Agreement shall be borne equally by the parties."],
    },
  }),
  {
    kind: "contract",
    id: "disputes.no-governing-law",
    title: "No governing law clause",
    category: "disputes",
    severity: 3,
    likelihood: 3,
    clauseType: "governing_law_and_jurisdiction",
    detect: (context) =>
      !context.hasType("governing_law_and_jurisdiction") &&
      !/\bgoverned by\b|\bgoverning law\b/i.test(context.text),
    explanation:
      "The contract does not say which country's law applies or which courts have jurisdiction, leaving both to be argued if a dispute arises.",
    suggestion: "State that Indian law governs and name the courts or arbitral seat.",
  },
  {
    kind: "contract",
    id: "disputes.no-dispute-resolution",
    title: "No dispute resolution clause",
    category: "disputes",
    severity: 2,
    likelihood: 3,
    clauseType: "dispute_resolution",
    detect: (context) =>
      !context.hasType("dispute_resolution") &&
      !/\barbitrat|\bcourts? (?:at|of|in)\b|\bjurisdiction\b/i.test(context.text),
    explanation: "The contract does not say how disputes are to be resolved or where.",
    suggestion:
      "Add an escalation step followed by arbitration seated in India, or name the courts.",
  },
  {
    kind: "contract",
    id: "disputes.stamp-duty-not-addressed",
    title: "Stamp duty not addressed",
    category: "disputes",
    severity: 1,
    likelihood: 3,
    clauseType: "stamp_duty_and_costs",
    detect: (context) => !/\bstamp/i.test(context.text),
    explanation:
      "The contract does not mention stamp duty. Under section 35 of the Indian Stamp Act, 1899 an unstamped or under-stamped document cannot be used in evidence until the duty and a penalty of up to ten times are paid.",
    suggestion:
      "Stamp the contract under the applicable State's Stamp Act and say who bears the duty.",
  },
  {
    kind: "contract",
    id: "disputes.no-confidentiality",
    title: "No confidentiality clause",
    category: "ip",
    severity: 3,
    likelihood: 3,
    clauseType: "confidentiality",
    detect: (context) =>
      !context.hasType("confidentiality") && !/\bconfidential/i.test(context.text),
    explanation:
      "Nothing in the contract protects information the parties share with each other. India has no trade secrets statute, so confidentiality depends on the contract.",
    suggestion:
      "Add a mutual confidentiality clause surviving termination for at least 3 years.",
  },
];
