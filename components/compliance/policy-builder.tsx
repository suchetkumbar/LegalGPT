"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CLAUSE_TYPE_IDS, clauseTypeLabel } from "@/lib/pipeline/clause-types";
import { CATEGORY_LABELS, RISK_CATEGORIES } from "@/lib/rules/types";

export type PolicyView = {
  id: string;
  title: string;
  description: string;
  mode: "require" | "forbid";
  phrases: string[];
  clauseType: string | null;
  severity: string;
};

const field =
  "border-input bg-background focus-visible:ring-ring mt-1 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

/** Lists the organisation's policies and lets an admin add or remove them. */
export function PolicyBuilder({
  policies,
  canEdit,
}: {
  policies: PolicyView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"require" | "forbid">("forbid");
  const [phrases, setPhrases] = useState("");
  const [clauseType, setClauseType] = useState("");
  const [severity, setSeverity] = useState<"fail" | "warn">("fail");
  const [category, setCategory] = useState<string>("liability");
  const [fix, setFix] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy("add");
    setMessage(null);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          mode,
          phrases: phrases
            .split("\n")
            .map((phrase) => phrase.trim())
            .filter(Boolean),
          clauseType: clauseType || null,
          severity,
          category,
          fix,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage({ ok: false, text: body?.error ?? "Could not add the policy." });
        return;
      }
      setTitle("");
      setDescription("");
      setPhrases("");
      setFix("");
      setMessage({
        ok: true,
        text: "Added. It applies to contracts analysed from now on.",
      });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not add the policy. Check your connection." });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/policies?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) setMessage({ ok: false, text: "Could not remove the policy." });
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      <ul className="rounded-lg border">
        {policies.length === 0 && (
          <li className="text-muted-foreground px-5 py-8 text-center text-sm">
            No internal policies yet.
          </li>
        )}
        {policies.map((policy) => (
          <li
            key={policy.id}
            className="flex items-start gap-4 border-b px-5 py-3 last:border-b-0"
          >
            <div className="flex-1 text-sm">
              <p className="font-medium">{policy.title}</p>
              <p className="text-muted-foreground mt-0.5">{policy.description}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {policy.mode === "require" ? "Must mention" : "Must not mention"}:{" "}
                {policy.phrases.map((phrase) => `"${phrase}"`).join(", ")}
                {policy.clauseType
                  ? ` · in ${clauseTypeLabel(policy.clauseType)} clauses`
                  : ""}
                {` · ${policy.severity === "fail" ? "fails" : "warns"}`}
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${policy.title}`}
                disabled={busy === policy.id}
                onClick={() => remove(policy.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form onSubmit={add} className="grid gap-4 rounded-lg border px-5 py-4">
          <h2 className="text-sm font-medium">Add a policy</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="policy-title">Title</Label>
              <input
                id="policy-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="No auto-renewal"
                className={field}
              />
            </div>
            <div>
              <Label htmlFor="policy-category">Risk category</Label>
              <select
                id="policy-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={field}
              >
                {RISK_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="policy-description">Why it matters</Label>
            <textarea
              id="policy-description"
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="policy-mode">Rule</Label>
              <select
                id="policy-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as "require" | "forbid")}
                className={field}
              >
                <option value="forbid">Contract must not mention</option>
                <option value="require">Contract must mention</option>
              </select>
            </div>
            <div>
              <Label htmlFor="policy-clause">Look in</Label>
              <select
                id="policy-clause"
                value={clauseType}
                onChange={(e) => setClauseType(e.target.value)}
                className={field}
              >
                <option value="">The whole contract</option>
                {CLAUSE_TYPE_IDS.filter((id) => id !== "other").map((id) => (
                  <option key={id} value={id}>
                    {clauseTypeLabel(id)} clauses
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="policy-severity">If broken</Label>
              <select
                id="policy-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "fail" | "warn")}
                className={field}
              >
                <option value="fail">Fail</option>
                <option value="warn">Warn</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="policy-phrases">Phrases, one per line</Label>
            <textarea
              id="policy-phrases"
              required
              rows={3}
              value={phrases}
              onChange={(e) => setPhrases(e.target.value)}
              placeholder={"renew automatically\nautomatic renewal"}
              className={field}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Matched word for word, ignoring capitals and spacing.
            </p>
          </div>
          <div>
            <Label htmlFor="policy-fix">Suggested fix (optional)</Label>
            <input
              id="policy-fix"
              value={fix}
              onChange={(e) => setFix(e.target.value)}
              className={field}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy === "add"}>
              {busy === "add" && <Loader2 className="animate-spin" aria-hidden />}
              Add policy
            </Button>
            {message && (
              <p
                role={message.ok ? "status" : "alert"}
                className={
                  message.ok
                    ? "text-muted-foreground text-sm"
                    : "text-destructive text-sm"
                }
              >
                {message.text}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
