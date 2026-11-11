/** A problem with the document itself, safe to show to the user as written. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}
