"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  signed: "Signed",
};
const NEXT: Record<string, string[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["signed", "in_review"],
  signed: [],
};
const ACTION: Record<string, string> = {
  in_review: "Send for review",
  approved: "Approve",
  signed: "Mark as signed",
  draft: "Back to draft",
};

/** Status and reviewer for a contract. The server enforces who may do what. */
export function WorkflowControls({
  contractId,
  status,
  assigneeId,
  members,
  canEdit,
}: {
  contractId: string;
  status: string;
  assigneeId: string | null;
  members: { id: string; email: string; role: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(change: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save that.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
      <span>
        Status: <span className="font-medium">{LABELS[status] ?? status}</span>
      </span>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Reviewer</span>
        <select
          value={assigneeId ?? ""}
          disabled={!canEdit || busy}
          onChange={(event) => patch({ assigneeId: event.target.value || null })}
          className="border-input bg-background rounded-md border px-2 py-1 text-sm disabled:opacity-70"
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.email}
            </option>
          ))}
        </select>
      </label>
      {canEdit &&
        (NEXT[status] ?? []).map((next) => (
          <button
            key={next}
            type="button"
            disabled={busy}
            onClick={() => patch({ workflowStatus: next })}
            className="hover:bg-muted rounded-md border px-3 py-1 disabled:opacity-60"
          >
            {ACTION[next]}
          </button>
        ))}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
