"use client";

import { Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Disclaimer } from "@/components/disclaimer";
import { Button } from "@/components/ui/button";

type Citation = {
  source: number;
  contractId: string;
  label: string;
  contractTitle: string;
  quote: string;
};
type SourceRef = {
  clauseId: string;
  contractId: string;
  contractTitle: string;
  label: string;
};
type Reply = {
  question: string;
  answer?: string;
  citations?: Citation[];
  notInSources?: boolean;
  unverified?: boolean;
  sources?: SourceRef[];
  error?: string;
};

/** Ask questions of one contract (contractId set) or of every contract. */
export function AskPanel({ contractId }: { contractId: string | null }) {
  const [question, setQuestion] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (asked.length < 3) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: asked, contractId, deep }),
      });
      const body = await response
        .json()
        .catch(() => ({ error: "Something went wrong." }));
      setReplies([{ question: asked, ...body }, ...replies]);
      setQuestion("");
    } catch {
      setReplies([{ question: asked, error: "Could not reach the server." }, ...replies]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Ask" className="rounded-lg border px-5 py-4">
      <h2 className="text-sm font-medium">
        {contractId ? "Ask this contract" : "Ask your contracts"}
      </h2>
      <Disclaimer className="mt-1" />
      <form onSubmit={ask} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="ask-question" className="sr-only">
          Question
        </label>
        <input
          id="ask-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            contractId
              ? "What is the notice period for termination?"
              : "Which contracts renew automatically?"
          }
          className="border-input bg-background focus-visible:ring-ring min-w-64 flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
          />
          Deep analysis
        </label>
        <Button type="submit" disabled={busy || question.trim().length < 3}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Ask
        </Button>
      </form>
      <p className="text-muted-foreground mt-1 text-xs">Each question uses 2 AI calls.</p>

      <ol className="mt-4 grid gap-4" aria-live="polite">
        {replies.map((reply, index) => (
          <li key={replies.length - index} className="text-sm">
            <p className="font-medium">{reply.question}</p>
            {reply.error && <p className="text-destructive mt-1">{reply.error}</p>}
            {reply.answer && (
              <p className="mt-1 leading-relaxed whitespace-pre-wrap">{reply.answer}</p>
            )}
            {reply.unverified && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                None of the quotes in this answer could be found in the contract text.
                Treat it with caution.
              </p>
            )}
            {reply.citations && reply.citations.length > 0 && (
              <ul className="mt-2 grid gap-1.5">
                {reply.citations.map((citation, i) => (
                  <li key={i} className="text-muted-foreground border-l-2 pl-3 text-xs">
                    <Link
                      href={`/contracts/${citation.contractId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      [S{citation.source}]{" "}
                      {contractId ? "" : `${citation.contractTitle}, `}
                      {citation.label}
                    </Link>
                    <span className="block italic">“{citation.quote}”</span>
                  </li>
                ))}
              </ul>
            )}
            {reply.error && reply.sources && reply.sources.length > 0 && (
              <ul className="text-muted-foreground mt-2 list-disc pl-5 text-xs">
                {reply.sources.map((source) => (
                  <li key={source.clauseId}>
                    <Link
                      href={`/contracts/${source.contractId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {contractId ? "" : `${source.contractTitle}, `}
                      {source.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
