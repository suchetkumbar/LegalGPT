"use client";

import { Download, FileUp, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type TemplateOption = {
  id: string;
  name: string;
  description: string;
  roles: [string, string];
};

type Review = {
  score: number;
  band: string;
  findings: {
    ruleId: string;
    title: string;
    severity: number;
    quotedText: string | null;
  }[];
  compliance: { ruleId: string; title: string; verdict: string; reference: string }[];
};

type Draft = { title: string; text: string; review: Review; changes?: string[] };

const field =
  "border-input bg-background focus-visible:ring-ring mt-1 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

/** Requirements form → draft from the playbook → self-check → optional AI refinement. */
export function GenerateWizard({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0].id);
  const template = templates.find((t) => t.id === templateId)!;
  const [form, setForm] = useState({
    partyA: "",
    partyB: "",
    city: "Mumbai",
    // Left empty: a date computed here would be fixed when the page is prerendered.
    effectiveDate: "",
    termMonths: "12",
    value: "",
    paymentDays: "30",
    scope: "",
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: event.target.value });

  async function call(payload: unknown, action: string) {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (action === "docx" && response.ok) {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `${draft!.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.docx`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Something went wrong. Try again.");
        return;
      }
      setDraft(body as Draft);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(null);
    }
  }

  function assemble(event: React.FormEvent) {
    event.preventDefault();
    void call(
      {
        action: "assemble",
        requirements: {
          templateId,
          partyA: form.partyA,
          partyB: form.partyB,
          city: form.city,
          effectiveDate: form.effectiveDate,
          termMonths: Number(form.termMonths),
          value: form.value ? Number(form.value) : null,
          paymentDays: Number(form.paymentDays),
          scope: form.scope,
        },
      },
      "assemble",
    );
  }

  async function saveAsContract() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      const body = new FormData();
      body.append(
        "file",
        new File([draft.text], `${draft.title.toLowerCase()}.txt`, {
          type: "text/plain",
        }),
      );
      body.append("title", `${draft.title} – ${form.partyB || "draft"}`);
      const response = await fetch("/api/contracts", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.id) {
        setError(result?.error ?? "Could not save the draft.");
        return;
      }
      router.push(`/contracts/${result.id}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form onSubmit={assemble} className="grid content-start gap-4">
        <div>
          <Label htmlFor="template">Template</Label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className={field}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground mt-1 text-xs">{template.description}</p>
        </div>
        <div>
          <Label htmlFor="partyA">{template.roles[0]} (full legal name)</Label>
          <input
            id="partyA"
            required
            value={form.partyA}
            onChange={set("partyA")}
            className={field}
          />
        </div>
        <div>
          <Label htmlFor="partyB">{template.roles[1]} (full legal name)</Label>
          <input
            id="partyB"
            required
            value={form.partyB}
            onChange={set("partyB")}
            className={field}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="city">Place of signing</Label>
            <input
              id="city"
              required
              value={form.city}
              onChange={set("city")}
              className={field}
            />
          </div>
          <div>
            <Label htmlFor="effectiveDate">Effective date</Label>
            <input
              id="effectiveDate"
              type="date"
              required
              value={form.effectiveDate}
              onChange={set("effectiveDate")}
              className={field}
            />
          </div>
          <div>
            <Label htmlFor="termMonths">Term (months)</Label>
            <input
              id="termMonths"
              type="number"
              min={1}
              max={120}
              required
              value={form.termMonths}
              onChange={set("termMonths")}
              className={field}
            />
          </div>
          <div>
            <Label htmlFor="paymentDays">Payment within (days)</Label>
            <input
              id="paymentDays"
              type="number"
              min={1}
              max={120}
              value={form.paymentDays}
              onChange={set("paymentDays")}
              className={field}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="value">Value in rupees (optional)</Label>
          <input
            id="value"
            type="number"
            min={0}
            value={form.value}
            onChange={set("value")}
            className={field}
          />
        </div>
        <div>
          <Label htmlFor="scope">
            {templateId === "employment"
              ? "Role"
              : templateId.startsWith("nda")
                ? "Purpose of sharing"
                : "Services"}
          </Label>
          <textarea
            id="scope"
            required
            rows={3}
            value={form.scope}
            onChange={set("scope")}
            className={field}
          />
        </div>
        <Button type="submit" disabled={busy !== null}>
          {busy === "assemble" && <Loader2 className="animate-spin" aria-hidden />}
          Build draft
        </Button>
        <p className="text-muted-foreground text-xs">
          Clauses come from your playbook&apos;s standard positions. Building a draft does
          not use the AI.
        </p>
      </form>

      <div className="min-w-0">
        {error && (
          <p role="alert" className="text-destructive mb-4 text-sm">
            {error}
          </p>
        )}
        {!draft ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-6 py-20 text-center text-sm">
            Fill in the form to build a draft.
          </div>
        ) : (
          <div className="grid gap-4">
            <section
              aria-label="Self-check"
              className="rounded-lg border px-5 py-4 text-sm"
            >
              <h2 className="font-medium">
                Self-check: risk score {draft.review.score}{" "}
                <span className="text-muted-foreground font-normal">
                  ({draft.review.band})
                </span>
              </h2>
              <p className="text-muted-foreground mt-1">
                The draft was checked with the same rules and compliance packs as uploaded
                contracts.
              </p>
              {draft.review.findings.length + draft.review.compliance.length === 0 ? (
                <p className="mt-2">Nothing was flagged.</p>
              ) : (
                <ul className="mt-2 list-disc pl-5">
                  {draft.review.findings.map((f) => (
                    <li key={f.ruleId}>{f.title}</li>
                  ))}
                  {draft.review.compliance.map((c) => (
                    <li key={c.ruleId}>
                      {c.title} ({c.verdict}, {c.reference})
                    </li>
                  ))}
                </ul>
              )}
              {draft.changes && draft.changes.length > 0 && (
                <>
                  <h3 className="mt-3 font-medium">Changes made by the AI</h3>
                  <ul className="mt-1 list-disc pl-5">
                    {draft.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  call({ action: "docx", title: draft.title, text: draft.text }, "docx")
                }
              >
                <Download aria-hidden /> Download .docx
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={saveAsContract}>
                {busy === "save" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <FileUp aria-hidden />
                )}
                Save as a contract
              </Button>
            </div>
            <p className="text-muted-foreground -mt-2 text-xs">
              Saving runs the full analysis, which uses 4 AI calls.
            </p>

            <pre className="bg-card max-h-[60vh] overflow-y-auto rounded-lg border px-6 py-5 font-sans text-sm leading-relaxed whitespace-pre-wrap">
              {draft.text}
            </pre>

            <div className="rounded-lg border px-5 py-4">
              <Label htmlFor="instructions">Adapt the draft with AI (1 AI call)</Label>
              <textarea
                id="instructions"
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="For example: add a source code escrow clause; make the liability cap twice the annual fees."
                className={field}
              />
              <Button
                className="mt-3"
                disabled={busy !== null || instructions.trim().length < 5}
                onClick={() =>
                  call(
                    { action: "refine", templateId, text: draft.text, instructions },
                    "refine",
                  )
                }
              >
                {busy === "refine" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Sparkles aria-hidden />
                )}
                Apply instructions
              </Button>
              <p className={cn("text-muted-foreground mt-2 text-xs")}>
                The revised draft is checked again before it is shown. This can take a
                minute or two.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
