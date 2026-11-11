import type { PackRule, RulePack } from "./engine";

/**
 * The built-in rule packs. India first: the DPDP Act, the Contract Act, the
 * Arbitration Act and the Stamp Act apply to almost every contract an Indian
 * business signs. GDPR and CCPA apply only when the contract points to them.
 *
 * Packs are data. To change a rule, edit it here, bump the pack's version and
 * set reviewedOn; verdicts already stored keep the version they were made with.
 */

const R = String.raw;
const DATA: PackRule["check"]["clauseTypes"] = ["data_protection"];

const NON_COMPETE = R`(?:shall not|not to|will not)\b[^.;]{0,200}\b(?:compet|be employed by|be engaged in|be associated with|similar (?:business|services)|engage any other)`;
const AFTER = R`\b(?:after|following|thereafter|post-?termination)\b`;

export const DPDP: RulePack = {
  code: "DPDP",
  name: "Digital Personal Data Protection Act, 2023",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    clauseTypes: ["data_protection"],
    // Processing, not a passing mention: an NDA that lists personal data
    // among confidential information does not process it.
    mentions: [
      R`\bprocess(?:es|ed|ing)?\b[^.;]{0,100}\bpersonal (?:data|information)\b`,
      R`\bpersonal (?:data|information)\b[^.;]{0,100}\bprocess(?:es|ed|ing)?\b`,
    ],
    description:
      "Applies when the contract has a data protection clause or provides for processing personal data.",
  },
  rules: [
    {
      id: "dpdp.processor-contract",
      title: "Processing is governed by a contract clause",
      reference: "DPDP Act 2023, s. 8(2)",
      description:
        "A data fiduciary may engage a data processor only under a valid contract, and remains responsible for what the processor does.",
      category: "data",
      check: { clauseTypes: DATA, require: [R`\b(?:process|personal data|data)\b`] },
      fix: "Add a data protection clause covering the processing done under this contract.",
    },
    {
      id: "dpdp.purpose-limitation",
      title: "Processing limited to instructions or a stated purpose",
      reference: "DPDP Act 2023, ss. 4, 8(2)",
      description:
        "Personal data may be processed only for the lawful purpose it was collected for, so a processor must be confined to the fiduciary's instructions.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\binstructions?\b`,
          R`\b(?:only|solely) for (?:the )?purpose`,
          R`\bspecified purpose`,
        ],
      },
      fix: "State that personal data is processed only on documented instructions and only to perform the contract.",
    },
    {
      id: "dpdp.own-purposes",
      title: "No use of personal data for the recipient's own purposes",
      reference: "DPDP Act 2023, ss. 4, 6",
      description:
        "Using the data for the recipient's own purposes goes beyond the consent it was collected under and makes the recipient a data fiduciary in its own right.",
      category: "data",
      check: {
        forbid: [
          R`\b(?:use|process|share|disclose|sell)\b[^.;]{0,80}\b(?:data|information)\b[^.;]{0,80}\b(?:for any purpose|for its own (?:business |commercial )?purposes?|with (?:any )?third part(?:y|ies) for)`,
        ],
      },
      fix: "Remove the right to use or share the data for the recipient's own purposes.",
    },
    {
      id: "dpdp.security-safeguards",
      title: "Reasonable security safeguards",
      reference: "DPDP Act 2023, s. 8(5)",
      description:
        "A data fiduciary must protect personal data in its possession, including data handled by its processor, by reasonable security safeguards.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\bsecurity (?:safeguards?|measures?|practices)`,
          R`\btechnical and organi[sz]ational`,
          R`\bencrypt`,
        ],
      },
      fix: "Require reasonable security safeguards to prevent a personal data breach.",
    },
    {
      id: "dpdp.breach-notification",
      title: "Personal data breaches are reported",
      reference: "DPDP Act 2023, s. 8(6)",
      description:
        "The fiduciary must notify the Data Protection Board and each affected individual of a breach, which it cannot do unless its processor reports breaches to it.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\b(?:notif|inform|report)[^.;]{0,120}\bbreach`,
          R`\bbreach\b[^.;]{0,120}\b(?:notif|inform|report)`,
        ],
      },
      fix: "Require notification of any personal data breach without delay, and within 72 hours at most.",
    },
    {
      id: "dpdp.erasure",
      title: "Data is erased or returned when no longer needed",
      reference: "DPDP Act 2023, s. 8(7)",
      description:
        "Personal data must be erased once its purpose is served, and the fiduciary must cause its processor to erase it too.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [R`\b(?:eras|delet|destroy|purg)`, R`\breturn\b[^.;]{0,60}\bdata`],
      },
      fix: "Require return or erasure of all personal data on termination.",
    },
    {
      id: "dpdp.cross-border",
      title: "Transfers outside India are controlled",
      reference: "DPDP Act 2023, s. 16",
      description:
        "The Central Government may restrict transfers of personal data to notified countries, and sector regulators impose localisation of their own.",
      category: "data",
      check: {
        forbid: [
          R`\b(?:may|shall be entitled to|is permitted to)\b[^.;]{0,60}\b(?:transfer|store|process|host)[^.;]{0,100}\b(?:outside|out of)\s+India`,
        ],
        ifForbidden: "warn",
      },
      fix: "Allow transfers outside India only with prior written consent and to named locations.",
    },
    {
      id: "dpdp.sub-processors",
      title: "Sub-processors need consent",
      reference: "DPDP Act 2023, s. 8(1), (2)",
      description:
        "The fiduciary stays responsible for anyone who processes the data on its behalf, so it should control who else is brought in.",
      category: "data",
      check: {
        clauseTypes: DATA,
        forbid: [
          R`\bmay (?:engage|appoint|use)\b[^.;]{0,40}\bsub-?(?:processors?|contractors?)\b(?![^.;]{0,120}\b(?:consent|approval))`,
        ],
        ifForbidden: "warn",
      },
      fix: "Require prior written consent before any sub-processor is engaged.",
    },
  ],
};

