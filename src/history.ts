import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const HISTORY_HEADER = "ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error";

export const HISTORY_RETENTION_DAYS = 180;

/** An offer row, or a broken-check row (only ts, watch and error set; the offer columns stay empty). */
export type HistoryRow = {
  ts: string;
  watch: string;
  offerId?: string;
  name?: string;
  price?: number;
  listPrice?: number | undefined;
  currency?: string;
  sizesAvailable?: string[];
  matched?: boolean;
  error?: string;
};

/**
 * Spreadsheet formula injection guard: names and errors come from untrusted pages, and Excel/Sheets/LibreOffice run a
 * cell that starts with = + - @ (or tab / CR) as a formula. Such text gets a leading single quote (OWASP guidance).
 * Applied to text columns only, never to numbers (a negative price is still written as -5).
 */
export function neutralise(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvLine(fields: string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f)).join(",");
}

/** Appends rows; writes the header when the file is new or empty. */
export function appendHistory(file: string, rows: HistoryRow[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  const lines: string[] = [];
  if (!existsSync(file) || statSync(file).size === 0) lines.push(HISTORY_HEADER);
  for (const r of rows) {
    lines.push(
      csvLine([
        r.ts,
        neutralise(r.watch),
        neutralise(r.offerId ?? ""),
        neutralise(r.name ?? ""),
        r.price === undefined ? "" : String(r.price),
        r.listPrice === undefined ? "" : String(r.listPrice),
        neutralise(r.currency ?? ""),
        neutralise((r.sizesAvailable ?? []).join(";")),
        r.matched === undefined ? "" : r.matched ? "yes" : "no",
        neutralise(r.error ?? ""),
      ]),
    );
  }
  appendFileSync(file, lines.join("\n") + "\n");
}

/** Splits CSV text into raw records (RFC 4180: a quoted field may contain newlines). Raw text is kept verbatim. */
function splitRecords(text: string): { records: string[]; balanced: boolean } {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === "\n" && !quoted) {
      records.push(text.slice(start, i).replace(/\r$/, ""));
      start = i + 1;
    }
  }
  if (start < text.length) records.push(text.slice(start));
  return { records, balanced: !quoted };
}

/**
 * Removes rows older than 180 days (REQ-006), rewriting atomically (temp + rename) and only when something is removed.
 * Rows whose ts cannot be parsed (and a missing header, unterminated quotes, legacy lines) are kept and logged, never
 * dropped. Returns the number of pruned rows. Never throws: a problem is logged and the file is left as is.
 */
export function pruneHistory(
  file: string,
  now: number = Date.now(),
  log: (msg: string) => void = console.error,
): number {
  try {
    if (!existsSync(file)) return 0;
    const { records, balanced } = splitRecords(readFileSync(file, "utf8"));
    if (!balanced) {
      // an unterminated quote would swallow every later row into one record; do not guess, leave the file alone
      log(`history ${file}: unterminated quote, pruning skipped`);
      return 0;
    }
    const cutoff = now - HISTORY_RETENTION_DAYS * 86_400_000;
    let unparsable = 0;
    const kept = records.filter((rec, idx) => {
      if (idx === 0 && rec === HISTORY_HEADER) return true;
      const ts = Date.parse(rec.split(",", 1)[0] ?? "");
      if (Number.isNaN(ts)) {
        unparsable++;
        return true;
      }
      return ts >= cutoff;
    });
    if (unparsable > 0) log(`history ${file}: kept ${unparsable} row(s) with an unparsable ts`);
    const removed = records.length - kept.length;
    if (removed === 0) return 0;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
    renameSync(tmp, file);
    return removed;
  } catch (e) {
    log(`history prune failed (${file}): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
