import type { Alert } from "./diff.ts";
import type { InvalidWatch } from "./watches.ts";

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

/** One alert per invalid watch file (REQ-001). The error is already a capped single line. */
export function renderInvalidWatch(invalid: InvalidWatch): string {
  return `Watchdog: invalid watch ${invalid.file}\n\n${invalid.error}\nFix the file in watches/; this watch is skipped until then.\n`;
}
