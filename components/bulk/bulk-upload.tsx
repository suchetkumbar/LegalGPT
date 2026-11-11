"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function BulkUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/bulk", { method: "POST", body });
      const result = (await response.json().catch(() => null)) as {
        queued?: number;
        skipped?: { name: string; reason: string }[];
        error?: string;
      } | null;
      if (!response.ok) {
        setMessage({ ok: false, text: result?.error ?? "The upload failed." });
        return;
      }
      const skipped = result?.skipped?.length ?? 0;
      setMessage({
        ok: true,
        text: `${result?.queued} contract${result?.queued === 1 ? "" : "s"} queued${skipped ? `, ${skipped} skipped` : ""}. Admins get an email when the scan finishes.`,
      });
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border px-5 py-4">
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        aria-label="Choose a zip of contracts"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <Button onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        Upload a zip of contracts
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        Up to 200 PDF, Word or text files, 25 MB in all. Each contract uses 4 AI calls;
        they run one after another, about two a minute, to stay inside the free quota.
      </p>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "mt-2 text-sm" : "text-destructive mt-2 text-sm"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
