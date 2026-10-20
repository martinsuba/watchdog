import type { Alert } from "./diff.ts";
import type { InvalidWatch } from "./watches.ts";

/** Discount in whole percent, only when a list price above the price is known. */
function discountPct(price: number, listPrice?: number): number | null {
  if (listPrice === undefined || !(listPrice > price)) return null;
  return Math.round((1 - price / listPrice) * 100);
}

/** Plain-text message for one watch (REQ-004). T-010 adds sanitizing and capping. */
export function renderMessage(watchName: string, alerts: Alert[]): string {
  const lines = [`Watchdog: ${watchName}`];
  for (const { reasons, offer, matchingSizes } of alerts) {
    lines.push("", `[${reasons.join(" + ")}] ${offer.name}`);
    const pct = discountPct(offer.price, offer.listPrice);
    const list = pct === null ? "" : ` (list ${offer.listPrice} ${offer.currency}, -${pct}%)`;
    lines.push(
      `${offer.price} ${offer.currency}${list}${matchingSizes.length ? `, sizes: ${matchingSizes.join(", ")}` : ""}`,
    );
    lines.push(offer.url);
  }
  return lines.join("\n") + "\n";
}

/** One alert per invalid watch file (REQ-001). The error is already a capped single line. */
export function renderInvalidWatch(invalid: InvalidWatch): string {
  return `Watchdog: invalid watch ${invalid.file}\n\n${invalid.error}\nFix the file in watches/; this watch is skipped until then.\n`;
}
