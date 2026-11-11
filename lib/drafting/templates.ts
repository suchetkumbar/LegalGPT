import type { ClauseType } from "@/lib/pipeline/clause-types";

/**
 * Contract templates as clause skeletons. Each clause is either taken from the
 * organisation's playbook (its standard position for that clause type) or
 * written here, with {PLACEHOLDERS} filled from the requirements form.
 *
 * Drafting from the playbook means a new draft starts at the organisation's
 * own preferred position, and needs no model call.
 */

export type TemplateClause = {
  heading: string;
  type: ClauseType;
  /** Fixed wording. Omit to use the playbook's standard text for `type`. */
  text?: string;
};

export type Template = {
  id: string;
  name: string;
  title: string;
  /** What the two parties are called in the contract. */
  roles: [string, string];
  description: string;
  clauses: TemplateClause[];
};

const PREAMBLE =
  'This {TITLE_CASE} (the "Agreement") is made at {CITY} on {EFFECTIVE_DATE} (the "Effective Date") between {PARTY_A} (the "{ROLE_A}") and {PARTY_B} (the "{ROLE_B}"), each a "Party" and together the "Parties".';

const TERM: TemplateClause = {
  heading: "Term",
  type: "term_and_renewal",
  text: "This Agreement starts on the Effective Date and continues for {TERM}. It may be renewed only by written agreement of the Parties.",
};

const PAYMENT: TemplateClause = {
  heading: "Fees and Payment",
  type: "payment",
  text: "The {ROLE_A} shall pay the {ROLE_B} the fees of {VALUE} as set out in Schedule A. The {ROLE_B} shall invoice monthly in arrears, and the {ROLE_A} shall pay each undisputed invoice within {PAYMENT_DAYS} days of receipt. Late payments carry simple interest at 12% a year. The fees may be changed only by written agreement of the Parties.",
};

const SCOPE: TemplateClause = {
  heading: "Services",
  type: "scope_of_work",
  text: "The {ROLE_B} shall provide the following services: {SCOPE}. The {ROLE_B} shall perform the services with reasonable skill and care and in accordance with good industry practice.",
};

const STAMP: TemplateClause = {
  heading: "Stamp Duty",
  type: "stamp_duty_and_costs",
  text: "The stamp duty payable on this Agreement under the applicable Stamp Act shall be borne equally by the Parties. Each Party shall bear its own costs of negotiating and executing this Agreement.",
};

const SIGNATURES: TemplateClause = {
  heading: "Signatures",
  type: "signature_block",
  text: "IN WITNESS WHEREOF the Parties have executed this Agreement on the Effective Date.\n\nFor {PARTY_A}\nName:\nDesignation:\n\nFor {PARTY_B}\nName:\nDesignation:",
};

const NDA_DEFINITION: TemplateClause = {
  heading: "Definitions",
  type: "definitions",
  text: '"Confidential Information" means all information disclosed by one Party to the other in connection with {SCOPE}, in any form, that is marked confidential or that a reasonable person would understand to be confidential.',
};

/** Clauses every commercial contract ends with. */
const CLOSING: TemplateClause[] = [
  { heading: "Governing Law and Jurisdiction", type: "governing_law_and_jurisdiction" },
  { heading: "Dispute Resolution", type: "dispute_resolution" },
  { heading: "Notices", type: "notices" },
  STAMP,
  { heading: "General", type: "general_provisions" },
];

