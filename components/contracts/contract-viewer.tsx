"use client";

import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ClauseOutline, FindingSummary } from "@/lib/contracts/queries";
import type { FindingStatus } from "@/lib/db/schema";
import { clauseTypeLabel } from "@/lib/pipeline/clause-types";
import { CATEGORY_LABELS, type RiskCategory } from "@/lib/rules/types";
import { cn } from "@/lib/utils";

type Block = { key: string; text: string; clause: ClauseOutline | null };

/** Cuts the document into clause blocks plus whatever text lies between them. */
function toBlocks(text: string, clauses: ClauseOutline[]): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  for (const clause of clauses) {
    if (clause.startOffset > cursor) {
      blocks.push({
        key: `gap-${cursor}`,
        text: text.slice(cursor, clause.startOffset),
        clause: null,
      });
    }
    blocks.push({
      key: clause.id,
      text: text.slice(clause.startOffset, clause.endOffset),
      clause,
    });
    cursor = clause.endOffset;
  }
  if (cursor < text.length) {
    blocks.push({ key: `gap-${cursor}`, text: text.slice(cursor), clause: null });
  }
  return blocks;
}

function clauseLabel(clause: ClauseOutline): string {
  if (clause.number && clause.heading) return `${clause.number}  ${clause.heading}`;
  return clause.number ?? clause.heading ?? `Clause ${clause.ordinal + 1}`;
}

