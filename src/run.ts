import { join } from "node:path";
import { BrowserSession } from "./browser.ts";
import type { BrowserOptions } from "./browser.ts";
import { diff } from "./diff.ts";
import { ExtractError } from "./errors.ts";
import { extractorFor } from "./extractors/index.ts";
import { appendHistory, pruneHistory } from "./history.ts";
import type { HistoryRow } from "./history.ts";
import { alertInvalid } from "./invalid.ts";
import { renderBroken, renderMessage, renderRecovered } from "./message.ts";
import { notify } from "./notify.ts";
import { matches } from "./rules.ts";
import { loadInvalidFiles, loadState, pruneCorruptBackups, saveState } from "./state.ts";
import type { InvalidFiles } from "./state.ts";
import type { Offer, State, Watch } from "./types.ts";
import { loadWatches } from "./watches.ts";

export type RunConfig = {
  watchesDir: string;
  dataDir: string;
  /** Required unless `dryRun`. */
  notifyCmd?: string | undefined;
  browser: BrowserOptions;
  /** REQ-013: print the messages instead of sending them and change nothing in the data dir (state, history, snapshots). */
  dryRun?: boolean;
  /** REQ-013: run only this watch (it runs even when `enabled: false`). */
  watchId?: string | undefined;
  /** Where dry-run output goes (default stdout). */
  out?: (text: string) => void;
};

/**
 * Runs all enabled watches (or only `watchId`). Returns the process exit code (0 = fine, 1 = a watch/notify failed or
 * a watch file is invalid, 2 = bad usage such as an unknown --watch id).
 *
 * Every side effect goes through `send`, `save`, `record` or the snapshot dir below; in dry run these only print or do
 * nothing, so a dry run cannot change `dataDir`. State is still tracked in memory so the output shows what a real run
 * would send now.
 */
export async function run(cfg: RunConfig): Promise<number> {
  const dryRun = cfg.dryRun === true;
  const out = cfg.out ?? ((t: string) => console.log(t));
  const { notifyCmd } = cfg;
  if (!dryRun && !notifyCmd) throw new Error("notifyCmd is required unless dryRun");
  const { watches: all, invalid } = loadWatches(cfg.watchesDir);
  const only = cfg.watchId;
  let selected = all.filter((w) => w.enabled);
  let toAlert = invalid;
  if (only !== undefined) {
    const bad = invalid.find((i) => i.file === `${only}.yaml`);
    const found = all.find((w) => w.id === only);
    if (bad !== undefined || found === undefined) {
      console.error(
        bad !== undefined
          ? `watch ${only} is invalid: ${bad.error}`
          : `unknown watch "${only}" (known: ${all.map((w) => w.id).join(", ") || "none"})`,
      );
      return 2;
    }
    selected = [found];
    toAlert = []; // a single-watch run does not alert about other files; they are only logged
  }
  let failed = invalid.length > 0 && only === undefined;
  for (const i of invalid) console.error(`invalid watch ${i.error}`);

  const statePath = join(cfg.dataDir, "state.json");
  const historyPath = join(cfg.dataDir, "history.csv");
  const send = async (m: string): Promise<void> => {
    if (dryRun) out(`--- would send ---\n${m}\n--- end ---`);
    else await notify(notifyCmd as string, m);
  };
  const save = (state: State, invalidFiles: InvalidFiles): void => {
    if (!dryRun) saveState(statePath, state, invalidFiles);
  };
  const record = (rows: HistoryRow[]): void => {
    if (!dryRun) appendHistory(historyPath, rows);
  };
  if (!dryRun) {
    pruneHistory(historyPath);
  }
  const state = loadState(statePath, dryRun);
  if (!dryRun) pruneCorruptBackups(statePath);
  const storedInvalid = loadInvalidFiles(statePath, dryRun);
  // a single-watch run keeps the stored invalid-file map as it is
  const invalidFiles = only === undefined ? await alertInvalid(toAlert, storedInvalid, send) : storedInvalid;
  save(state, invalidFiles);
  const session = new BrowserSession(cfg.browser);

  /**
   * One watch (REQ-005). Throws when a notification fails (the run then exits 1). State only advances after the matching
   * notify succeeded, so a failed notification is retried next run. A broken watch keeps its `alerted` state.
   */
  async function runWatch(watch: Watch): Promise<void> {
    const prev = state[watch.id] ?? { broken: null, alerted: {} };
    let offers: Offer[];
    try {
      offers = await fetchOffers(session, watch, dryRun ? undefined : join(cfg.dataDir, "broken", watch.id));
    } catch (e) {
      if (!(e instanceof ExtractError)) throw e;
      console.error(`watch ${watch.id} is broken: ${e.reason}`);
      record([{ ts: new Date().toISOString(), watch: watch.id, error: e.reason }]);
      if (prev.broken !== null) return; // already alerted, stay silent until it recovers
      await send(renderBroken(watch.name, e.reason));
      state[watch.id] = { broken: { reason: e.reason, since: new Date().toISOString() }, alerted: prev.alerted };
      save(state, invalidFiles);
      return;
    }
    if (prev.broken !== null) {
      await send(renderRecovered(watch.name));
      state[watch.id] = { broken: null, alerted: prev.alerted };
      save(state, invalidFiles);
    }
    const results = offers.map((offer) => ({ offer, ...matches(offer, watch.match, watch.currency) }));
    const { alerts, nextAlerted } = diff(
      prev.alerted,
      results.filter((r) => r.matched),
    );
    record(historyRows(watch, results));
    if (alerts.length > 0) await send(renderMessage(watch.name, alerts, watch.urls));
    state[watch.id] = { broken: null, alerted: nextAlerted };
    save(state, invalidFiles);
  }

  try {
    for (const watch of selected) {
      try {
        await runWatch(watch);
      } catch (e) {
        failed = true;
        console.error(`watch ${watch.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await session.close();
  }
  return failed ? 1 : 0;
}

/** Extracts all pages of a watch; an unexpected currency is a broken page too (snapshot is taken inside withPage). */
async function fetchOffers(session: BrowserSession, watch: Watch, snapshotDir: string | undefined): Promise<Offer[]> {
  const offers: Offer[] = [];
  for (const url of watch.urls) {
    const found = await session.withPage(
      url,
      async (page) => {
        const list = await extractorFor(watch.site)(page, watch, {
          visit: (next, fn) => session.withPage(next, fn, snapshotDir),
        });
        const bad = list.find((o) => matches(o, watch.match, watch.currency).currencyMismatch);
        if (bad !== undefined)
          throw new ExtractError(`unexpected currency ${bad.currency} (expected ${watch.currency})`);
        return list;
      },
      snapshotDir,
    );
    offers.push(...found);
  }
  return offers;
}

function historyRows(watch: Watch, results: { offer: Offer; matched: boolean }[]): HistoryRow[] {
  const ts = new Date().toISOString();
  return results.map(({ offer, matched }) => ({
    ts,
    watch: watch.id,
    offerId: offer.id,
    name: offer.name,
    price: offer.price,
    listPrice: offer.listPrice,
    currency: offer.currency,
    sizesAvailable: offer.sizes.filter((s) => s.available).map((s) => s.label),
    matched,
    error: "",
  }));
}
