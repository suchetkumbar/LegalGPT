"use client";

import { useMemo, useState } from "react";

import type { ClauseOutline } from "@/lib/contracts/queries";
import { clauseTypeLabel } from "@/lib/pipeline/clause-types";
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

function label(clause: ClauseOutline): string {
  if (clause.number && clause.heading) return `${clause.number}  ${clause.heading}`;
  return clause.number ?? clause.heading ?? `Clause ${clause.ordinal + 1}`;
}

/** The document on the left, the clause outline on the right. */
export function ContractViewer({
  text,
  clauses,
}: {
  text: string;
  clauses: ClauseOutline[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const blocks = useMemo(() => toBlocks(text, clauses), [text, clauses]);

  function show(id: string) {
    setActiveId(id);
    document
      .getElementById(`clause-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article
        aria-label="Contract text"
        className="bg-card max-h-[75vh] overflow-y-auto rounded-lg border px-6 py-5 text-sm leading-relaxed"
      >
        {blocks.map((block) =>
          block.clause ? (
            <section
              key={block.key}
              id={`clause-${block.clause.id}`}
              onClick={() => setActiveId(block.clause!.id)}
              className={cn(
                "-mx-3 scroll-mt-4 rounded-md border-l-2 border-transparent px-3 py-1 whitespace-pre-wrap transition-colors",
                activeId === block.clause.id && "border-primary bg-muted",
              )}
            >
              {block.text}
            </section>
          ) : (
            <div key={block.key} className="whitespace-pre-wrap">
              {block.text}
            </div>
          ),
        )}
      </article>

      <nav
        aria-label="Clauses"
        className="max-h-[75vh] overflow-y-auto rounded-lg border"
      >
        <h2 className="bg-background sticky top-0 border-b px-4 py-3 text-sm font-medium">
          Clauses <span className="text-muted-foreground">({clauses.length})</span>
        </h2>
        <ol className="p-2">
          {clauses.map((clause) => (
            <li key={clause.id}>
              <button
                type="button"
                onClick={() => show(clause.id)}
                aria-current={activeId === clause.id ? "true" : undefined}
                className={cn(
                  "hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm whitespace-pre-wrap",
                  // Sub-clauses sit under their heading.
                  clause.number?.includes(".") && "pl-5",
                  activeId === clause.id && "bg-muted font-medium",
                )}
              >
                {label(clause)}
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
    </div>
  );
}
