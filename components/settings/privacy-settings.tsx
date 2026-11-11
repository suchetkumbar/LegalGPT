"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

async function post(payload: unknown) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    deleted?: number;
  } | null;
  return { ok: response.ok, body };
}

export function PrivacySettings({
  retentionDays,
  orgName,
}: {
  retentionDays: number | null;
  orgName: string;
}) {
  const router = useRouter();
  const [retention, setRetention] = useState(retentionDays ? String(retentionDays) : "");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveRetention(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { ok, body } = await post({
      action: "retention",
      days: retention ? Number(retention) : null,
    });
    setMessage(
      ok
        ? { ok, text: "Saved. Older contracts are deleted at the next daily sweep." }
        : { ok, text: body?.error ?? "Could not save." },
    );
    setBusy(false);
    router.refresh();
  }

  async function deleteAll(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { ok, body } = await post({ action: "delete-all", confirm });
    setMessage(
      ok
        ? { ok, text: `Deleted ${body?.deleted ?? 0} contracts and their files.` }
        : { ok, text: body?.error ?? "Could not delete." },
    );
    setConfirm("");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={saveRetention} className="rounded-lg border px-5 py-4">
        <h2 className="text-sm font-medium">Data retention</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Contracts, with their findings, clauses and files, are deleted automatically
          once they are older than this. The audit log keeps a record that they existed.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <label htmlFor="retention" className="sr-only">
            Keep contracts for
          </label>
          <select
            id="retention"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="">Keep until deleted</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
          <Button type="submit" variant="outline" disabled={busy}>
            Save
          </Button>
        </div>
      </form>

      <form
        onSubmit={deleteAll}
        className="border-destructive/40 rounded-lg border px-5 py-4"
      >
        <h2 className="text-sm font-medium">Delete all contract data</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Permanently deletes every contract in {orgName}, with all findings, clauses,
          comments, obligations and uploaded files. This cannot be undone. Playbook,
          policies and members are kept.
        </p>
        <label htmlFor="confirm" className="mt-3 block text-sm">
          Type <span className="font-medium">{orgName}</span> to confirm
        </label>
        <div className="mt-1 flex items-center gap-3">
          <input
            id="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="border-input bg-background w-72 rounded-md border px-3 py-1.5 text-sm"
          />
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || confirm !== orgName}
          >
            Delete everything
          </Button>
        </div>
      </form>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
