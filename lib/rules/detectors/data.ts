import { describeDays, durations, patternRule } from "../helpers";
import type { Rule, RuleContext } from "../types";

const dataClauses = (context: RuleContext) =>
  context.clauses
    .filter(
      (clause) =>
        clause.type === "data_protection" ||
        /data protection|personal data|privacy/i.test(clause.heading ?? ""),
    )
    .map((clause) => clause.text)
    .join("\n");

export const dataRules: Rule[] = [
  patternRule({
    id: "data.slow-breach-notice",
    title: "Slow notification of a data breach",
    category: "data",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:notif(?:y|ication)|inform|report)\b[^.;]{0,140}\b(?:breach|incident)\b|\b(?:breach|incident)\b[^.;]{0,140}\b(?:notif|inform|report)/i,
    check: (_match, sentence) => {
      const limit = durations(sentence)[0];
      if (!limit || limit.days <= 3) return false;
      return `Notification is allowed up to ${describeDays(limit.days)} after the breach.`;
    },
    explanation:
      "A data breach need not be reported for several days. Under the Digital Personal Data Protection Act, 2023 the data fiduciary must tell the Data Protection Board and the affected individuals, and it cannot do that until its processor tells it.",
    suggestion:
      "Require notification without undue delay and in any case within 72 hours.",
    examples: {
      hit: [
        "The Processor shall notify the Client of any personal data breach within 15 days.",
      ],
      miss: [
        "The Processor shall notify the Client of any personal data breach within 48 hours.",
        "The Processor shall notify the Client of any personal data breach without undue delay.",
      ],
    },
  }),
  patternRule({
    id: "data.cross-border-transfer",
    title: "Personal data may leave India",
    category: "data",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:transfer(?:red|s)?|stor(?:e|ed|es|age)|process(?:ed|es|ing)?|host(?:ed|s|ing)?)\b[^.;]{0,100}\b(?:outside|out of)\s+India\b|\bcross-border\b/i,
    unless: /\bshall not\b|\bnot (?:be )?(?:transfer|stor|process|host)/i,
    explanation:
      "Data may be moved or held outside India. Section 16 of the Digital Personal Data Protection Act, 2023 lets the government restrict transfers to notified countries, and sector rules such as the RBI's payment-data localisation direction can prohibit it outright.",
    suggestion:
      "Require prior written consent for any transfer outside India, and name the permitted locations.",
    examples: {
      hit: [
        "The Vendor may store and process personal data on servers located outside India.",
      ],
      miss: ["The Vendor shall not transfer personal data outside India."],
    },
  }),
  patternRule({
    id: "data.indefinite-retention",
    title: "Data kept indefinitely",
    category: "data",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:retain|keep|store)s?\b[^.;]{0,100}\b(?:indefinitely|in perpetuity|perpetual(?:ly)?|for as long as it (?:deems|considers|wishes)|without (?:any )?time limit)\b/i,
    explanation:
      "Personal data may be kept with no end date. Section 8(7) of the Digital Personal Data Protection Act, 2023 requires erasure once the purpose is served, unless another law requires retention.",
    suggestion:
      "Require return or erasure on termination, and set a fixed retention period.",
    examples: {
      hit: ["The Vendor may retain the data indefinitely for its records."],
      miss: ["The Vendor shall erase the data within 30 days of termination."],
    },
  }),
  patternRule({
    id: "data.broad-use",
    title: "Data may be used for the recipient's own purposes",
    category: "data",
    severity: 4,
    likelihood: 3,
    pattern:
      /\b(?:use|process|exploit|share|disclose|sell|analyse|analyze)\b[^.;]{0,80}\b(?:data|information)\b[^.;]{0,80}\b(?:for any purpose|for its own (?:business |commercial )?purposes?|at its (?:sole )?discretion|with (?:any )?third part(?:y|ies))\b/i,
    unless: /\b(?:shall not|may not|only|solely|except|must not)\b/i,
    explanation:
      "The recipient can use or share the data for purposes of its own. That makes it a data fiduciary in its own right under the Digital Personal Data Protection Act, 2023, and the consent originally collected is unlikely to cover the new use.",
    suggestion:
      "Restrict use to providing the services, on documented instructions only.",
    examples: {
      hit: ["The Vendor may use the Client's data for its own business purposes."],
      miss: [
        "The Vendor shall process the data only on the documented instructions of the Client.",
      ],
    },
  }),
  patternRule({
    id: "data.subprocessor-no-consent",
    title: "Sub-processors may be used without consent",
    category: "data",
    severity: 2,
    likelihood: 3,
    types: ["data_protection"],
    pattern: /\b(?:sub-?processors?|sub-?contract(?:or)?s?)\b/i,
    unless: /\b(?:consent|approval|approved|authori[sz]|notif|notice)\b/i,
    explanation:
      "Others may be brought in to handle the data without the customer knowing or agreeing.",
    suggestion:
      "Require prior written consent for sub-processors and flow the same obligations down to them.",
    examples: {
      hit: ["The Processor may engage sub-processors to process personal data."],
      miss: [
        "The Processor shall not engage sub-processors without the prior written consent of the Client.",
      ],
    },
  }),
  patternRule({
    id: "data.superseded-law",
    title: "Refers to superseded data protection law",
    category: "data",
    severity: 2,
    likelihood: 4,
    pattern:
      /\bSensitive Personal Data(?: or Information)?\b|\bSPDI\b|\bReasonable Security Practices\b|\bPersonal Data Protection Bill\b|\b[Ss]ection 43A\b/,
    explanation:
      "The clause is drafted around section 43A of the Information Technology Act, 2000 and the 2011 SPDI Rules, or around a Bill that was never enacted. The Digital Personal Data Protection Act, 2023 replaces that regime.",
    suggestion:
      "Redraft the clause against the Digital Personal Data Protection Act, 2023.",
    examples: {
      hit: [
        "The Vendor shall comply with the Reasonable Security Practices and Procedures Rules, 2011.",
      ],
      miss: [
        "The Vendor shall comply with the Digital Personal Data Protection Act, 2023.",
      ],
    },
  }),
  patternRule({
    id: "data.ownership-to-supplier",
    title: "Data becomes the supplier's property",
    category: "data",
    severity: 4,
    likelihood: 2,
    pattern:
      /\b(?:data|information)\b[^.;]{0,80}\b(?:become|be|vest in|remain)\b[^.;]{0,30}\b(?:the )?(?:sole |exclusive )?property of\s+(?:the\s+)?(?:Service Provider|Vendor|Supplier|Consultant|Processor|Licensor|Provider)\b/i,
    explanation:
      "Data supplied or generated under the contract is claimed by the supplier.",
    suggestion:
      "State that all customer data, and data derived from it, belongs to the customer.",
    examples: {
      hit: [
        "All data generated through the platform shall be the sole property of the Vendor.",
      ],
      miss: ["All data supplied by the Client shall remain the property of the Client."],
    },
  }),
  patternRule({
    id: "data.liability-excluded",
    title: "No liability for data loss or breach",
    category: "data",
    severity: 4,
    likelihood: 3,
    pattern:
      /\b(?:not (?:be )?liable|no liability|disclaims?)\b[^.;]{0,120}\b(?:loss of data|data loss|data breach|security breach|unauthori[sz]ed access|corruption of data)\b/i,
    explanation:
      "The party holding the data accepts no responsibility if it is lost or exposed. The data fiduciary stays answerable to individuals and to the Data Protection Board, with penalties of up to Rs. 250 crore, and would have no recourse.",
    suggestion:
      "Remove the exclusion, and make data breaches an exception to the liability cap.",
    examples: {
      hit: [
        "The Vendor shall not be liable for any loss of data or unauthorised access to the Client's systems.",
      ],
      miss: [
        "The Vendor shall be liable for any personal data breach caused by its failure to comply.",
      ],
    },
  }),
  {
    kind: "contract",
    id: "data.no-clause",
    title: "Personal data is involved but there is no data protection clause",
    category: "data",
    severity: 4,
    likelihood: 3,
    clauseType: "data_protection",
    detect: (context) =>
      !context.hasType("data_protection") &&
      // An NDA that lists personal data among confidential information is not a processing contract.
      context.contractType !== "nda" &&
      /\bpersonal (?:data|information)\b|\b(?:customer|employee|user|patient) data\b/i.test(
        context.text,
      ),
    explanation:
      "The contract mentions personal data but has no clause governing it. Section 8(2) of the Digital Personal Data Protection Act, 2023 requires a data fiduciary to engage a processor only under a valid contract, and it remains responsible for what the processor does.",
    suggestion:
      "Add a data protection clause: processing on instructions, security safeguards, breach notification, sub-processors and erasure.",
  },
  {
    kind: "contract",
    id: "data.no-breach-notification",
    title: "No duty to report a data breach",
    category: "data",
    severity: 3,
    likelihood: 3,
    clauseType: "data_protection",
    detect: (context) => {
      const text = dataClauses(context);
      return text.length > 0 && !/\bbreach\b|\bincident\b/i.test(text);
    },
    explanation:
      "The data protection terms do not require the other party to report a breach, so the data fiduciary may learn of one too late to meet its own duty to notify under the Digital Personal Data Protection Act, 2023.",
    suggestion:
      "Add a duty to notify any personal data breach within 72 hours, with details.",
  },
  {
    kind: "contract",
    id: "data.no-deletion",
    title: "No duty to return or erase data at the end",
    category: "data",
    severity: 2,
    likelihood: 3,
    clauseType: "data_protection",
    detect: (context) => {
      const text = dataClauses(context);
      return text.length > 0 && !/\b(?:eras|delet|destroy|return|purg)/i.test(text);
    },
    explanation:
      "Nothing requires personal data to be returned or erased when the contract ends.",
    suggestion:
      "Require return or erasure of all personal data within 30 days of termination.",
  },
];
