import type { FindingSummary } from "@/lib/contracts/queries";
import { CATEGORY_LABELS, RISK_CATEGORIES } from "@/lib/rules/types";
import { computeRiskScore, type RiskBand } from "@/lib/scoring/score";
import { cn } from "@/lib/utils";

const BAND_LABEL: Record<RiskBand, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
  critical: "Critical risk",
};

/** Colour is never the only signal: the band is always written out as well. */
const BAND_TEXT: Record<RiskBand, string> = {
  low: "text-emerald-700 dark:text-emerald-400",
  medium: "text-amber-700 dark:text-amber-400",
  high: "text-orange-700 dark:text-orange-400",
  critical: "text-red-700 dark:text-red-400",
};

const BAND_FILL: Record<RiskBand, string> = {
  low: "bg-emerald-600",
  medium: "bg-amber-500",
  high: "bg-orange-600",
  critical: "bg-red-600",
};

function bandOf(score: number): RiskBand {
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

/** The contract's risk score and where it comes from. */
export function RiskSummary({
  findings,
  weights,
}: {
  findings: FindingSummary[];
  /** Clause-type weights from the organisation's playbook. */
  weights?: Partial<Record<string, number>>;
}) {
  const result = computeRiskScore(findings, weights);
  const open = findings.filter((finding) => finding.status === "open").length;
  const dismissed = findings.filter((finding) => finding.status === "dismissed").length;

  return (
    <section
      aria-label="Risk score"
      className="grid gap-6 rounded-lg border px-5 py-4 md:grid-cols-[14rem_1fr]"
    >
      <div>
        <h2 className="text-sm font-medium">Risk score</h2>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tabular-nums">{result.score}</span>
          <span className="text-muted-foreground text-sm">/ 100</span>
        </p>
        <p className={cn("mt-1 text-sm font-medium", BAND_TEXT[result.band])}>
          {BAND_LABEL[result.band]}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          {result.counted} finding{result.counted === 1 ? "" : "s"} counted
          {open > 0 ? `, ${open} awaiting review` : ""}
          {dismissed > 0 ? `; ${dismissed} dismissed` : ""}.
          {result.floorApplied &&
            " A critical finding sets the score to at least 70, whatever else the contract says."}
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {RISK_CATEGORIES.map((category) => {
          const value = result.byCategory[category];
          return (
            <div
              key={category}
              className="grid grid-cols-[9.5rem_1fr_2rem] items-center gap-3"
            >
              <dt className="text-muted-foreground text-sm">
                {CATEGORY_LABELS[category]}
              </dt>
              <dd className="contents">
                <span className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                  <span
                    className={cn("block h-full rounded-full", BAND_FILL[bandOf(value)])}
                    style={{ width: `${value}%` }}
                  />
                </span>
                <span className="text-right text-sm tabular-nums">{value}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** A compact score for tables. */
export function RiskScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">–</span>;
  const band = bandOf(score);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className={cn("text-xs", BAND_TEXT[band])}>
        {BAND_LABEL[band].replace(" risk", "")}
      </span>
      <span className="font-medium tabular-nums">{score}</span>
    </span>
  );
}
