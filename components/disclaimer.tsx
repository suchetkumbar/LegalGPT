/** Shown wherever findings, reports or chat appear. The wording is fixed by the project plan. */
export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-muted-foreground text-xs ${className}`}>
      Not legal advice. Review findings with a qualified lawyer.
    </p>
  );
}
