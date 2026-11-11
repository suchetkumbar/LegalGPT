import type { ClauseType } from "@/lib/pipeline/clause-types";

/**
 * The clause library the evaluation contracts are composed from. Each entry
 * is typed by hand, so a generated contract comes with exact gold labels.
 *
 * `paras` become sub-clauses (4.1, 4.2, ...) in numbering styles that have
 * them, and plain paragraphs otherwise. A paragraph may carry its own type
 * when it differs from its parent: the GST paragraph under "Fees" is taxes.
 *
 * {A} and {B} are the two parties' short names; {CITY} is the seat or venue.
 */
export type LibraryClause = {
  type: ClauseType;
  headings: string[];
  paras: (string | { text: string; type: ClauseType })[];
};

export const LIBRARY: LibraryClause[] = [
  {
    type: "definitions",
    headings: ["Definitions", "Definitions and Interpretation"],
    paras: [
      '"Affiliate" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party.',
      '"Business Day" means a day other than a Saturday, a Sunday or a public holiday in {CITY}.',
      "Headings are for convenience only and shall not affect the interpretation of this Agreement.",
    ],
  },
  {
    type: "scope_of_work",
    headings: ["Scope of Services", "Services", "Scope of Work"],
    paras: [
      "{B} shall provide the services described in each statement of work executed by the parties.",
      "{B} shall perform the services with reasonable skill and care and in accordance with good industry practice.",
      "The deliverables shall be deemed accepted unless {A} notifies {B} of a material defect within 10 Business Days of delivery.",
    ],
  },
  {
    type: "payment",
    headings: ["Fees and Payment", "Payment Terms", "Consideration"],
    paras: [
      "{A} shall pay {B} the fees set out in the applicable statement of work.",
      "{B} shall raise invoices monthly in arrears and {A} shall pay each undisputed invoice within 45 days of receipt.",
      {
        text: "All amounts are exclusive of Goods and Services Tax, which shall be charged at the applicable rate. {A} may deduct tax at source under the Income-tax Act, 1961 and shall furnish the TDS certificate within the statutory period.",
        type: "taxes",
      },
      "Overdue amounts shall carry interest at 12% per annum from the due date until payment.",
    ],
  },
  {
    type: "taxes",
    headings: ["Taxes", "Taxes and Duties"],
    paras: [
      "Each party shall bear its own income taxes. Goods and Services Tax on the fees shall be borne by {A}.",
      "Where tax is required to be deducted at source, the deducting party shall deposit it with the government and issue a certificate of deduction.",
    ],
  },
  {
    type: "term_and_renewal",
    headings: ["Term", "Term and Renewal", "Duration"],
    paras: [
      "This Agreement shall commence on the Effective Date and shall continue for a period of 2 years.",
      "This Agreement shall renew automatically for successive periods of 1 year unless either party gives notice of non-renewal at least 60 days before expiry.",
    ],
  },
  {
    type: "termination",
    headings: ["Termination", "Termination and Consequences"],
    paras: [
      "Either party may terminate this Agreement by giving 60 days written notice to the other party.",
      "Either party may terminate this Agreement with immediate effect if the other party commits a material breach and fails to remedy it within 30 days of notice.",
      "On termination, {A} shall pay all fees accrued up to the date of termination and each party shall return the property of the other.",
    ],
  },
  {
    type: "confidentiality",
    headings: ["Confidentiality", "Confidential Information"],
    paras: [
      "Each party shall keep confidential all information of the other party that is marked confidential or is by its nature confidential.",
      "The receiving party shall not disclose such information to any third party except to its employees and advisers who need to know it.",
      "These obligations shall survive for 3 years after the termination of this Agreement.",
    ],
  },
  {
    type: "intellectual_property",
    headings: [
      "Intellectual Property",
      "Intellectual Property Rights",
      "Ownership of Work Product",
    ],
    paras: [
      "All intellectual property rights in the deliverables shall vest in {A} upon payment of the fees in full.",
      "{B} retains all rights in its pre-existing materials and grants {A} a perpetual, non-exclusive licence to use them as part of the deliverables.",
    ],
  },
  {
    type: "data_protection",
    headings: ["Data Protection", "Personal Data", "Data Privacy"],
    paras: [
      "{B} shall process personal data only on the documented instructions of {A} and in compliance with the Digital Personal Data Protection Act, 2023.",
      "{B} shall implement reasonable security safeguards and shall notify {A} of any personal data breach within 48 hours of becoming aware of it.",
      "On termination, {B} shall erase all personal data unless retention is required by law.",
    ],
  },
  {
    type: "limitation_of_liability",
    headings: ["Limitation of Liability", "Liability"],
    paras: [
      "Neither party shall be liable for any indirect, special or consequential loss, or for loss of profit or goodwill.",
      "The total liability of each party under this Agreement shall not exceed the fees paid in the 12 months preceding the claim.",
      {
        text: "{B} shall indemnify {A} against any third-party claim that the deliverables infringe the intellectual property rights of that third party.",
        type: "indemnity",
      },
    ],
  },
  {
    type: "indemnity",
    headings: ["Indemnity", "Indemnification"],
    paras: [
      "Each party shall indemnify and hold harmless the other party against all losses arising from its breach of this Agreement or its negligence.",
      "The indemnified party shall give prompt notice of any claim and shall not settle it without the consent of the indemnifying party.",
    ],
  },
  {
    type: "warranties_and_representations",
    headings: ["Representations and Warranties", "Warranties"],
    paras: [
      "Each party represents that it is duly incorporated and has full power and authority to enter into this Agreement.",
      "{B} warrants that the services will conform to the specifications for a period of 90 days from acceptance.",
    ],
  },
  {
    type: "non_compete",
    headings: ["Non-Compete", "Restrictive Covenant", "Exclusivity"],
    paras: [
      "During the term and for 12 months thereafter, {B} shall not carry on or be engaged in any business that competes with the business of {A} in India.",
    ],
  },
  {
    type: "non_solicitation",
    headings: ["Non-Solicitation", "Non-Solicitation of Employees"],
    paras: [
      "During the term and for 12 months thereafter, neither party shall solicit or hire any employee of the other party who was involved in the performance of this Agreement.",
    ],
  },
  {
    type: "governing_law_and_jurisdiction",
    headings: ["Governing Law and Jurisdiction", "Governing Law", "Applicable Law"],
    paras: [
      "This Agreement shall be governed by and construed in accordance with the laws of India.",
      "Subject to the arbitration clause, the courts at {CITY} shall have exclusive jurisdiction over any matter arising out of this Agreement.",
    ],
  },
  {
    type: "dispute_resolution",
    headings: ["Dispute Resolution", "Arbitration"],
    paras: [
      "The parties shall first attempt to resolve any dispute through good-faith negotiation between their senior management within 30 days.",
      "Failing such resolution, the dispute shall be referred to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be {CITY} and the language shall be English.",
    ],
  },
  {
    type: "force_majeure",
    headings: ["Force Majeure"],
    paras: [
      "Neither party shall be liable for any failure to perform caused by an event beyond its reasonable control, including flood, earthquake, epidemic, strike or act of government.",
      "If such an event continues for more than 90 days, either party may terminate this Agreement by written notice.",
    ],
  },
  {
    type: "assignment_and_subcontracting",
    headings: ["Assignment", "Assignment and Subcontracting"],
    paras: [
      "Neither party shall assign this Agreement without the prior written consent of the other party.",
      "{B} may engage subcontractors with the prior approval of {A} and shall remain responsible for their acts and omissions.",
    ],
  },
  {
    type: "notices",
    headings: ["Notices"],
    paras: [
      "Any notice under this Agreement shall be in writing and sent by registered post or email to the address of the party set out above.",
      "A notice sent by email shall be deemed received on the next Business Day.",
    ],
  },
  {
    type: "general_provisions",
    headings: ["General", "Miscellaneous", "General Provisions"],
    paras: [
      "This Agreement constitutes the entire agreement between the parties and supersedes all prior understandings.",
      "No amendment to this Agreement shall be valid unless made in writing and signed by both parties.",
      "If any provision of this Agreement is held to be unenforceable, the remaining provisions shall continue in full force.",
    ],
  },
  {
    type: "insurance",
    headings: ["Insurance"],
    paras: [
      "{B} shall maintain professional indemnity insurance of not less than INR 2,00,00,000 with a reputable insurer throughout the term.",
    ],
  },
  {
    type: "audit_and_records",
    headings: ["Audit", "Records and Audit", "Audit Rights"],
    paras: [
      "{B} shall maintain complete and accurate records relating to the services for a period of 8 years.",
      "{A} may, on 15 days notice and not more than once a year, inspect such records during business hours.",
    ],
  },
  {
    type: "service_levels",
    headings: ["Service Levels", "Service Level Agreement"],
    paras: [
      "{B} shall ensure that the hosted application is available for at least 99.5% of each calendar month.",
      "If availability falls below that level, {A} shall be entitled to a service credit of 5% of the monthly fee for each full percentage point of shortfall.",
    ],
  },
  {
    type: "compliance_and_anti_corruption",
    headings: ["Compliance with Laws", "Anti-Bribery", "Compliance"],
    paras: [
      "Each party shall comply with all applicable laws, including the Prevention of Corruption Act, 1988.",
      "Neither party shall offer or give any bribe, gift or improper advantage to any public servant or other person in connection with this Agreement.",
    ],
  },
  {
    type: "stamp_duty_and_costs",
    headings: ["Stamp Duty", "Stamp Duty and Costs", "Costs"],
    paras: [
      "The stamp duty payable on this Agreement shall be borne equally by the parties. Each party shall bear its own legal costs.",
    ],
  },
  {
    type: "employment_terms",
    headings: [
      "Remuneration and Benefits",
      "Probation and Leave",
      "Duties and Working Hours",
    ],
    paras: [
      "{B} shall be on probation for a period of 6 months from the date of joining.",
      "{B} shall be paid an annual cost to company of INR 18,00,000, subject to statutory deductions including provident fund.",
      "{B} shall be entitled to 21 days of paid leave in each calendar year in addition to public holidays.",
    ],
  },
];

export const PARTY_NAMES = [
  "Sabarmati Textiles Private Limited",
  "Brahmaputra Foods Limited",
  "Periyar Software Labs Private Limited",
  "Mahanadi Steel Works Limited",
  "Tapti Pharma Private Limited",
  "Chenab Logistics LLP",
  "Krishna Agro Exports Private Limited",
  "Sutlej Power Systems Limited",
  "Vaigai Design Studio LLP",
  "Hooghly Shipping Services Private Limited",
  "Betwa Education Services Private Limited",
  "Indravati Mining Equipment Limited",
];

export const PERSON_NAMES = [
  "Aarav Mehta",
  "Diya Nair",
  "Kabir Singh",
  "Sneha Iyer",
  "Farhan Qureshi",
  "Lakshmi Menon",
];

export const CITIES = [
  "Mumbai",
  "New Delhi",
  "Bengaluru",
  "Chennai",
  "Hyderabad",
  "Pune",
  "Kolkata",
  "Ahmedabad",
  "Kochi",
  "Jaipur",
];
