import { sql } from "drizzle-orm";

import type { OrgTx } from "@/lib/db/tenant";

/**
 * Hybrid retrieval: Postgres full-text search and pgvector similarity, merged
 * with reciprocal rank fusion. Full text finds exact terms ("arbitration",
 * "Schedule B"); vectors find the same idea in other words. Row-level
 * security limits both to the caller's organisation.
 */

export type Source = {
  clauseId: string;
  contractId: string;
  contractTitle: string;
  label: string;
  text: string;
  score: number;
};

type Hit = {
  clause_id: string;
  contract_id: string;
  title: string;
  number: string | null;
  heading: string | null;
  text: string;
};

/** The k in 1 / (k + rank); 60 is the usual choice and is not sensitive. */
const RRF_K = 60;
const CANDIDATES = 20;

export function fuseRankings<T extends { clause_id: string }>(
  lists: T[][],
  limit: number,
) {
  const scores = new Map<string, { row: T; score: number }>();
  for (const list of lists) {
    list.forEach((row, rank) => {
      const entry = scores.get(row.clause_id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      scores.set(row.clause_id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function retrieve(
  tx: OrgTx,
  input: {
    question: string;
    contractId: string | null;
    embedding: number[] | null;
    limit?: number;
  },
): Promise<Source[]> {
  const scope = input.contractId ? sql`and c.contract_id = ${input.contractId}` : sql``;
  const base = sql`
    select c.id as clause_id, c.contract_id, k.title, c.number, c.heading, c.text
    from clauses c join contracts k on k.id = c.contract_id
    where true ${scope}`;

  const fullText = await tx.execute<Hit>(sql`
    ${base}
      and to_tsvector('english', c.text) @@ websearch_to_tsquery('english', ${input.question})
    order by ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', ${input.question})) desc
    limit ${CANDIDATES}`);

  const vector = input.embedding
    ? await tx.execute<Hit>(sql`
        ${base} and c.embedding is not null
        order by c.embedding <=> ${JSON.stringify(input.embedding)}::vector
        limit ${CANDIDATES}`)
    : { rows: [] as Hit[] };

  const rowsOf = (result: unknown) =>
    ((result as { rows?: Hit[] }).rows ?? (result as Hit[])) as Hit[];

  return fuseRankings([rowsOf(fullText), rowsOf(vector)], input.limit ?? 8).map(
    ({ row, score }) => ({
      clauseId: row.clause_id,
      contractId: row.contract_id,
      contractTitle: row.title,
      label: [row.number, row.heading].filter(Boolean).join(" ") || "Clause",
      text: row.text,
      score,
    }),
  );
}
