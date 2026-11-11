"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Delete a contract, after a second click to confirm. */
export function DeleteContract({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const response = await fetch(`/api/contracts/${contractId}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete the contract.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm">
            Delete this contract and everything derived from it?
          </span>
          <Button size="sm" variant="destructive" onClick={remove}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden /> Delete
        </Button>
      )}
      {error && (
        <span role="alert" className="text-destructive text-sm">
          {error}
        </span>
      )}
    </span>
  );
}

/** Loads three fictional sample contracts with the rule-based review (no AI calls). */
export function LoadSamples() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/samples", { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      setError("Could not load the samples.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      <Button variant="outline" onClick={load} disabled={busy}>
        Load three sample contracts
      </Button>
      <p className="text-muted-foreground mt-1 text-xs">
        Fictional Indian contracts, reviewed by the rules only so no AI quota is used.
      </p>
      {error && (
        <p role="alert" className="text-destructive mt-1 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