export const ICA: RulePack = {
  code: "ICA",
  name: "Indian Contract Act, 1872",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    always: true,
    description: "Applies to every contract reviewed under Indian law.",
  },
  rules: [
    {
      id: "ica.s27-restraint-of-trade",
      title: "No restraint of trade after the contract ends",
      reference: "Indian Contract Act 1872, s. 27",
      description:
        "An agreement restraining anyone from a lawful profession, trade or business is void. The courts apply this strictly to non-competes that continue after termination, however short.",
      category: "restrictions",
      check: {
        forbid: [
          `${AFTER}[^.;]{0,200}\\b${NON_COMPETE}`,
          `\\b${NON_COMPETE}[^.;]{0,200}${AFTER}`,
        ],
      },
      fix: "Limit the non-compete to the term of the contract; rely on confidentiality and non-solicitation afterwards.",
    },
    {
      id: "ica.s28-legal-proceedings",
      title: "No bar on enforcing rights in legal proceedings",
      reference: "Indian Contract Act 1872, s. 28",
      description:
        "A term that absolutely restrains a party from enforcing its rights by the usual legal proceedings, or extinguishes its rights after a shortened period, is void. Arbitration clauses are the exception.",
      category: "disputes",
      check: {
        forbid: [
          R`\b(?:waives?|gives? up|relinquish(?:es)?|surrenders?)\b[^.;]{0,100}\b(?:right to (?:sue|approach|seek|bring|file)|legal proceedings)`,
          R`\bno (?:claim|action|suit)\b[^.;]{0,80}\b(?:may|shall|can) be (?:brought|made|filed)\b[^.;]{0,60}\b(?:after|more than)\b`,
        ],
      },
      fix: "Delete the waiver or time bar. Use an arbitration clause to keep disputes out of court.",
    },
    {
      id: "ica.s74-penalty",
      title: "Sums payable on breach are reasonable compensation",
      reference: "Indian Contract Act 1872, s. 74",
      description:
        "Where a contract names a sum payable on breach, or a penalty, the court awards only reasonable compensation not exceeding it. A penal figure may not be recovered in full.",
      category: "liability",
      check: {
        forbid: [
          R`\bliquidated damages\b`,
          R`\bby way of penalty\b`,
          R`\bpenalty of\b`,
          R`\b(?:termination|cancellation|exit) (?:fee|charge|penalty)`,
        ],
        ifForbidden: "warn",
      },
      fix: "Check the amount is a genuine pre-estimate of loss, and cap the total payable.",
    },
    {
      id: "ica.s124-indemnity",
      title: "Indemnities have a limit",
      reference: "Indian Contract Act 1872, ss. 124, 125",
      description:
        "An indemnity holder can recover all damages, costs and sums paid under the indemnity. Without a cap the promisor's exposure is open-ended.",
      category: "liability",
      check: {
        forbid: [
          R`\bindemnif[^.;]{0,220}\b(?:without (?:any )?(?:limit|cap)\b|unlimited\b)`,
        ],
        ifForbidden: "warn",
      },
      fix: "Bring the indemnity under the liability cap, or cap it separately.",
    },
  ],
};