export const TEMPLATES: Template[] = [
  {
    id: "nda-mutual",
    name: "Mutual NDA",
    title: "MUTUAL NON-DISCLOSURE AGREEMENT",
    roles: ["First Party", "Second Party"],
    description:
      "Both parties share confidential information, for example while exploring a deal.",
    clauses: [
      NDA_DEFINITION,
      { heading: "Confidentiality", type: "confidentiality" },
      TERM,
      { heading: "Non-Solicitation", type: "non_solicitation" },
      ...CLOSING,
    ],
  },
  {
    id: "nda-one-way",
    name: "One-way NDA",
    title: "NON-DISCLOSURE AGREEMENT",
    roles: ["Disclosing Party", "Receiving Party"],
    description:
      "Only one party discloses, for example to a vendor or a prospective hire.",
    clauses: [
      NDA_DEFINITION,
      {
        heading: "Confidentiality",
        type: "confidentiality",
        text: "The Receiving Party shall keep the Confidential Information of the Disclosing Party secret, use it only in connection with {SCOPE}, and disclose it only to its employees and advisers who need to know it and are bound by equivalent obligations. These obligations survive for 3 years after this Agreement ends, except that trade secrets are protected for as long as they remain secret. They do not apply to information that is public, already known to the Receiving Party, independently developed, or required to be disclosed by law.",
      },
      TERM,
      ...CLOSING,
    ],
  },
  {
    id: "msa",
    name: "Master Services Agreement",
    title: "MASTER SERVICES AGREEMENT",
    roles: ["Customer", "Supplier"],
    description:
      "A framework for ongoing services, with statements of work for each project.",
    clauses: [
      SCOPE,
      PAYMENT,
      { heading: "Taxes", type: "taxes" },
      TERM,
      { heading: "Intellectual Property", type: "intellectual_property" },
      { heading: "Confidentiality", type: "confidentiality" },
      { heading: "Data Protection", type: "data_protection" },
      { heading: "Warranties", type: "warranties_and_representations" },
      { heading: "Limitation of Liability", type: "limitation_of_liability" },
      { heading: "Indemnity", type: "indemnity" },
      { heading: "Insurance", type: "insurance" },
      { heading: "Termination", type: "termination" },
      { heading: "Force Majeure", type: "force_majeure" },
      { heading: "Assignment and Subcontracting", type: "assignment_and_subcontracting" },
      { heading: "Non-Solicitation", type: "non_solicitation" },
      ...CLOSING,
    ],
  },
  {
    id: "sow",
    name: "Statement of Work",
    title: "STATEMENT OF WORK",
    roles: ["Customer", "Supplier"],
    description: "One project under an existing master services agreement.",
    clauses: [
      {
        heading: "Relationship to the Master Agreement",
        type: "general_provisions",
        text: "This Statement of Work is issued under the master services agreement between the Parties, whose terms apply to it. If they conflict, the master services agreement prevails unless this Statement of Work expressly says otherwise.",
      },
      SCOPE,
      {
        heading: "Acceptance",
        type: "scope_of_work",
        text: "The {ROLE_A} shall review each deliverable within 10 business days of delivery and either accept it in writing or describe in writing how it fails to meet the specification. The {ROLE_B} shall correct the failure and redeliver.",
      },
      PAYMENT,
      TERM,
      SIGNATURES,
    ],
  },
  {
    id: "saas",
    name: "SaaS Subscription",
    title: "SOFTWARE AS A SERVICE SUBSCRIPTION AGREEMENT",
    roles: ["Customer", "Provider"],
    description: "Access to hosted software on a subscription.",
    clauses: [
      SCOPE,
      {
        heading: "Service Levels",
        type: "service_levels",
        text: "The {ROLE_B} shall make the service available for at least 99.5% of each calendar month, excluding planned maintenance notified 48 hours in advance. If availability falls below that level, the {ROLE_A} receives a service credit of 5% of the monthly fee for each full percentage point of shortfall, up to 50% of that month's fee, without prejudice to its other remedies.",
      },
      PAYMENT,
      { heading: "Taxes", type: "taxes" },
      TERM,
      {
        heading: "Intellectual Property",
        type: "intellectual_property",
        text: "The {ROLE_B} owns the service and its software. The {ROLE_A} owns all data it uploads or generates through the service, and grants the {ROLE_B} a licence to use that data only to provide the service. On termination the {ROLE_B} shall make the {ROLE_A}'s data available for export for 30 days and then erase it.",
      },
      { heading: "Confidentiality", type: "confidentiality" },
      { heading: "Data Protection", type: "data_protection" },
      { heading: "Warranties", type: "warranties_and_representations" },
      { heading: "Limitation of Liability", type: "limitation_of_liability" },
      { heading: "Indemnity", type: "indemnity" },
      { heading: "Termination", type: "termination" },
      { heading: "Force Majeure", type: "force_majeure" },
      ...CLOSING,
    ],
  },
  {
    id: "consulting",
    name: "Consulting Agreement",
    title: "CONSULTING AGREEMENT",
    roles: ["Client", "Consultant"],
    description:
      "An independent consultant engaged for advice or a defined piece of work.",
    clauses: [
      SCOPE,
      PAYMENT,
      { heading: "Taxes", type: "taxes" },
      TERM,
      {
        heading: "Independent Contractor",
        type: "general_provisions",
        text: "The {ROLE_B} is an independent contractor and not an employee of the {ROLE_A}. The {ROLE_B} is responsible for its own taxes and statutory contributions.",
      },
      { heading: "Intellectual Property", type: "intellectual_property" },
      { heading: "Confidentiality", type: "confidentiality" },
      { heading: "Limitation of Liability", type: "limitation_of_liability" },
      { heading: "Termination", type: "termination" },
      { heading: "Non-Solicitation", type: "non_solicitation" },
      ...CLOSING,
    ],
  },
  {
    id: "employment",
    name: "Employment Offer",
    title: "EMPLOYMENT AGREEMENT",
    roles: ["Company", "Employee"],
    description: "An offer of employment with the main terms.",
    clauses: [
      {
        heading: "Appointment",
        type: "employment_terms",
        text: "The {ROLE_A} appoints the {ROLE_B} to the role of {SCOPE} with effect from the Effective Date. The {ROLE_B} shall be on probation for 6 months, during which either Party may end the employment on 15 days' notice.",
      },
      {
        heading: "Remuneration and Leave",
        type: "employment_terms",
        text: "The {ROLE_B} shall be paid an annual cost to company of {VALUE}, subject to tax deducted at source and contributions under the Employees' Provident Funds and Miscellaneous Provisions Act, 1952. The {ROLE_B} is entitled to 24 days of paid leave in each calendar year in addition to public holidays.",
      },
      { heading: "Confidentiality", type: "confidentiality" },
      {
        heading: "Intellectual Property",
        type: "intellectual_property",
        text: "All work product the {ROLE_B} creates in the course of employment belongs to the {ROLE_A}. The {ROLE_B} hereby assigns to the {ROLE_A} all rights in it, worldwide and for the full term of those rights including renewals.",
      },
      {
        heading: "Non-Solicitation",
        type: "non_solicitation",
        text: "For 12 months after the employment ends, the {ROLE_B} shall not solicit any employee of the {ROLE_A} with whom the {ROLE_B} worked to leave the {ROLE_A}. General advertising is not solicitation.",
      },
      {
        heading: "Termination",
        type: "termination",
        text: "After probation, either Party may end the employment by giving 2 months' written notice, or by the {ROLE_A} paying salary in lieu of notice. The {ROLE_A} may end the employment without notice for gross misconduct established after a fair inquiry.",
      },
      {
        heading: "Governing Law and Jurisdiction",
        type: "governing_law_and_jurisdiction",
      },
      STAMP,
      SIGNATURES,
    ],
  },
];

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

export { PREAMBLE, SIGNATURES };
