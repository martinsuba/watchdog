import type { Match, Offer } from "./types.ts";

export type MatchResult = {
  matched: boolean;
  /** Available sizes to show; when `match.sizes` is set, only the configured ones. */
  matchingSizes: string[];
  /** The offer's currency differs from the watch currency (never matches; T-007 turns it into a broken alert). */
  currencyMismatch: boolean;
};

const lower = (s: string) => s.toLowerCase();

/** Pure. All configured conditions of REQ-003 must hold; availability and currency are always required. */
export function matches(offer: Offer, match: Match, watchCurrency?: string): MatchResult {
  const available = offer.sizes.filter((s) => s.available).map((s) => s.label);
  const wanted = (match.sizes ?? []).map(lower);
  const matchingSizes = wanted.length > 0 ? available.filter((l) => wanted.includes(lower(l))) : available;
  const currencyMismatch = watchCurrency !== undefined && lower(offer.currency) !== lower(watchCurrency);

  const name = lower(offer.name);
  const inStock = offer.inStock && (offer.sizes.length === 0 || available.length > 0);
  const matched =
    !currencyMismatch &&
    inStock &&
    (match.maxPrice === undefined || offer.price <= match.maxPrice) &&
    (match.minDiscountPct === undefined || discountAtLeast(offer, match.minDiscountPct)) &&
    (!match.nameIncludes?.length || match.nameIncludes.some((t) => name.includes(lower(t)))) &&
    (!match.nameExcludes?.length || !match.nameExcludes.some((t) => name.includes(lower(t)))) &&
    (wanted.length === 0 || matchingSizes.length > 0);
  return { matched, matchingSizes, currencyMismatch };
}

/** (list - price) / list * 100 >= pct, as price * 100 <= list * (100 - pct) on scaled integers (no float drift). */
function discountAtLeast(offer: Offer, pct: number): boolean {
  if (offer.listPrice === undefined || offer.listPrice <= 0) return false;
  const left = Math.round(offer.price * 100 * 1000);
  const right = Math.round(offer.listPrice * (100 * 1000 - Math.round(pct * 1000)));
  return left <= right;
}
