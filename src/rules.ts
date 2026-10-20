import type { Match, Offer } from "./types.ts";

export type MatchResult = { matched: boolean; matchingSizes: string[] };

/** Pure. T-003 implements maxPrice only; T-005 adds the other conditions of REQ-003. */
export function matches(offer: Offer, match: Match): MatchResult {
  const matchingSizes = offer.sizes.filter((s) => s.available).map((s) => s.label);
  const matched = match.maxPrice === undefined || offer.price <= match.maxPrice;
  return { matched, matchingSizes };
}
