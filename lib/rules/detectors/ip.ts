import { patternRule } from "../helpers";
import type { Rule } from "../types";

const SUPPLIER =
  "(?:Service Provider|Consultant|Vendor|Supplier|Contractor|Licensor|Developer|Agency|Provider)";
const PRE_EXISTING =
  /\b(?:pre-?existing|background|prior to|independently developed|its own)\b/i;

export const ipRules: Rule[] = [
  patternRule({
    id: "ip.vests-in-supplier",
    title: "Intellectual property stays with the supplier",
    category: "ip",
    severity: 4,
    likelihood: 3,
    types: ["intellectual_property", "scope_of_work"],
    pattern: new RegExp(
      `\\b(?:vest in|belong to|be owned by|remains? (?:the )?(?:sole |exclusive )?property of|be the (?:sole|exclusive) property of)\\s+(?:the\\s+)?${SUPPLIER}\\b`,
      "i",
    ),
    unless: PRE_EXISTING,
    explanation:
      "The rights in what is being built for the customer stay with the supplier. The customer pays for the work but does not own it, and cannot freely modify it or move to another supplier.",
    suggestion:
      "Have the rights in the deliverables assigned to the customer on payment, with the supplier keeping only its pre-existing materials.",
    examples: {
      hit: [
        "All intellectual property rights in the deliverables shall vest in the Service Provider.",
      ],
      miss: [
        "All intellectual property rights in the deliverables shall vest in the Client.",
        "The Service Provider's pre-existing materials shall remain the property of the Service Provider.",
      ],
    },
  }),
  patternRule({
    id: "ip.licence-only",
    title: "Customer receives only a limited licence",
    category: "ip",
    severity: 3,
    likelihood: 3,
    types: ["intellectual_property"],
    pattern:
      /\b(?:non-exclusive|revocable|limited)\b[^.;]{0,80}\blicen[cs]e\b[^.;]{0,100}\bdeliverables?\b|\bdeliverables?\b[^.;]{0,140}\b(?:non-exclusive|revocable)\b[^.;]{0,40}\blicen[cs]e\b/i,
    unless: PRE_EXISTING,
    explanation:
      "The customer gets a narrow licence to use the deliverables rather than ownership. Limits such as non-transferable or internal-use-only can block a group restructuring or a sale of the business.",
    suggestion:
      "Seek an assignment, or at least a perpetual, irrevocable, transferable licence covering affiliates.",
    examples: {
      hit: [
        "The Client is granted a non-exclusive, non-transferable licence to use the deliverables for its internal business purposes.",
      ],
      miss: ["The Client shall own all rights in the deliverables."],
    },
  }),
  patternRule({
    id: "ip.assignment-conditional-on-payment",
    title: "Transfer of rights depends on full payment",
    category: "ip",
    severity: 2,
    likelihood: 2,
    types: ["intellectual_property"],
    pattern:
      /\b(?:vest|assign(?:ed|s)?|transfer(?:red|s)?)\b[^.;]{0,140}\b(?:upon|subject to|only (?:up)?on|conditional (?:up)?on)\s+(?:receipt of\s+)?(?:full\s+)?payment\b/i,
    explanation:
      "Ownership passes only once every invoice is paid. A payment dispute would leave the rights with the supplier in the meantime.",
    suggestion:
      "Have rights pass on creation or delivery, with payment enforced as a debt.",
    examples: {
      hit: [
        "All rights in the deliverables shall vest in the Client upon payment of the fees in full.",
      ],
      miss: ["All rights in the deliverables shall vest in the Client on creation."],
    },
  }),
  {
    kind: "clause",
    id: "ip.assignment-no-term-or-territory",
    title: "Assignment does not state its duration or territory",
    category: "ip",
    severity: 3,
    likelihood: 3,
    types: ["intellectual_property"],
    detect(clause) {
      const match =
        /\b(?:hereby )?assigns?\b|\bshall (?:be assigned|stand assigned)\b|\bassignment of\b/i.exec(
          clause.text,
        );
      if (!match) return null;
      if (
        /\b(?:worldwide|throughout the world|territor|perpetual|perpetuity|entire term|full term|term of (?:the )?copyright)\b/i.test(
          clause.text,
        )
      ) {
        return null;
      }
      const end = clause.text.indexOf(".", match.index);
      const start = clause.text.lastIndexOf(". ", match.index);
      return {
        quote: clause.text
          .slice(start < 0 ? 0 : start + 2, end < 0 ? clause.text.length : end + 1)
          .trim(),
      };
    },
    explanation:
      "Copyright is assigned without saying for how long or where. Under section 19(5) and (6) of the Copyright Act, 1957, an assignment that is silent on these is treated as lasting five years and covering India only.",
    suggestion:
      "State that the assignment is worldwide and for the full term of the rights, including renewals.",
    examples: {
      hit: [
        "The Employee hereby assigns all rights in such work product to the Company.",
      ],
      miss: [
        "The Employee hereby assigns to the Company all rights in the work product, worldwide and in perpetuity.",
      ],
    },
  },
  patternRule({
    id: "ip.broad-employee-assignment",
    title: "Assignment reaches work done outside the job",
    category: "ip",
    severity: 3,
    likelihood: 3,
    types: ["intellectual_property"],
    pattern:
      /\b(?:whether or not|regardless of whether|irrespective of whether)\b[^.;]{0,100}\b(?:working hours|course of (?:his|her|their|the) employment|using (?:the )?company|related to)\b/i,
    explanation:
      "The assignment covers anything the individual creates, including work unrelated to the role or done in their own time.",
    suggestion:
      "Limit the assignment to work created in the course of the engagement or using the company's resources.",
    examples: {
      hit: [
        "All inventions made by the Employee, whether or not during working hours, shall belong to the Company.",
      ],
      miss: [
        "All inventions made by the Employee in the course of employment shall belong to the Company.",
      ],
    },
  }),
  patternRule({
    id: "ip.perpetual-licence-granted",
    title: "Perpetual or irrevocable licence granted",
    category: "ip",
    severity: 2,
    likelihood: 2,
    pattern:
      /\b(?:perpetual|irrevocable)\b[^.;]{0,100}\blicen[cs]e\b|\blicen[cs]e\b[^.;]{0,60}\b(?:in perpetuity|irrevocabl[ye])\b/i,
    explanation:
      "A licence that cannot end or be withdrawn is being granted. Whoever grants it cannot stop the use even after the relationship ends or the terms are breached.",
    suggestion:
      "Confirm who grants the licence and over what, and whether it should survive termination for breach.",
    examples: {
      hit: [
        "The Client grants the Vendor a perpetual, irrevocable licence to use the Client's feedback.",
      ],
      miss: ["The Client grants the Vendor a licence to use its logo during the term."],
    },
  }),
  patternRule({
    id: "ip.moral-rights-waiver",
    title: "Waiver of moral rights",
    category: "ip",
    severity: 2,
    likelihood: 2,
    pattern:
      /\bwaive[sd]?\b[^.;]{0,80}\bmoral rights\b|\bmoral rights\b[^.;]{0,80}\bwaive/i,
    explanation:
      "The author is asked to waive moral rights. The author's special rights under section 57 of the Copyright Act, 1957 exist independently of the copyright, and Indian courts have been reluctant to treat them as fully waivable.",
    suggestion:
      "Treat the waiver as uncertain; add an undertaking not to assert the rights as a fallback.",
    examples: {
      hit: ["The Consultant waives all moral rights in the deliverables."],
      miss: ["The Consultant shall be credited as the author of the deliverables."],
    },
  }),
  patternRule({
    id: "ip.residuals",
    title: "Residual knowledge carve-out",
    category: "ip",
    severity: 2,
    likelihood: 2,
    pattern: /\bresidual(?:s| knowledge| information)\b/i,
    explanation:
      "A residuals clause lets a party freely use whatever its staff remember of the other's confidential information, which can hollow out the confidentiality obligations.",
    suggestion:
      "Delete the carve-out, or exclude source code, trade secrets and personal data from it.",
    examples: {
      hit: [
        "Nothing restricts the Vendor from using residual knowledge retained in the unaided memory of its staff.",
      ],
      miss: ["The Vendor shall return all confidential information on termination."],
    },
  }),
  {
    kind: "contract",
    id: "ip.no-clause",
    title: "No intellectual property clause",
    category: "ip",
    severity: 3,
    likelihood: 3,
    clauseType: "intellectual_property",
    detect: (context) =>
      !context.hasType("intellectual_property") &&
      !/\bintellectual property\b|\bcopyright\b/i.test(context.text) &&
      [
        "master_services_agreement",
        "statement_of_work",
        "consulting_agreement",
        "employment_agreement",
        "saas_subscription",
      ].includes(context.contractType ?? ""),
    explanation:
      "Work is being created under this contract, but nothing says who owns it. Without a written assignment the creator generally keeps the copyright, except for an employee's work under section 17 of the Copyright Act.",
    suggestion:
      "Add a clause stating who owns the deliverables and any pre-existing materials.",
  },
];