const SEVERITY: Record<number, { label: string; className: string }> = {
  5: { label: "Critical", className: "bg-red-600 text-white" },
  4: { label: "High", className: "bg-orange-600 text-white" },
  3: {
    label: "Medium",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
  2: { label: "Low", className: "bg-muted text-foreground" },
  1: { label: "Note", className: "bg-muted text-muted-foreground" },
};

type SeverityFilter = "all" | "high" | "medium" | "low";

const FILTERS: {
  id: SeverityFilter;
  label: string;
  test: (severity: number) => boolean;
}[] = [
  { id: "all", label: "All", test: () => true },
  { id: "high", label: "High and critical", test: (s) => s >= 4 },
  { id: "medium", label: "Medium", test: (s) => s === 3 },
  { id: "low", label: "Low", test: (s) => s <= 2 },
];

/** The clause text, with the quoted words of the selected finding marked. */
function ClauseText({ text, quote }: { text: string; quote: string | null }) {
  const at = quote ? text.indexOf(quote) : -1;
  if (!quote || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {quote}
      </mark>
      {text.slice(at + quote.length)}
    </>
  );
}

/**
 * The document on the left; on the right, the findings and the clause
 * outline. Selecting a finding scrolls to its clause and marks the quote.
 */
export function ContractViewer({
  text,
  clauses,
  findings,
  canReview,
}: {
  text: string;
  clauses: ClauseOutline[];
  findings: FindingSummary[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"findings" | "clauses">(
    findings.length > 0 ? "findings" : "clauses",
  );
  const [activeClause, setActiveClause] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocks = useMemo(() => toBlocks(text, clauses), [text, clauses]);
  const clauseById = useMemo(
    () => new Map(clauses.map((clause) => [clause.id, clause])),
    [clauses],
  );
  const quote =
    findings.find((finding) => finding.id === activeFinding)?.quotedText ?? null;

  const test = FILTERS.find((option) => option.id === filter)!.test;
  const visible = findings.filter(
    (finding) =>
      test(finding.severity) && (showDismissed || finding.status !== "dismissed"),
  );
  const dismissedCount = findings.filter(
    (finding) => finding.status === "dismissed",
  ).length;

  function showClause(id: string) {
    setActiveClause(id);
    document
      .getElementById(`clause-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showFinding(finding: FindingSummary) {
    setActiveFinding(finding.id);
    if (finding.clauseId) showClause(finding.clauseId);
  }

  async function review(finding: FindingSummary, status: FindingStatus) {
    setPending(finding.id);
    setError(null);
    try {
      const response = await fetch(`/api/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save that. Try again.");
        return;
      }
      // The score and the list both come from the server.
      router.refresh();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <article
        aria-label="Contract text"
        className="bg-card max-h-[80vh] overflow-y-auto rounded-lg border px-6 py-5 text-sm leading-relaxed"
      >
        {blocks.map((block) =>
          block.clause ? (
            <section
              key={block.key}
              id={`clause-${block.clause.id}`}
              onClick={() => setActiveClause(block.clause!.id)}
              className={cn(
                "-mx-3 scroll-mt-4 rounded-md border-l-2 border-transparent px-3 py-1 whitespace-pre-wrap transition-colors",
                activeClause === block.clause.id && "border-primary bg-muted",
              )}
            >
              <ClauseText
                text={block.text}
                quote={activeClause === block.clause.id ? quote : null}
              />
            </section>
          ) : (
            <div key={block.key} className="whitespace-pre-wrap">
              {block.text}
            </div>
          ),
        )}
      </article>

      <div className="flex max-h-[80vh] flex-col overflow-hidden rounded-lg border">
        <div role="tablist" aria-label="Contract panels" className="flex border-b">
          {(
            [
              ["findings", `Findings (${findings.length - dismissedCount})`],
              ["clauses", `Clauses (${clauses.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 border-b-2 border-transparent px-4 py-3 text-sm font-medium",
                tab === id
                  ? "border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "findings" ? (
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    filter === option.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
              {dismissedCount > 0 && (
                <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={showDismissed}
                    onChange={(event) => setShowDismissed(event.target.checked)}
                  />
                  Show dismissed ({dismissedCount})
                </label>
              )}
            </div>

            {error && (
              <p role="alert" className="text-destructive border-b px-4 py-2 text-sm">
                {error}
              </p>
            )}

            <ol className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 && (
                <li className="text-muted-foreground px-4 py-10 text-center text-sm">
                  {findings.length === 0
                    ? "No known risk patterns were found in this contract."
                    : "No findings match this filter."}
                </li>
              )}
              {visible.map((finding) => {
                const clause = finding.clauseId ? clauseById.get(finding.clauseId) : null;
                const severity = SEVERITY[finding.severity] ?? SEVERITY[3];
                const busy = pending === finding.id;
                return (
                  <li
                    key={finding.id}
                    className={cn(
                      "border-b px-4 py-3 text-sm last:border-b-0",
                      activeFinding === finding.id && "bg-muted/60",
                      finding.status === "dismissed" && "opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          severity.className,
                        )}
                      >
                        {severity.label}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {CATEGORY_LABELS[finding.category as RiskCategory] ??
                          finding.category}
                        {clause ? ` · ${clauseLabel(clause)}` : ""}
                      </span>
                      {finding.status !== "open" && (
                        <span className="text-muted-foreground ml-auto text-xs capitalize">
                          {finding.status}
                        </span>
                      )}
                    </div>

                    <h3 className="mt-1.5 font-medium">{finding.title}</h3>
                    {(finding.kind === "deviation" || finding.usedFallback) && (
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {finding.kind === "deviation" && "Deviation from your playbook"}
                        {finding.kind === "deviation" && finding.usedFallback && " · "}
                        {finding.usedFallback && "Judged by a fallback model"}
                      </p>
                    )}

                    {finding.quotedText ? (
                      <blockquote className="text-muted-foreground mt-1.5 border-l-2 pl-3 text-xs italic">
                        {finding.quotedText}
                      </blockquote>
                    ) : (
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        Nothing to quote: this is about what the contract leaves out.
                      </p>
                    )}

                    <p className="mt-2">{finding.reasoning}</p>
                    {finding.suggestedFix && (
                      <p className="mt-1.5">
                        <span className="font-medium">Suggested: </span>
                        {finding.suggestedFix}
                      </p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {finding.clauseId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => showFinding(finding)}
                        >
                          Show in document
                        </Button>
                      )}
                      {canReview &&
                        (finding.status === "open" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => review(finding, "accepted")}
                            >
                              {busy ? (
                                <Loader2 className="animate-spin" aria-hidden />
                              ) : (
                                <Check aria-hidden />
                              )}
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => review(finding, "dismissed")}
                            >
                              <X aria-hidden />
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => review(finding, "open")}
                          >
                            <RotateCcw aria-hidden />
                            Reopen
                          </Button>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <nav
            role="tabpanel"
            aria-label="Clauses"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <ol className="p-2">
              {clauses.map((clause) => (
                <li key={clause.id}>
                  <button
                    type="button"
                    onClick={() => showClause(clause.id)}
                    aria-current={activeClause === clause.id ? "true" : undefined}
                    className={cn(
                      "hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm whitespace-pre-wrap",
                      // Sub-clauses sit under their heading.
                      clause.number?.includes(".") && "pl-5",
                      activeClause === clause.id && "bg-muted font-medium",
                    )}
                  >
                    {clauseLabel(clause)}
                    {clause.type && clause.type !== "other" && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {clauseTypeLabel(clause.type)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
    </div>
  );
}