export const ARBITRATION: RulePack = {
  code: "ARB",
  name: "Arbitration and Conciliation Act, 1996",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    mentions: [R`\barbitrat`],
    description: "Applies when the contract provides for arbitration.",
  },
  rules: [
    {
      id: "arb.unilateral-appointment",
      title: "The sole arbitrator is not appointed by one party",
      reference:
        "Arbitration and Conciliation Act 1996, s. 12(5); Perkins Eastman v. HSCC (2019)",
      description:
        "A party with an interest in the outcome cannot appoint the sole arbitrator. Such an appointment clause is invalid and a court will appoint instead under section 11.",
      category: "disputes",
      check: {
        forbid: [
          R`\barbitrator\b[^.;]{0,80}\b(?:appointed|nominated|designated|chosen|selected)\s+(?:solely\s+)?by\s+(?:the\s+)?(?!parties|both|mutual|court|an? )(?:Company|Client|Customer|Vendor|Supplier|Service Provider|Consultant|Contractor|Employer|Licensor|Lessor|Managing Director|Chairman|Director)\b`,
        ],
      },
      fix: "Appoint by agreement, failing which through an arbitral institution such as MCIA or DIAC.",
    },
    {
      id: "arb.seat",
      title: "The seat of arbitration is named",
      reference: "Arbitration and Conciliation Act 1996, s. 20",
      description:
        "The seat decides which courts supervise the arbitration. Leaving it out is a common cause of preliminary litigation.",
      category: "disputes",
      check: {
        clauseTypes: ["dispute_resolution", "governing_law_and_jurisdiction"],
        require: [R`\b(?:seat|venue|place)\b`],
        ifMissing: "warn",
      },
      fix: "Name the seat of arbitration, the language and the number of arbitrators.",
    },
  ],
};

export const STAMP: RulePack = {
  code: "STAMP",
  name: "Stamp duty",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    always: true,
    description: "A reminder for every contract executed in India.",
  },
  rules: [
    {
      id: "stamp.duty-addressed",
      title: "Stamp duty is dealt with",
      reference: "Indian Stamp Act 1899, s. 35, and the applicable State Stamp Act",
      description:
        "An instrument that is not duly stamped cannot be admitted in evidence until the duty and a penalty of up to ten times are paid. Rates differ by State and by type of document.",
      category: "disputes",
      check: { require: [R`\bstamp`], ifMissing: "warn" },
      fix: "Stamp the contract under the applicable State's Stamp Act and say who bears the duty.",
    },
  ],
};

