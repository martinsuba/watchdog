import type { Alert } from "./diff.ts";

/** Plain-text message for one watch. T-006 adds the full format, T-010 sanitizing and capping. */
export function renderMessage(watchName: string, alerts: Alert[]): string {
  const lines = [`Watchdog: ${watchName}`];
  for (const { reason, offer, matchingSizes } of alerts) {
    lines.push("", `[${reason}] ${offer.name}`);
    lines.push(`${offer.price} ${offer.currency}${matchingSizes.length ? `, sizes: ${matchingSizes.join(", ")}` : ""}`);
    lines.push(offer.url);
  }
  return lines.join("\n") + "\n";
}
