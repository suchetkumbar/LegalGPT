import { DURATION_SOURCE, describeDays, durations, patternRule } from "../helpers";
import type { Rule } from "../types";

const PAY_WITHIN = new RegExp(
  `\\b(?:pay|paid|payable|payment|settle[ds]?)\\b[^.;]{0,140}?\\bwithin\\s+${DURATION_SOURCE}`,
  "i",
);
const paymentDays = (matched: string) => durations(matched).at(-1)?.days ?? null;

export const paymentRules: Rule[] = [
  patternRule({
    id: "payment.long-terms",
    title: "Long payment period",
    category: "payment",
    severity: 3,
    likelihood: 4,
    types: ["payment", "taxes"],
    pattern: PAY_WITHIN,
    check: (match) => {
      const days = paymentDays(match[0]);
      if (days === null || days <= 60) return false;
      return `Invoices are payable in ${describeDays(days)}.`;
    },
    explanation:
      "Payment is due long after the invoice, which strains the supplier's cash flow. If the supplier is a registered micro or small enterprise, section 15 of the MSMED Act, 2006 caps the period at 45 days regardless of what the contract says, with compound interest under section 16 on late payment.",
    suggestion: "Reduce the payment period to 30 to 45 days.",
    examples: {
      hit: ["The Client shall pay each undisputed invoice within 90 days of receipt."],
      miss: ["The Client shall pay each undisputed invoice within 30 days of receipt."],
    },
  }),
  patternRule({
    id: "payment.msme-45-days",
    title: "Payment period exceeds the MSME limit",
    category: "payment",
    severity: 2,
    likelihood: 3,
    types: ["payment", "taxes"],
    pattern: PAY_WITHIN,
    check: (match) => {
      const days = paymentDays(match[0]);
      if (days === null || days <= 45 || days > 60) return false;
      return `Invoices are payable in ${describeDays(days)}.`;
    },
    explanation:
      "If the supplier is a registered micro or small enterprise, section 15 of the MSMED Act, 2006 requires payment within 45 days whatever the contract says. A longer period exposes the buyer to compound interest at three times the bank rate under section 16.",
    suggestion:
      "Check the supplier's MSME status, and set the payment period at 45 days or less.",
    examples: {
      hit: ["The Buyer shall pay each invoice within 60 days of the date of invoice."],
      miss: ["The Buyer shall pay each invoice within 45 days of the date of invoice."],
    },
  }),
  patternRule({
    id: "payment.high-interest",
    title: "High interest on late payment",
    category: "payment",
    severity: 2,
    likelihood: 3,
    pattern:
      /\binterest\b[^.;]{0,120}?(\d{1,2}(?:\.\d+)?)\s*(?:%|per ?cent)\s*(per month|p\.m\.|a month|monthly)?/i,
    check: (match) => {
      const annual = Number(match[1]) * (match[2] ? 12 : 1);
      if (!(annual > 18)) return false;
      return `The rate works out to ${annual}% a year.`;
    },
    explanation:
      "The late-payment interest rate is well above commercial norms. A rate that is penal rather than compensatory can be cut down under section 74 of the Indian Contract Act.",
    suggestion: "Bring the rate down to 12 to 18% a year, simple interest.",
    examples: {
      hit: [
        "Overdue amounts shall carry interest at 24% per annum.",
        "Interest on late payments shall accrue at 2% per month.",
      ],
      miss: ["Overdue amounts shall carry interest at 12% per annum."],
    },
  }),
  patternRule({
    id: "payment.unilateral-price-change",
    title: "One party can change the price",
    category: "payment",
    severity: 4,
    likelihood: 3,
    pattern:
      /\b(?:may|shall be entitled to|reserves the right to|shall have the right to)\s+(?:revise|increase|vary|change|modify|amend|adjust)\b[^.;]{0,80}\b(?:fees|prices?|charges|rates?|tariffs?)\b/i,
    unless:
      /\b(?:mutual|agreed in writing|written (?:consent|agreement)|both parties)\b/i,
    explanation: "The price can be changed by one party without the other's agreement.",
    suggestion:
      "Require mutual written agreement for price changes, or cap increases at a stated index once a year.",
    examples: {
      hit: ["The Vendor may revise the fees at any time by giving 30 days notice."],
      miss: ["The fees may be revised only by mutual written agreement of the parties."],
    },
  }),
  patternRule({
    id: "payment.set-off",
    title: "Right of set-off",
    category: "payment",
    severity: 2,
    likelihood: 3,
    pattern: /\bset[- ]?off\b|\bdeduct\b[^.;]{0,80}\bany (?:amounts?|sums?)\b/i,
    unless:
      /\b(?:tax|TDS|at source|no (?:right of )?set[- ]?off|without (?:any )?set[- ]?off)\b/i,
    explanation:
      "One party may deduct what it says it is owed from what it must pay, turning any dispute into a withheld payment.",
    suggestion: "Limit set-off to amounts that are agreed or finally determined.",
    examples: {
      hit: ["The Client may set off any amount owed by the Supplier against the fees."],
      miss: ["The Client may deduct tax at source as required by law."],
    },
  }),
  patternRule({
    id: "payment.non-refundable",
    title: "Non-refundable payments",
    category: "payment",
    severity: 2,
    likelihood: 3,
    pattern: /\bnon-?refundable\b/i,
    explanation:
      "Money paid cannot be recovered, even if the services are never delivered.",
    suggestion: "Make advance payments refundable for services not delivered.",
    examples: {
      hit: ["All fees paid under this Agreement are non-refundable."],
      miss: ["Fees paid in advance shall be refunded pro rata on termination."],
    },
  }),
  patternRule({
    id: "payment.full-advance",
    title: "Full payment in advance",
    category: "payment",
    severity: 3,
    likelihood: 3,
    types: ["payment"],
    pattern:
      /(?:\b100\s*%|\bhundred per ?cent\b|\bfull\b|\bentire\b)[^.;]{0,60}\b(?:in advance|advance payment|up-?front)\b|\badvance\b[^.;]{0,60}(?:\b100\s*%|\bin full\b)/i,
    explanation:
      "The whole price is paid before anything is delivered, leaving the payer with no leverage if delivery slips.",
    suggestion: "Tie payments to milestones, with a retention until acceptance.",
    examples: {
      hit: ["The Client shall pay 100% of the fees in advance."],
      miss: [
        "The Client shall pay 30% of the fees on signing and the balance on acceptance.",
      ],
    },
  }),
  patternRule({
    id: "payment.withhold",
    title: "Right to withhold payment",
    category: "payment",
    severity: 2,
    likelihood: 3,
    pattern:
      /\b(?:may|entitled to|right to)\s+withhold\b[^.;]{0,80}\b(?:payment|fees|amounts?|invoice)\b/i,
    unless: /\b(?:tax|at source)\b/i,
    explanation: "Payment can be held back, often on the paying party's own assessment.",
    suggestion:
      "Limit withholding to the disputed part of an invoice, with the rest paid on time.",
    examples: {
      hit: ["The Client may withhold payment of any invoice it disputes."],
      miss: ["The Client shall pay the undisputed part of each invoice when due."],
    },
  }),
  patternRule({
    id: "payment.suspend-services",
    title: "Right to suspend services",
    category: "payment",
    severity: 3,
    likelihood: 3,
    pattern:
      /\b(?:may|entitled to|right to)\s+suspend\b[^.;]{0,80}\b(?:services|performance|access|supply|deliver)/i,
    explanation:
      "Services can be switched off, typically for late payment, with little warning.",
    suggestion: "Require written notice and a cure period before any suspension.",
    examples: {
      hit: ["The Vendor may suspend the services if any invoice is overdue."],
      miss: ["The Vendor shall continue to provide the services during any dispute."],
    },
  }),
  patternRule({
    id: "payment.uncapped-expenses",
    title: "Expenses reimbursed without a limit",
    category: "payment",
    severity: 2,
    likelihood: 3,
    pattern:
      /\b(?:reimburse|bear|pay)\b[^.;]{0,80}\ball\b[^.;]{0,50}\b(?:expenses|costs)\b/i,
    unless:
      /\b(?:pre-?approved|prior (?:written )?(?:approval|consent)|approved in advance|reasonable|its own)\b/i,
    explanation: "All expenses are passed on, with no approval step and no ceiling.",
    suggestion:
      "Require prior written approval and limit reimbursement to reasonable, documented expenses.",
    examples: {
      hit: [
        "The Client shall reimburse all travel and other expenses incurred by the Consultant.",
      ],
      miss: [
        "The Client shall reimburse reasonable expenses approved in advance in writing.",
      ],
    },
  }),
  patternRule({
    id: "payment.foreign-currency",
    title: "Payment in a foreign currency",
    category: "payment",
    severity: 1,
    likelihood: 3,
    types: ["payment", "taxes"],
    pattern:
      /\b(?:USD|US\$|U\.S\. dollars?|US dollars?|EUR|euros?|GBP|pounds sterling)\b/,
    explanation:
      "Amounts are in a foreign currency, so the rupee cost moves with the exchange rate, and cross-border payments must comply with the Foreign Exchange Management Act, 1999.",
    suggestion:
      "Fix the exchange rate or price in rupees, and confirm the FEMA route for the payment.",
    examples: {
      hit: ["The fees shall be USD 20,000 per month."],
      miss: ["The fees shall be INR 4,00,000 per month."],
    },
  }),
  patternRule({
    id: "payment.deemed-acceptance",
    title: "Deemed acceptance",
    category: "payment",
    severity: 2,
    likelihood: 3,
    types: ["payment", "scope_of_work"],
    pattern:
      /\b(?:deemed|treated as)\s+(?:to be\s+|to have been\s+)?(?:accepted|approved|undisputed)\b/i,
    explanation:
      "Silence counts as acceptance: if no objection is raised within the stated time, the invoice or deliverable is treated as accepted.",
    suggestion:
      "Lengthen the review period, and require active written acceptance for key deliverables.",
    examples: {
      hit: [
        "The deliverables shall be deemed accepted unless the Client objects within 5 days.",
      ],
      miss: ["The deliverables shall be accepted by written sign-off from the Client."],
    },
  }),
  patternRule({
    id: "payment.tax-gross-up",
    title: "Tax gross-up",
    category: "payment",
    severity: 3,
    likelihood: 2,
    pattern:
      /\bgross(?:ed)?[- ]up\b|\bfree and clear of\b[^.;]{0,60}\b(?:tax|deduction|withholding)|\bwithout (?:any )?deduction or withholding\b/i,
    explanation:
      "The payer must make up any tax it is required to withhold, so the cost of TDS under the Income-tax Act, 1961 falls on the payer rather than the recipient.",
    suggestion:
      "Delete the gross-up; allow deduction of tax at source against a TDS certificate.",
    examples: {
      hit: [
        "All payments shall be made free and clear of any deduction for tax, and shall be grossed up accordingly.",
      ],
      miss: ["The Client may deduct tax at source and shall furnish TDS certificates."],
    },
  }),
  {
    kind: "contract",
    id: "payment.gst-not-addressed",
    title: "GST treatment not stated",
    category: "payment",
    severity: 2,
    likelihood: 3,
    clauseType: "taxes",
    detect: (context) =>
      context.hasType("payment") &&
      !/\bGST\b|Goods and Services Tax|\btax(?:es)?\b|\bTDS\b/i.test(context.text),
    explanation:
      "The contract sets a price but does not say whether it includes GST. If it is silent, the price may be treated as inclusive, which costs the supplier the tax.",
    suggestion:
      "State that fees are exclusive of GST, payable against a valid tax invoice.",
  },
];
