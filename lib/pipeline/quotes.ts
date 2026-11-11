/**
 * Finds a model-supplied quote in the source text. Tolerates differences in
 * whitespace, since models often flatten line breaks, but nothing else: the
 * words and punctuation must match. Returns the start index, or -1 when the
 * quote is not genuinely in the text.
 *
 * This is the check behind "no citation means no finding": anything a model
 * claims about a contract must point at words that are really there.
 */
export function findQuote(text: string, quote: string, minLength = 8): number {
  const wanted = quote.replace(/\s+/g, " ").trim();
  if (wanted.length < minLength) return -1;

  const exact = text.indexOf(quote);
  if (exact >= 0) return exact;

  const pattern = wanted
    .split(" ")
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(pattern).exec(text)?.index ?? -1;
}
