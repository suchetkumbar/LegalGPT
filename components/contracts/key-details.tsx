import type { EntitySummary } from "@/lib/contracts/queries";
import { clauseTypeLabel } from "@/lib/pipeline/clause-types";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatAmount(normalized: unknown): string | null {
  const { amount, currency } = (normalized ?? {}) as {
    amount?: unknown;
    currency?: unknown;
  };
  if (typeof amount !== "number" || typeof currency !== "string") return null;
  try {
    // en-IN groups digits the Indian way: ₹48,00,000.
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN")}`;
  }
}

function formatDate(normalized: unknown, fallback: string): string {
  const { iso } = (normalized ?? {}) as { iso?: unknown };
  const date = typeof iso === "string" ? new Date(`${iso}T00:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : fallback;
}

/** The facts extracted from the contract. Each one was checked against the text. */
export function KeyDetails({
  contractType,
  entities,
}: {
  contractType: string | null;
  entities: EntitySummary[];
}) {
  const parties = entities.filter((entity) => entity.kind === "party");
  const one = (kind: EntitySummary["kind"]) =>
    entities.find((entity) => entity.kind === kind);
  const date = one("date");
  const amount = one("amount");

  const rows: { label: string; value: string; note?: string }[] = [];
  if (contractType && contractType !== "other") {
    rows.push({ label: "Type", value: clauseTypeLabel(contractType) });
  }
  for (const party of parties) {
    rows.push({
      label: party.label === "party" ? "Party" : party.label,
      value: party.value,
    });
  }
  if (date)
    rows.push({
      label: "Effective date",
      value: formatDate(date.normalized, date.value),
    });
  const term = one("term");
  if (term) rows.push({ label: "Term", value: term.value });
  if (amount) {
    rows.push({
      label: "Value",
      value: formatAmount(amount.normalized) ?? amount.value,
      note: formatAmount(amount.normalized) ? amount.value : undefined,
    });
  }
  const law = one("law");
  if (law) rows.push({ label: "Governing law", value: law.value });
  const jurisdiction = one("jurisdiction");
  if (jurisdiction) rows.push({ label: "Jurisdiction", value: jurisdiction.value });

  if (rows.length === 0) return null;

  return (
    <section aria-label="Key details" className="rounded-lg border px-5 py-4">
      <h2 className="text-sm font-medium">Key details</h2>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row, index) => (
          <div key={`${row.label}-${index}`}>
            <dt className="text-muted-foreground text-xs">{row.label}</dt>
            <dd className="mt-0.5">
              {row.value}
              {row.note && (
                <span className="text-muted-foreground block text-xs">{row.note}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
