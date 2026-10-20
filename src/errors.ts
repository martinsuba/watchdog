/** Thrown by extractors for missing page structure or block pages (T-007 turns it into a "broken" alert). */
export class ExtractError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "ExtractError";
    this.reason = reason;
  }
}
