import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const HISTORY_HEADER = "ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error";

export type HistoryRow = {
  ts: string;
  watch: string;
  offerId: string;
  name: string;
  price: number;
  listPrice?: number | undefined;
  currency: string;
  sizesAvailable: string[];
  matched: boolean;
  error: string;
};

export function csvLine(fields: string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f)).join(",");
}

/** Append only (T-008 adds pruning and broken rows). Writes the header when the file is new or empty. */
export function appendHistory(file: string, rows: HistoryRow[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  const lines: string[] = [];
  if (!existsSync(file) || statSync(file).size === 0) lines.push(HISTORY_HEADER);
  for (const r of rows) {
    lines.push(
      csvLine([
        r.ts,
        r.watch,
        r.offerId,
        r.name,
        String(r.price),
        r.listPrice === undefined ? "" : String(r.listPrice),
        r.currency,
        r.sizesAvailable.join(";"),
        r.matched ? "yes" : "no",
        r.error,
      ]),
    );
  }
  appendFileSync(file, lines.join("\n") + "\n");
}
