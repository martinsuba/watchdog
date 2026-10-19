export type Price = { amount: number; currency: string };

// Harness stub: implemented in T-003 (REQ-009).
export function parsePrice(text: string): Price {
  throw new Error(`parsePrice: not implemented (${text})`);
}
