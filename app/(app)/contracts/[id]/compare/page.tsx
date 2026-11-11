import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth/context";
import {
  compareVersions,
  summariseChanges,
  type ClauseChange,
} from "@/lib/compare/compare";
import { getFullContract, listVersions, type FullContract } from "@/lib/contracts/full";
import { isUuid } from "@/lib/contracts/ids";
import { withOrg } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Compare versions" };

const ASSESSMENT = {
  favourable: {
    label: "Favourable",
    className:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  unfavourable: {
    label: "Unfavourable",
    className: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  },
  neutral: { label: "Changed", className: "bg-muted" },
  unchanged: { label: "Unchanged", className: "bg-muted text-muted-foreground" },
} as const;

export default function ComparePage({
  params,
  searchParams,
}: PageProps<"/contracts/[id]/compare">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Comparison params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function toCompareClauses(contract: FullContract) {
  return contract.clauses.map((clause) => ({
    id: clause.id,
    ordinal: clause.ordinal,
    number: clause.number,
    heading: clause.heading,
    type: clause.type,
    text: contract.clauseTexts.get(clause.id) ?? "",
  }));
}

async function Comparison({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { with: withParam } = await searchParams;
  const { org } = await getAuthContext();
  if (!isUuid(id)) notFound();

  const data = await withOrg(org.id, async (tx) => {
    const current = await getFullContract(tx, id);
    if (!current) return null;
    const versions = await listVersions(tx, id);
    const otherId =
      typeof withParam === "string" && isUuid(withParam)
        ? withParam
        : (current.contract.parentId ?? null);
    const other = otherId ? await getFullContract(tx, otherId) : null;
    return { current, other, versions };
  });
  if (!data) notFound();
  const { current, other, versions } = data;

  const back = (
    <Link
      href={`/contracts/${id}`}
      className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden /> Back to the contract
    </Link>
  );

  if (!other) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p className="text-sm">
          There is no earlier version to compare with. Upload a new version from the
          contract page to compare the two.
        </p>
      </div>
    );
  }

  // Always show older → newer.
  const [older, newer] =
    other.contract.version <= current.contract.version
      ? [other, current]
      : [current, other];
  const changes = compareVersions(toCompareClauses(older), toCompareClauses(newer));
  const summary = summariseChanges(changes);

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Version {older.contract.version} → version {newer.contract.version}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.unfavourable} unfavourable · {summary.favourable} favourable ·{" "}
          {summary.neutral} other changes · {summary.unchanged} unchanged ({summary.added}{" "}
          added, {summary.removed} removed). Favourable and unfavourable are judged by
          whether a change adds or removes a known risk pattern; read every change.
        </p>
        {versions.length > 2 && (
          <p className="mt-2 text-sm">
            Compare with:{" "}
            {versions
              .filter((v) => v.id !== id)
              .map((v) => (
                <Link
                  key={v.id}
                  href={`/contracts/${id}/compare?with=${v.id}`}
                  className="mr-3 underline underline-offset-4"
                >
                  version {v.version}
                </Link>
              ))}
          </p>
        )}
      </div>

      <ol className="grid gap-3">
        {changes
          .filter((change) => change.assessment !== "unchanged")
          .map((change, index) => (
            <ChangeCard key={index} change={change} />
          ))}
      </ol>
    </div>
  );
}

function ChangeCard({ change }: { change: ClauseChange }) {
  const clause = change.after ?? change.before!;
  const style = ASSESSMENT[change.assessment];
  return (
    <li className="rounded-lg border px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn("rounded px-1.5 py-0.5 text-xs font-medium", style.className)}
        >
          {style.label}
        </span>
        <span className="font-medium">
          {[clause.number, clause.heading].filter(Boolean).join("  ") || "Clause"}
        </span>
        <span className="text-muted-foreground text-xs">
          {!change.before ? "added" : !change.after ? "removed" : ""}
        </span>
      </div>
      {change.introduced.length > 0 && (
        <p className="mt-1.5 text-red-800 dark:text-red-300">
          Introduces: {change.introduced.join("; ")}
        </p>
      )}
      {change.resolved.length > 0 && (
        <p className="mt-1.5 text-emerald-800 dark:text-emerald-300">
          Resolves: {change.resolved.join("; ")}
        </p>
      )}
      <p className="mt-2 leading-relaxed whitespace-pre-wrap">
        {change.diff.map((part, i) =>
          part.added ? (
            <ins key={i} className="bg-emerald-100 no-underline dark:bg-emerald-900/50">
              {part.text}
            </ins>
          ) : part.removed ? (
            <del
              key={i}
              className="bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200"
            >
              {part.text}
            </del>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
    </li>
  );
}
