/**
 * The 30 clause types every clause is classified into, plus "other". Chosen
 * for Indian commercial and employment contracts: taxes covers GST and TDS,
 * stamp duty has its own type, and non-compete is separate from
 * non-solicitation because section 27 of the Indian Contract Act treats
 * restraints of trade specially.
 *
 * The descriptions are sent to the model, so keep them short and distinct.
 */
export const CLAUSE_TYPES = {
  preamble: "Title, date, and the description of the parties",
  recitals: "Background statements, usually starting with WHEREAS",
  definitions: "Defined terms and interpretation rules",
  scope_of_work: "The services, goods or deliverables to be provided, and acceptance",
  payment: "Fees, invoicing, payment periods, late-payment interest, expenses",
  taxes: "GST, TDS and other tax obligations",
  term_and_renewal: "Start date, duration, renewal and extension",
  termination: "Rights to end the contract, notice periods, effects of termination",
  confidentiality: "Protection and permitted use of confidential information",
  intellectual_property: "Ownership, assignment and licensing of IP and work product",
  data_protection: "Personal data, privacy, security safeguards, breach notification",
  limitation_of_liability: "Liability caps and excluded kinds of loss",
  indemnity: "One party covering the other's losses or third-party claims",
  warranties_and_representations: "Promises about authority, quality or accuracy",
  non_compete: "Restrictions on competing or working with competitors",
  non_solicitation: "Restrictions on poaching employees or customers",
  governing_law_and_jurisdiction: "Which law applies and which courts have jurisdiction",
  dispute_resolution: "Arbitration, mediation and escalation procedures",
  force_majeure: "Relief for events outside a party's control",
  assignment_and_subcontracting: "Transferring the contract or using subcontractors",
  notices: "How formal notices must be sent",
  general_provisions:
    "Entire agreement, amendment, waiver, severability, counterparts, relationship of parties",
  insurance: "Insurance a party must maintain",
  audit_and_records: "Record keeping and audit or inspection rights",
  service_levels: "Uptime, response times, service credits",
  compliance_and_anti_corruption: "Compliance with laws, anti-bribery, ethics",
  stamp_duty_and_costs: "Stamp duty, registration and who bears the costs",
  employment_terms: "Appointment, probation, salary, working hours, leave, benefits",
  schedule: "A schedule, annexure, exhibit or appendix",
  signature_block: "Execution wording and signatures",
  other: "Anything that fits none of the above",
} as const;

export type ClauseType = keyof typeof CLAUSE_TYPES;

export const CLAUSE_TYPE_IDS = Object.keys(CLAUSE_TYPES) as [ClauseType, ...ClauseType[]];

export function isClauseType(value: string): value is ClauseType {
  return value in CLAUSE_TYPES;
}

/** "limitation_of_liability" → "Limitation of liability", for display. */
export function clauseTypeLabel(type: string): string {
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
