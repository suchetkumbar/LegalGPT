"use client";

import { Download, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type FindingOption = {
  id: string;
  title: string;
  severity: number;
  quotedText: string | null;
  hasPosition: boolean;
};

type Proposal = {
  findingId: string;
  firm: string;
  balanced: string;
  conciliatory: string;
  rationale: string;
  source: "model" | "playbook";
};

const TONES = ["firm", "balanced", "conciliatory"] as const;

/** Pick findings, get counter-proposals in three tones, download them as a redline. */
export function NegotiationPanel({
  contractId,
  findings,
}: {
  contractId: string;
  findings: FindingOption[];
}) {
  const quotable = findings.filter((f) => f.quotedText);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(quotable.filter((f) => f.severity >= 4).map((f) => f.id)),
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tone, setTone] = useState<Record<string, (typeof TONES)[number]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function propose(useModel: boolean) {
    setBusy(useModel ? "model" : "playbook");
    setError(null);
    try {
      const response = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, findingIds: [...selected], useModel }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not draft proposals.");
      if (body?.proposals) setProposals(body.proposals);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("docx");
    setError(null);
    try {
      const replacements = proposals.map((p) => ({
        findingId: p.findingId,
        text: p[tone[p.findingId] ?? "balanced"],
      }));
      const response = await fetch(`/api/contracts/${contractId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacements }),
      });
      if (!response.ok) {
        setError("Could not build the document.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "redline.docx";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  const titleOf = (id: string) => findings.find((f) => f.id === id)?.title ?? "";

  return (
    <div className="grid gap-6">
      <section aria-label="Findings to negotiate" className="rounded-lg border">
        <h2 className="border-b px-5 py-3 text-sm font-medium">
          Choose what to push back on ({selected.size} selected)
        </h2>
        {quotable.length === 0 && (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            No findings with wording to change.
          </p>
        )}
        <ul>
          {quotable.map((finding) => (
            <li key={finding.id} className="border-b px-5 py-2.5 text-sm last:border-b-0">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(finding.id)}
                  onChange={() => toggle(finding.id)}
                />
                <span>
                  <span className="font-medium">{finding.title}</span>
                  <span className="text-muted-foreground block text-xs italic">
                    {finding.quotedText!.slice(0, 180)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <Button
            variant="outline"
            disabled={!selected.size || busy !== null}
            onClick={() => propose(false)}
          >
            {busy === "playbook" && <Loader2 className="animate-spin" aria-hidden />}
            Use playbook wording
          </Button>
          <Button
            disabled={!selected.size || busy !== null}
            onClick={() => propose(true)}
          >
            {busy === "model" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            Draft with AI (1 call)
          </Button>
          <span className="text-muted-foreground text-xs">
            Playbook wording is free; the AI tailors three versions to each clause.
          </span>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {proposals.length > 0 && (
        <section aria-label="Counter-proposals" className="grid gap-3">
          {proposals.map((proposal) => {
            const current = tone[proposal.findingId] ?? "balanced";
            return (
              <article
                key={proposal.findingId}
                className="rounded-lg border px-5 py-4 text-sm"
              >
                <h3 className="font-medium">{titleOf(proposal.findingId)}</h3>
                <p className="text-muted-foreground text-xs">
                  {proposal.source === "model"
                    ? "Drafted by AI from your playbook"
                    : "From your playbook"}
                </p>
                <div role="radiogroup" aria-label="Tone" className="mt-2 flex gap-1.5">
                  {TONES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={current === value}
                      onClick={() => setTone({ ...tone, [proposal.findingId]: value })}
                      className={
                        current === value
                          ? "bg-primary text-primary-foreground rounded-full px-2.5 py-1 text-xs capitalize"
                          : "hover:bg-muted rounded-full border px-2.5 py-1 text-xs capitalize"
                      }
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 leading-relaxed whitespace-pre-wrap">
                  {proposal[current]}
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  Note to the other side: {proposal.rationale}
                </p>
              </article>
            );
          })}
          <div>
            <Button variant="outline" disabled={busy !== null} onClick={download}>
              {busy === "docx" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              Download redline (.docx)
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
