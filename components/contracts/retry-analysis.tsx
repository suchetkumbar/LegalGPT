"use client";

import { Loader2, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Shown when analysis stopped part-way, usually because the model quota ran out. */
export function RetryAnalysis({
  contractId,
  message,
  canRetry,
}: {
  contractId: string;
  message: string;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contracts/${contractId}/analyze`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not start the analysis. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not start the analysis. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-5 py-4"
    >
      <div className="max-w-2xl text-sm">
        <p className="font-medium">Analysis is incomplete</p>
        <p className="text-muted-foreground mt-0.5">{message}</p>
        {error && (
          <p role="alert" className="text-destructive mt-1">
            {error}
          </p>
        )}
      </div>
      {canRetry && (
        <Button variant="outline" onClick={retry} disabled={busy}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RotateCw aria-hidden />
          )}
          Run analysis again
        </Button>
      )}
    </div>
  );
}
