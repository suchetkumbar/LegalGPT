"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Lets a reviewer say which party their organisation is. The judgment pass
 * then weighs one-sided terms from that side.
 */
export function OurPartySelect({
  contractId,
  parties,
  current,
  canEdit,
}: {
  contractId: string;
  parties: string[];
  current: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (parties.length < 2) return null;

  async function save(next: string) {
    setValue(next);
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ourParty: next || null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setMessage({ ok: false, text: body?.error ?? "Could not save that." });
        setValue(current ?? "");
        return;
      }
      setMessage({
        ok: true,
        text: "Saved. The review takes this side the next time the analysis runs.",
      });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not save that. Check your connection." });
      setValue(current ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label htmlFor="our-party" className="text-muted-foreground">
        Which party are we?
      </label>
      <select
        id="our-party"
        value={value}
        disabled={!canEdit || saving}
        onChange={(event) => void save(event.target.value)}
        className="border-input bg-background rounded-md border px-2 py-1.5 text-sm disabled:opacity-70"
      >
        <option value="">Not set (neutral review)</option>
        {parties.map((party) => (
          <option key={party} value={party}>
            {party}
          </option>
        ))}
      </select>
      {message && (
        <span
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-muted-foreground" : "text-destructive"}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
