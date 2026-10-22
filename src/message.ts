import type { Alert } from "./diff.ts";
import { MAX_MESSAGE, MAX_NAME, capMessage, safeUrl, sanitizeText } from "./sanitize.ts";
import type { InvalidWatch } from "./watches.ts";

/** Discount in whole percent, only when a list price above the price is known. */
function discountPct(price: number, listPrice?: number): number | null {
  if (listPrice === undefined || !(listPrice > price)) return null;
  return Math.round((1 - price / listPrice) * 100);
}

const MAX_SIZES_LINE = 300;
const MAX_NOTE = 200;

function renderAlert({ reasons, offer, matchingSizes }: Alert, watchUrls: string[]): string {
  const pct = discountPct(offer.price, offer.listPrice);
  const list = pct === null ? "" : ` (list ${offer.listPrice} ${offer.currency}, -${pct}%)`;
  const sizes = matchingSizes.map((x) => sanitizeText(x, 40)).filter((x) => x !== "");
  const sizesText = sizes.length ? `, sizes: ${sizes.join(", ")}` : "";
  const note = offer.note === undefined ? "" : sanitizeText(offer.note, MAX_NOTE);
  return [
    "",
    `[${reasons.join(" + ")}] ${sanitizeText(offer.name, MAX_NAME)}`,
    `${offer.price} ${sanitizeText(offer.currency, 8)}${list}${sanitizeText(sizesText, MAX_SIZES_LINE)}`,
    ...(note === "" ? [] : [`Note: ${note}`]),
    safeUrl(offer.url, watchUrls),
  ].join("\n");
}

/**
 * Plain-text message for one watch (REQ-004, REQ-008). Every text is re-sanitized (the extractor already did it:
 * defence in depth), links must be on the watch's own domain (else the first watch URL is shown), and the whole
 * message stays within 3500 characters: whole offers are kept from the top, the rest becomes "... and N more".
 */
export function renderMessage(watchName: string, alerts: Alert[], watchUrls: string[]): string {
  const head = `Watchdog: ${sanitizeText(watchName, MAX_NAME)}`;
  const blocks = alerts.map((a) => renderAlert(a, watchUrls));
  const moreLine = (n: number) => `\n\n… and ${n} more`;
  let text = head;
  let shown = 0;
  for (const block of blocks) {
    const rest = blocks.length - shown - 1;
    const reserve = rest > 0 ? moreLine(rest).length : 0;
    if (shown > 0 && text.length + block.length + reserve + 1 > MAX_MESSAGE) break;
    text += block;
    shown++;
  }
  if (shown < blocks.length) text += moreLine(blocks.length - shown);
  return capMessage(text + "\n");
}

/** One alert per invalid watch file (REQ-001). The error is already a capped single line. */
export function renderInvalidWatch(invalid: InvalidWatch): string {
  const file = sanitizeText(invalid.file, 200);
  const error = sanitizeText(invalid.error, 500);
  return capMessage(
    `Watchdog: invalid watch ${file}\n\n${error}\nFix the file in watches/; this watch is skipped until then.\n`,
  );
}

/** One alert when a watch turns broken (REQ-005). The reason is capped to a single line. */
export function renderBroken(watchName: string, reason: string): string {
  return capMessage(
    `Watchdog: ${sanitizeText(watchName, MAX_NAME)}\n\nwatch is broken: ${sanitizeText(reason, 200)}\nSnapshot saved under data/broken/; see docs/REPAIR.md.\n`,
  );
}

/** One message when a broken watch works again (REQ-005). */
export function renderRecovered(watchName: string): string {
  return capMessage(
    `Watchdog: ${sanitizeText(watchName, MAX_NAME)}\n\nwatch recovered: the page loads and parses again.\n`,
  );
}
