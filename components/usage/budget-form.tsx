"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function BudgetForm({ current }: { current: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ? String(current) : "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/usage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyTokenBudget: value.trim() ? Number(value) : null }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setMessage({ ok: false, text: body?.error ?? "Could not save." });
      return;
    }
    setMessage({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-muted-foreground block text-xs">
          Monthly token budget (empty for no limit)
        </span>
        <input
          type="number"
          min={1000}
          step={1000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-input bg-background mt-1 w-48 rounded-md border px-3 py-2 text-sm"
        />
      </label>
      <Button type="submit" variant="outline">
        Save budget
      </Button>
      {message && (
        <span
          role={message.ok ? "status" : "alert"}
          className={
            message.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
          }
        >
          {message.text}
        </span>
      )}
    </form>
  );
}
