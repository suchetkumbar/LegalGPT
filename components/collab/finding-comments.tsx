"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CommentItem = {
  id: string;
  findingId: string | null;
  author: string;
  body: string;
  createdAt: string;
};

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** The discussion thread under one finding. */
export function FindingComments({
  findingId,
  comments,
}: {
  findingId: string;
  comments: CommentItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/findings/${findingId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!response.ok) {
        setError("Could not post the comment.");
        return;
      }
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
      >
        {comments.length ? `Discussion (${comments.length})` : "Comment"}
      </button>
      {open && (
        <div className="mt-2 grid gap-2">
          {comments.map((comment) => (
            <div key={comment.id} className="bg-muted/50 rounded-md px-3 py-2 text-xs">
              <p className="text-muted-foreground">
                {comment.author} · {timeFormat.format(new Date(comment.createdAt))}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p>
            </div>
          ))}
          <form onSubmit={post} className="flex gap-2">
            <label htmlFor={`comment-${findingId}`} className="sr-only">
              Add a comment
            </label>
            <input
              id={`comment-${findingId}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment"
              className="border-input bg-background flex-1 rounded-md border px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-60"
            >
              Post
            </button>
          </form>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
