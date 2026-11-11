"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PlaybookPositionRow } from "@/lib/db/schema";
import { clauseTypeLabel } from "@/lib/pipeline/clause-types";

const fieldClass =
  "border-input bg-background focus-visible:ring-ring mt-1 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-70";

/** One clause type's position: standard wording, fallback, walk-away point and weight. */
export function PositionEditor({
  position,
  canEdit,
}: {
  position: PlaybookPositionRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [standardText, setStandardText] = useState(position.standardText);
  const [fallbackText, setFallbackText] = useState(position.fallbackText ?? "");
  const [walkaway, setWalkaway] = useState(position.walkaway ?? "");
  const [riskWeight, setRiskWeight] = useState(String(position.riskWeight));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const id = `position-${position.id}`;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/playbooks/positions/${position.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standardText,
          fallbackText,
          walkaway,
          riskWeight: Number(riskWeight),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage({ ok: false, text: body?.error ?? "Could not save. Try again." });
        return;
      }
      setMessage({
        ok: true,
        text: "Saved. It applies to contracts analysed from now on.",
      });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not save. Check your connection." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="hover:bg-muted/50 flex w-full items-baseline justify-between gap-4 px-5 py-3 text-left"
      >
        <span className="font-medium">{clauseTypeLabel(position.clauseType)}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          weight {position.riskWeight}
        </span>
      </button>

      {open && (
        <div id={id} className="grid gap-4 px-5 pb-5">
          <div>
            <Label htmlFor={`${id}-standard`}>Standard position</Label>
            <textarea
              id={`${id}-standard`}
              rows={4}
              disabled={!canEdit}
              value={standardText}
              onChange={(event) => setStandardText(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-fallback`}>Fallback</Label>
            <textarea
              id={`${id}-fallback`}
              rows={2}
              disabled={!canEdit}
              value={fallbackText}
              onChange={(event) => setFallbackText(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-walkaway`}>Walk-away point</Label>
            <textarea
              id={`${id}-walkaway`}
              rows={2}
              disabled={!canEdit}
              value={walkaway}
              onChange={(event) => setWalkaway(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="max-w-40">
            <Label htmlFor={`${id}-weight`}>Risk weight (0.1 to 5)</Label>
            <input
              id={`${id}-weight`}
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              disabled={!canEdit}
              value={riskWeight}
              onChange={(event) => setRiskWeight(event.target.value)}
              className={fieldClass}
            />
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden />}
                Save
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
          )}
        </div>
      )}
    </li>
  );
}
