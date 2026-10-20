import { join } from "node:path";
import { BrowserSession } from "./browser.ts";
import type { BrowserOptions } from "./browser.ts";
import { diff } from "./diff.ts";
import { ExtractError } from "./errors.ts";
import { extract } from "./extractors/selectors.ts";
import { appendHistory, pruneHistory } from "./history.ts";
import type { HistoryRow } from "./history.ts";
import { alertInvalid } from "./invalid.ts";
import { renderBroken, renderMessage, renderRecovered } from "./message.ts";
import { notify } from "./notify.ts";
import { matches } from "./rules.ts";
import { loadInvalidFiles, loadState, pruneCorruptBackups, saveState } from "./state.ts";
import type { Offer, Watch } from "./types.ts";
import { loadWatches } from "./watches.ts";

export type RunConfig = {
  watchesDir: string;
  dataDir: string;
  notifyCmd: string;
  browser: BrowserOptions;
};

/** Runs all enabled watches. Returns the process exit code (0 = everything fine). */
export async function run(cfg: RunConfig): Promise<number> {
  const { watches, invalid } = loadWatches(cfg.watchesDir);
  let failed = invalid.length > 0;
  for (const i of invalid) console.error(`invalid watch ${i.error}`);

  const statePath = join(cfg.dataDir, "state.json");
  const historyPath = join(cfg.dataDir, "history.csv");
  pruneHistory(historyPath);
  const state = loadState(statePath);
  pruneCorruptBackups(statePath);
  const invalidFiles = await alertInvalid(invalid, loadInvalidFiles(statePath), (m) => notify(cfg.notifyCmd, m));
  saveState(statePath, state, invalidFiles);
  const session = new BrowserSession(cfg.browser);
  const send = (m: string) => notify(cfg.notifyCmd, m);

  /**
   * One watch (REQ-005). Throws when a notification fails (the run then exits 1). State only advances after the matching
   * notify succeeded, so a failed notification is retried next run. A broken watch keeps its `alerted` state.
   */
  async function runWatch(watch: Watch): Promise<void> {
    const prev = state[watch.id] ?? { broken: null, alerted: {} };
    let offers: Offer[];
    try {
      offers = await fetchOffers(session, watch, join(cfg.dataDir, "broken", watch.id));
    } catch (e) {
      if (!(e instanceof ExtractError)) throw e;
      console.error(`watch ${watch.id} is broken: ${e.reason}`);
      appendHistory(historyPath, [{ ts: new Date().toISOString(), watch: watch.id, error: e.reason }]);
      if (prev.broken !== null) return; // already alerted, stay silent until it recovers
      await send(renderBroken(watch.name, e.reason));
      state[watch.id] = { broken: { reason: e.reason, since: new Date().toISOString() }, alerted: prev.alerted };
      saveState(statePath, state, invalidFiles);
      return;
    }
    if (prev.broken !== null) {
      await send(renderRecovered(watch.name));
      state[watch.id] = { broken: null, alerted: prev.alerted };
      saveState(statePath, state, invalidFiles);
    }
    const results = offers.map((offer) => ({ offer, ...matches(offer, watch.match, watch.currency) }));
    const { alerts, nextAlerted } = diff(
      prev.alerted,
      results.filter((r) => r.matched),
    );
    appendHistory(historyPath, historyRows(watch, results));
    if (alerts.length > 0) await send(renderMessage(watch.name, alerts));
    state[watch.id] = { broken: null, alerted: nextAlerted };
    saveState(statePath, state, invalidFiles);
  }

  try {
    for (const watch of watches.filter((w) => w.enabled)) {
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
async function fetchOffers(session: BrowserSession, watch: Watch, snapshotDir: string): Promise<Offer[]> {
  const offers: Offer[] = [];
  for (const url of watch.urls) {
    const found = await session.withPage(
      url,
      async (page) => {
        const list = await extract(page, watch);
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
