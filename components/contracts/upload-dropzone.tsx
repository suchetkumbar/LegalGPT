"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.txt";
const MAX_BYTES = 20 * 1024 * 1024;

export function UploadDropzone({
  parentId,
  prompt = "Drop a contract here, or click to choose",
}: {
  /** Upload as a new version of this contract. */
  parentId?: string;
  prompt?: string;
} = {}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setError("Upload a PDF, a Word document (.docx) or a text file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("The file is larger than 20 MB.");
      return;
    }

    setUploading(file.name);
    try {
      const body = new FormData();
      body.append("file", file);
      if (parentId) body.append("parentId", parentId);
      const response = await fetch("/api/contracts", { method: "POST", body });
      const result = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.id) {
        setError(result?.error ?? "The upload failed. Try again.");
        return;
      }
      router.push(`/contracts/${result.id}`);
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={uploading !== null}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file && !uploading) void upload(file);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors",
          "hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          dragging && "border-primary bg-muted/60",
          uploading && "cursor-progress opacity-80",
        )}
      >
        {uploading ? (
          <Loader2 className="text-muted-foreground size-7 animate-spin" aria-hidden />
        ) : (
          <Upload className="text-muted-foreground size-7" aria-hidden />
        )}
        <span className="mt-3 font-medium">
          {uploading ? `Uploading ${uploading}` : prompt}
        </span>
        <span className="text-muted-foreground mt-1 text-sm">
          PDF, Word (.docx) or text, up to 20 MB
        </span>
      </button>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose a contract to upload"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
