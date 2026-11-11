import type { ClauseOutline } from "@/lib/contracts/queries";
import type { ComplianceResult } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const VERDICT = {
  pass: { label: "Pass", className: "text-emerald-700 dark:text-emerald-400" },
  warn: { label: "Warn", className: "text-amber-700 dark:text-amber-400" },
  fail: { label: "Fail", className: "text-red-700 dark:text-red-400" },
} as const;

const PACK_NAMES: Record<string, string> = {
  DPDP: "DPDP Act 2023",
  ICA: "Indian Contract Act 1872",
  ARB: "Arbitration Act 1996",
  STAMP: "Stamp duty",
  GDPR: "GDPR Art. 28",
  CCPA: "CCPA / CPRA",
  INTERNAL: "Internal policies",
};

/** Every compliance rule checked, grouped by pack, with its verdict. */
export function ComplianceMatrix({
  results,
  clauses,
}: {
  results: ComplianceResult[];
  clauses: ClauseOutline[];
}) {
  if (results.length === 0) return null;

  const packs = [...new Set(results.map((result) => result.packCode))];
  const clauseLabel = (id: string | null) => {
    const clause = clauses.find((c) => c.id === id);
    return clause ? (clause.number ?? clause.heading ?? "") : "";
  };
  const count = (verdict: keyof typeof VERDICT) =>
    results.filter((result) => result.verdict === verdict).length;

  return (
    <section aria-label="Compliance" className="rounded-lg border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
        <h2 className="text-sm font-medium">Compliance</h2>
        <p className="text-muted-foreground text-xs">
          {count("fail")} fail · {count("warn")} warn · {count("pass")} pass. Only the
          rule packs that apply to this contract are listed.
        </p>
      </div>

      {packs.map((code) => {
        const rows = results.filter((result) => result.packCode === code);
        return (
          <div key={code} className="border-b last:border-b-0">
            <h3 className="bg-muted/40 px-5 py-2 text-xs font-medium">
              {PACK_NAMES[code] ?? code}{" "}
              <span className="text-muted-foreground font-normal">
                version {rows[0].packVersion}
              </span>
            </h3>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Verdict</th>
                  <th>Rule</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((result) => (
                  <tr key={result.id} className="border-t align-top first:border-t-0">
                    <td
                      className={cn(
                        "w-16 px-5 py-2.5 font-medium",
                        VERDICT[result.verdict].className,
                      )}
                    >
                      {VERDICT[result.verdict].label}
                    </td>
                    <td className="w-72 py-2.5 pr-4">
                      <div>{result.title}</div>
                      <div className="text-muted-foreground text-xs">
                        {result.reference}
                      </div>
                    </td>
                    <td className="py-2.5 pr-5">
                      {result.quotedText && (
                        <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs italic">
                          {clauseLabel(result.clauseId) && (
                            <span className="not-italic">
                              {clauseLabel(result.clauseId)}:{" "}
                            </span>
                          )}
                          {result.quotedText}
                        </blockquote>
                      )}
                      {result.verdict !== "pass" && (
                        <p className={cn(result.quotedText && "mt-1")}>
                          {result.explanation}
                          {result.fix && (
                            <span className="text-muted-foreground"> {result.fix}</span>
                          )}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