export const GDPR: RulePack = {
  code: "GDPR",
  name: "GDPR, Article 28 (processor terms)",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    mentions: [
      R`\bGDPR\b`,
      R`General Data Protection Regulation`,
      R`\bEuropean (?:Union|Economic Area)\b`,
      R`\bEEA\b`,
    ],
    governingLaw: [
      R`England|Ireland|Germany|France|Netherlands|Spain|Italy|European Union`,
    ],
    description:
      "Applies when the contract refers to the GDPR or the EU, or is governed by the law of a European country.",
  },
  rules: [
    {
      id: "gdpr.28-3-a-instructions",
      title: "Processing only on documented instructions",
      reference: "GDPR, Art. 28(3)(a)",
      description:
        "The processor must process personal data only on documented instructions from the controller.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [R`\b(?:documented |written )?instructions?\b`],
      },
      fix: "State that the processor acts only on the controller's documented instructions.",
    },
    {
      id: "gdpr.28-3-b-confidentiality",
      title: "Personnel are bound to confidentiality",
      reference: "GDPR, Art. 28(3)(b)",
      description:
        "Persons authorised to process the data must have committed themselves to confidentiality.",
      category: "data",
      check: {
        clauseTypes: [...DATA!, "confidentiality"],
        require: [R`\b(?:personnel|employees|staff|persons)\b[^.;]{0,100}\bconfidential`],
      },
      fix: "Require everyone who handles the data to be bound by confidentiality.",
    },
    {
      id: "gdpr.28-3-c-security",
      title: "Security measures under Article 32",
      reference: "GDPR, Art. 28(3)(c)",
      description: "The processor must take the security measures Article 32 requires.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\bsecurity (?:safeguards?|measures?)`,
          R`\btechnical and organi[sz]ational`,
        ],
      },
      fix: "Require appropriate technical and organisational security measures.",
    },
    {
      id: "gdpr.28-2-sub-processors",
      title: "Sub-processors only with authorisation",
      reference: "GDPR, Art. 28(2), (3)(d)",
      description:
        "The processor must not engage another processor without the controller's prior written authorisation.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\bsub-?(?:processors?|contractors?)\b[^.;]{0,120}\b(?:consent|authori[sz]|approval)`,
          R`\b(?:consent|authori[sz]|approval)[^.;]{0,120}\bsub-?(?:processors?|contractors?)`,
        ],
      },
      fix: "Require prior written authorisation for any sub-processor, with the same obligations flowed down.",
    },
    {
      id: "gdpr.28-3-e-data-subject-rights",
      title: "Assistance with data subject requests",
      reference: "GDPR, Art. 28(3)(e)",
      description:
        "The processor must help the controller respond to requests from individuals exercising their rights.",
      category: "data",
      check: {
        clauseTypes: DATA,
        require: [
          R`\b(?:data subjects?|individuals?|data principals?)\b[^.;]{0,100}\b(?:requests?|rights)`,
          R`\bassist`,
        ],
      },
      fix: "Require the processor to assist with data subject requests.",
    },
    {
      id: "gdpr.28-3-g-deletion",
      title: "Deletion or return at the end",
      reference: "GDPR, Art. 28(3)(g)",
      description:
        "At the end of the services the processor must delete or return all personal data.",
      category: "data",
      check: { clauseTypes: DATA, require: [R`\b(?:eras|delet|destroy|return)`] },
      fix: "Require deletion or return of all personal data when the services end.",
    },
    {
      id: "gdpr.28-3-h-audit",
      title: "Audit and information rights",
      reference: "GDPR, Art. 28(3)(h)",
      description:
        "The processor must make available the information needed to show compliance and allow audits.",
      category: "data",
      check: { require: [R`\baudit`, R`\binspect`], ifMissing: "fail" },
      fix: "Give the controller the right to audit, and to receive information showing compliance.",
    },
  ],
};

export const CCPA: RulePack = {
  code: "CCPA",
  name: "CCPA / CPRA (service provider terms)",
  version: "2026.1",
  reviewedOn: "2026-11-11",
  applicability: {
    mentions: [R`\bCCPA\b`, R`\bCPRA\b`, R`California Consumer Privacy`],
    governingLaw: [R`California`],
    description:
      "Applies when the contract refers to the CCPA or CPRA, or is governed by California law.",
  },
  rules: [
    {
      id: "ccpa.no-sale",
      title: "No selling or sharing of personal information",
      reference: "Cal. Civ. Code § 1798.140(ag)(1)(A)",
      description:
        "A service provider must be prohibited from selling or sharing the personal information it receives.",
      category: "data",
      check: {
        require: [
          R`\b(?:shall not|not to|must not|prohibited from)\b[^.;]{0,60}\b(?:sell|shar)`,
        ],
      },
      fix: "Prohibit the service provider from selling or sharing personal information.",
    },
    {
      id: "ccpa.limited-purpose",
      title: "Use limited to the business purpose in the contract",
      reference: "Cal. Civ. Code § 1798.140(ag)(1)(B)",
      description:
        "Personal information may be retained, used or disclosed only for the business purposes specified in the contract.",
      category: "data",
      check: {
        require: [
          R`\b(?:only|solely) for (?:the )?(?:business )?purpose`,
          R`\bspecified (?:business )?purpose`,
          R`\binstructions?\b`,
        ],
      },
      fix: "Limit use of personal information to the specific business purpose of the contract.",
    },
    {
      id: "ccpa.notify-inability",
      title: "Notice if the provider can no longer comply",
      reference: "Cal. Civ. Code § 1798.100(d)(4)",
      description:
        "The service provider must notify the business if it can no longer meet its obligations.",
      category: "data",
      check: {
        require: [R`\bnotif[^.;]{0,120}\b(?:no longer|unable to) (?:meet|comply)`],
        ifMissing: "warn",
      },
      fix: "Require notice if the provider determines it can no longer meet its obligations.",
    },
  ],
};

/** India-first order: this is the order packs appear in the compliance view. */
export const BUILT_IN_PACKS: RulePack[] = [DPDP, ICA, ARBITRATION, STAMP, GDPR, CCPA];
