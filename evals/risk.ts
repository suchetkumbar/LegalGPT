import { segmentContract } from "@/lib/pipeline/segment";
import { runRules, type RuleFinding } from "@/lib/rules";

import { STYLES, generateContract, type GoldContract } from "./generator/generate";

/**
 * Risk detection evaluation. Thirty generated contracts each get two or three
 * known high-severity risks planted in them, and the rule engine is scored on
 * whether it finds those and stays quiet otherwise.
 *
 * The planted clauses were written as a lawyer might phrase them, before
 * checking them against the detectors, and are worded differently from the
 * detectors' own examples. Some are deliberately loose paraphrases; a miss on
 * those is the point of measuring.
 *
 * Limits: the contracts and the risks are generated, not real, and one author
 * wrote both the risks and the rules. The plan's criterion (30 contracts
 * labelled by a lawyer) still needs real labelled contracts.
 */

export type PlantedRisk = {
  id: string;
  heading: string;
  text: string;
  /** The detector that should catch it. */
  expect: string;
};

export const PLANTED_RISKS: PlantedRisk[] = [
  {
    id: "uncapped-indemnity",
    heading: "Indemnity",
    text: "The Client agrees to indemnify and keep indemnified the Service Provider from every claim, demand and expense howsoever arising, and such indemnity shall be unlimited.",
    expect: "liability.uncapped-indemnity",
  },
  {
    id: "low-cap",
    heading: "Limitation of Liability",
    text: "In no case will the aggregate liability of the Service Provider be more than the charges received during the 2 months before the claim arose.",
    expect: "liability.low-cap",
  },
  {
    id: "unlimited-liability",
    heading: "Liability",
    text: "The Supplier's liability under this Agreement is without any cap.",
    expect: "liability.unlimited",
  },
  {
    id: "ip-with-supplier",
    heading: "Intellectual Property",
    text: "Title to all work product, reports and software produced under this Agreement will at all times remain the exclusive property of the Consultant.",
    expect: "ip.vests-in-supplier",
  },
  {
    id: "unilateral-termination",
    heading: "Termination",
    text: "The Vendor may terminate this Agreement at any time without cause upon written notice to the Client.",
    expect: "termination.unilateral-convenience",
  },
  {
    id: "no-exit",
    heading: "Termination",
    text: "The Customer shall not be entitled to terminate this Agreement before the expiry of the initial term.",
    expect: "termination.right-restricted",
  },
  {
    id: "pay-remaining-term",
    heading: "Termination",
    text: "If the Customer terminates early, the fees for the unexpired portion of the term shall become immediately due and payable.",
    expect: "termination.pay-for-remaining-term",
  },
  {
    id: "price-change",
    heading: "Fees",
    text: "The Supplier reserves the right to increase its charges on 15 days' notice.",
    expect: "payment.unilateral-price-change",
  },
  {
    id: "data-shared",
    heading: "Data Protection",
    text: "The Vendor may share the Client's customer information with third parties for marketing.",
    expect: "data.broad-use",
  },
  {
    id: "data-no-liability",
    heading: "Data Protection",
    text: "The Vendor accepts no liability for any security breach affecting the Client's records.",
    expect: "data.liability-excluded",
  },
  {
    id: "data-ownership",
    heading: "Data Protection",
    text: "All information collected through the service shall be the exclusive property of the Vendor.",
    expect: "data.ownership-to-supplier",
  },
  {
    id: "post-term-non-compete",
    heading: "Non-Compete",
    text: "The Consultant undertakes not to work for any competitor of the Client for three years following the end of this Agreement.",
    expect: "restrictions.post-termination-non-compete",
  },
  {
    id: "unilateral-amendment",
    heading: "General",
    text: "The Company may change these terms from time to time by posting a revised version.",
    expect: "restrictions.unilateral-amendment",
  },
  {
    id: "unilateral-arbitrator",
    heading: "Arbitration",
    text: "All disputes will be decided by a sole arbitrator nominated by the Managing Director of the Company. The seat of arbitration shall be Pune.",
    expect: "disputes.unilateral-arbitrator",
  },
  {
    id: "no-court",
    heading: "Dispute Resolution",
    text: "The Contractor gives up any right to approach a court in respect of this Agreement.",
    expect: "disputes.waiver-of-remedies",
  },
  {
    id: "convenience-exit-loose",
    heading: "Termination",
    text: "The Company may bring this Agreement to an end whenever it wishes, without giving reasons.",
    expect: "termination.unilateral-convenience",
  },
];

