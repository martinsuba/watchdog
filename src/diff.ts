import type { AlertedOffer, Offer } from "./types.ts";

export type MatchingOffer = { offer: Offer; matchingSizes: string[] };
export type AlertReason = "new" | "cheaper" | "new size";
export type Alert = { reasons: AlertReason[]; offer: Offer; matchingSizes: string[] };

/**
 * Pure (REQ-004). Compares the currently matching offers with what was last alerted.
 * - not in prev: "new"
 * - price below the last ALERTED price: "cheaper"
 * - a matching size not in the stored sizes: "new size"
 * Stored state per offer:
 * - on an alert: current price and current matching sizes (the offer was alerted at exactly that).
 * - without an alert: the last alerted price is kept as baseline (a rise followed by a fall back to it stays silent,
 *   a drop below it alerts), but the sizes are replaced by the current matching sizes (a size that disappears and
 *   comes back alerts as "new size").
 * Offers that no longer match are not carried over, i.e. forgotten.
 */
export function diff(
  prev: Record<string, AlertedOffer>,
  matching: MatchingOffer[],
): { alerts: Alert[]; nextAlerted: Record<string, AlertedOffer> } {
  const alerts: Alert[] = [];
  const nextAlerted: Record<string, AlertedOffer> = {};
  for (const { offer, matchingSizes } of matching) {
    const known = prev[offer.id];
    const current = { price: offer.price, sizes: matchingSizes };
    if (known === undefined) {
      alerts.push({ reasons: ["new"], offer, matchingSizes });
      nextAlerted[offer.id] = current;
      continue;
    }
    const reasons: AlertReason[] = [];
    if (offer.price < known.price) reasons.push("cheaper");
    if (matchingSizes.some((s) => !known.sizes.includes(s))) reasons.push("new size");
    if (reasons.length > 0) {
      alerts.push({ reasons, offer, matchingSizes });
      nextAlerted[offer.id] = current;
    } else {
      nextAlerted[offer.id] = { price: known.price, sizes: matchingSizes };
    }
  }
  return { alerts, nextAlerted };
}
