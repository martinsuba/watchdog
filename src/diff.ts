import type { AlertedOffer, Offer } from "./types.ts";

export type MatchingOffer = { offer: Offer; matchingSizes: string[] };
export type AlertReason = "new";
export type Alert = { reason: AlertReason; offer: Offer; matchingSizes: string[] };

/**
 * Pure. Compares the matching offers with what was last alerted. T-003 knows "new" only (T-006 adds cheaper and
 * new size). Offers that no longer match are not carried over, i.e. forgotten.
 */
export function diff(
  prev: Record<string, AlertedOffer>,
  matching: MatchingOffer[],
): { alerts: Alert[]; nextAlerted: Record<string, AlertedOffer> } {
  const alerts: Alert[] = [];
  const nextAlerted: Record<string, AlertedOffer> = {};
  for (const { offer, matchingSizes } of matching) {
    const known = prev[offer.id];
    if (known === undefined) {
      alerts.push({ reason: "new", offer, matchingSizes });
      nextAlerted[offer.id] = { price: offer.price, sizes: matchingSizes };
    } else {
      nextAlerted[offer.id] = known;
    }
  }
  return { alerts, nextAlerted };
}
