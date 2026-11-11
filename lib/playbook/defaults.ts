import type { ClauseType } from "@/lib/pipeline/clause-types";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/score";

export type PlaybookPosition = {
  clauseType: ClauseType;
  /** The wording the organisation wants. Deviations are measured against this. */
  standardText: string;
  /** What it will accept if the standard is refused. */
  fallbackText: string;
  /** The point past which it should not sign. */
  walkaway: string;
  riskWeight: number;
};

const position = (
  clauseType: ClauseType,
  standardText: string,
  fallbackText: string,
  walkaway: string,
): PlaybookPosition => ({
  clauseType,
  standardText,
  fallbackText,
  walkaway,
  riskWeight: DEFAULT_WEIGHTS[clauseType] ?? 1,
});

/**
 * The starting playbook every organisation gets: balanced, mutual positions
 * for 20 clause types under Indian law. It is a starting point to edit, not
 * advice; an organisation that is always the customer, or always the
 * supplier, will want to tilt it.
 */
export const DEFAULT_POSITIONS: PlaybookPosition[] = [
  position(
    "limitation_of_liability",
    "Each party's total liability is capped at the fees paid or payable in the 12 months before the claim. Neither party is liable for indirect or consequential loss. The cap does not apply to fraud, breach of confidentiality, or data protection breaches.",
    "A cap of 100% of the annual fees applying to both parties, with a higher cap (200%) for data protection breaches.",
    "Unlimited liability for us, a cap that applies to only one party, or a cap below six months of fees.",
  ),
  position(
    "indemnity",
    "Each party indemnifies the other against third-party claims arising from its breach of law, infringement of intellectual property, or breach of confidentiality. Indemnities are subject to the liability cap, prompt notice, and control of the defence by the indemnifying party.",
    "A one-way indemnity limited to third-party intellectual property claims, subject to the cap.",
    "An uncapped indemnity, or an indemnity for the other party's own negligence.",
  ),
  position(
    "intellectual_property",
    "The customer owns all intellectual property in the deliverables on creation, assigned worldwide and for the full term of the rights. The supplier keeps its pre-existing materials and licenses them to the customer perpetually for use with the deliverables.",
    "The supplier keeps ownership but grants a perpetual, irrevocable, transferable, royalty-free licence covering the customer and its affiliates.",
    "A revocable or non-transferable licence only, or an assignment that is silent on term and territory.",
  ),
  position(
    "data_protection",
    "Personal data is processed only on documented instructions and in compliance with the Digital Personal Data Protection Act, 2023, with reasonable security safeguards, breach notification within 72 hours, no sub-processors or transfers outside India without prior written consent, and erasure on termination.",
    "Breach notification without undue delay; sub-processors on prior notice with a right to object.",
    "Use of personal data for the recipient's own purposes, no breach notification, or an exclusion of liability for data breaches.",
  ),
  position(
    "termination",
    "Either party may terminate for convenience on 60 days' written notice, and immediately for a material breach not remedied within 30 days or on insolvency. On termination, fees are payable only for work done to that date.",
    "Termination for convenience on 90 days' notice after an initial 12 months.",
    "A right to terminate for convenience held by one party only, a cure period over 45 days, or fees payable for the unexpired term.",
  ),
  position(
    "payment",
    "Undisputed invoices are paid within 30 days of receipt. Fees are exclusive of GST. Late payments carry simple interest at 12% a year. Price changes need written agreement.",
    "Payment within 45 days; interest up to 18% a year.",
    "Payment terms over 60 days, unilateral price changes, or full payment in advance.",
  ),
  position(
    "term_and_renewal",
    "A fixed initial term of up to 3 years. Renewal only by written agreement, or automatic renewal for 12 months at a time with a right to stop it on 30 days' notice.",
    "Automatic renewal with a non-renewal notice of up to 60 days.",
    "Automatic renewal with a notice period over 90 days, or an initial term over 5 years with no exit.",
  ),
  position(
    "non_compete",
    "No non-compete after the contract ends. During the term, the supplier does not provide the same deliverables to a named competitor.",
    "A narrowly defined non-compete limited to the term of the contract.",
    "Any post-termination non-compete (void under section 27 of the Indian Contract Act, 1872), or exclusivity binding us without a minimum commitment.",
  ),
  position(
    "confidentiality",
    "Mutual obligations to keep the other party's confidential information secret and use it only for the contract, surviving for 3 years after termination, with the usual exceptions for public information and disclosures required by law.",
    "Survival for up to 5 years; trade secrets protected for as long as they remain secret.",
    "One-way confidentiality in the other party's favour, or a residuals clause covering our information.",
  ),
  position(
    "warranties_and_representations",
    "Each party warrants it has authority to enter the contract. The supplier warrants the services will be performed with reasonable skill and care and that deliverables will conform to the specification for 90 days after acceptance.",
    "A 30-day warranty period with re-performance as the first remedy.",
    "Services or deliverables provided 'as is' with all warranties disclaimed.",
  ),
  position(
    "governing_law_and_jurisdiction",
    "The contract is governed by the laws of India. Subject to the arbitration clause, the courts at the customer's principal place of business have exclusive jurisdiction.",
    "Indian law with the courts of another Indian city agreed by both parties.",
    "A foreign governing law, or foreign courts.",
  ),
  position(
    "dispute_resolution",
    "Disputes go first to senior management for 30 days, then to arbitration by a sole arbitrator appointed by agreement, or failing that by an arbitral institution, under the Arbitration and Conciliation Act, 1996. The seat is in India and the language is English.",
    "A three-member tribunal, with each party appointing one arbitrator.",
    "A sole arbitrator appointed by the other party alone, or a seat outside India.",
  ),
  position(
    "taxes",
    "Fees are exclusive of GST, charged at the applicable rate against a valid tax invoice. The payer may deduct tax at source and provides the TDS certificate within the statutory period. Each party bears its own income tax.",
    "GST-inclusive pricing where stated expressly.",
    "A gross-up for tax deducted at source.",
  ),
  position(
    "non_solicitation",
    "For the term and 12 months after, neither party solicits the employees of the other who worked on the contract. General advertising is not solicitation.",
    "A one-way restriction for 12 months limited to named key staff.",
    "A restriction over 24 months, or one that bars hiring in response to general advertising.",
  ),
  position(
    "assignment_and_subcontracting",
    "Neither party assigns the contract without the other's prior written consent, not to be unreasonably withheld. The supplier uses subcontractors only with consent and stays responsible for them.",
    "Assignment to an affiliate or a successor to the business on notice.",
    "Free assignment by the other party only.",
  ),
  position(
    "force_majeure",
    "Neither party is liable for failure caused by events beyond its reasonable control, provided it gives prompt notice and mitigates. Either party may terminate if the event lasts more than 60 days. Payment obligations are not excused.",
    "Termination after 90 days.",
    "Force majeure relief for one party only, or relief with no right to terminate.",
  ),
  position(
    "insurance",
    "The supplier maintains professional indemnity and public liability insurance adequate for its obligations, and provides certificates on request.",
    "Insurance with a stated minimum cover agreed in the statement of work.",
    "No insurance where the supplier's liability exceeds its evident means.",
  ),
  position(
    "audit_and_records",
    "The supplier keeps accurate records for 8 years. The customer may audit them once a year on 15 days' notice, during business hours.",
    "Audit by an independent auditor bound by confidentiality.",
    "No audit right where fees are based on time, usage or pass-through costs.",
  ),
  position(
    "notices",
    "Notices are in writing, sent by registered post or email to the addresses in the contract, and are deemed received on the next business day if sent by email.",
    "Email notice valid only with a confirmation copy by post.",
    "Notice by a method we cannot reliably monitor.",
  ),
  position(
    "general_provisions",
    "The contract is the entire agreement. Amendments are in writing and signed by both parties. An unenforceable provision does not affect the rest. No waiver unless in writing.",
    "Amendment by exchange of emails between authorised representatives.",
    "A right for the other party to change the terms by itself.",
  ),
];