const CONTRACT_TYPE: Record<string, string> = {
  services: "master_services_agreement",
  consulting: "consulting_agreement",
  employment: "employment_agreement",
  nda: "nda",
};

export type RiskCase = {
  id: string;
  base: GoldContract;
  planted: PlantedRisk[];
  /** High-severity rule ids that are genuinely present, planted or not. */
  expected: Set<string>;
  findings: RuleFinding[];
};

const HIGH = 4;

/** Thirty contracts, each with two or three planted risks. Deterministic. */
export function buildRiskSet(): RiskCase[] {
  return Array.from({ length: 30 }, (_, i) => {
    const base = generateContract(5000 + i * 13, STYLES[i % 7]);
    const count = 2 + (i % 2);
    const planted = Array.from(
      { length: count },
      (_, k) => PLANTED_RISKS[(i * 3 + k * 5) % PLANTED_RISKS.length],
    )
      .filter((risk, index, all) => all.findIndex((r) => r.id === risk.id) === index)
      // A one-sided right to terminate at will is not a risk where the contract
      // already lets either party leave on notice, so it is not planted there.
      .filter(
        (risk) =>
          risk.expect !== "termination.unilateral-convenience" ||
          !base.clauses.some((clause) => clause.type === "termination"),
      );

    const segments = segmentContract(base.text);
    const clauses = [
      ...segments.map((s) => ({
        ordinal: s.ordinal,
        type: null,
        heading: s.heading,
        text: s.text,
      })),
      ...planted.map((risk, k) => ({
        ordinal: segments.length + k,
        type: null,
        heading: risk.heading,
        text: `${risk.heading}\n\n${risk.text}`,
      })),
    ];
    const text = [base.text, ...planted.map((risk) => risk.text)].join("\n\n");

    const expected = new Set(planted.map((risk) => risk.expect));
    const goldTypes = new Set(base.clauses.map((clause) => clause.type));
    // Risks the base contract carries by construction, known from its gold labels.
    if (goldTypes.has("non_compete"))
      expected.add("restrictions.post-termination-non-compete");
    const hasCap =
      goldTypes.has("limitation_of_liability") ||
      planted.some((risk) => /liability/i.test(risk.heading));
    if (!hasCap && ["services", "consulting"].includes(base.kind)) {
      expected.add("liability.no-cap");
    }

    return {
      id: `${base.id}+${planted.map((risk) => risk.id).join("+")}`,
      base,
      planted,
      expected,
      findings: runRules({ text, clauses, contractType: CONTRACT_TYPE[base.kind] }),
    };
  });
}

export type RiskScore = {
  contracts: number;
  planted: number;
  plantedFound: number;
  /** Share of planted high-severity risks the rules found. */
  recall: number;
  highFindings: number;
  highCorrect: number;
  /** Share of high-severity findings that are genuine. */
  precision: number;
  missed: { contract: string; risk: string }[];
  unexpected: { contract: string; ruleId: string; quote: string | null }[];
};

export function scoreRiskSet(cases: RiskCase[] = buildRiskSet()): RiskScore {
  const score: RiskScore = {
    contracts: cases.length,
    planted: 0,
    plantedFound: 0,
    recall: 0,
    highFindings: 0,
    highCorrect: 0,
    precision: 0,
    missed: [],
    unexpected: [],
  };

  for (const item of cases) {
    const found = new Set(item.findings.map((finding) => finding.ruleId));
    for (const risk of item.planted) {
      score.planted += 1;
      if (found.has(risk.expect)) score.plantedFound += 1;
      else score.missed.push({ contract: item.base.id, risk: risk.id });
    }
    for (const finding of item.findings.filter((f) => f.severity >= HIGH)) {
      score.highFindings += 1;
      if (item.expected.has(finding.ruleId)) score.highCorrect += 1;
      else {
        score.unexpected.push({
          contract: item.base.id,
          ruleId: finding.ruleId,
          quote: finding.quotedText,
        });
      }
    }
  }

  score.recall = score.planted ? score.plantedFound / score.planted : 0;
  score.precision = score.highFindings ? score.highCorrect / score.highFindings : 0;
  return score;
}

/** Exit gates from the project plan. */
export const RISK_GATES = { recall: 0.85, precision: 0.75 };
