import { cn } from "@/lib/utils";

/**
 * The LegalGPT wordmark used in page headers. Text only, by choice: the
 * scales-of-justice mark is kept for the browser tab icon (app/icon.svg) and
 * not repeated on the pages.
 */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-tight", className)}>LegalGPT</span>;
}
