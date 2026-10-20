import { join } from "node:path";
import { BrowserSession } from "./browser.ts";
import type { BrowserOptions } from "./browser.ts";
import { diff } from "./diff.ts";
import { extract } from "./extractors/selectors.ts";
import { appendHistory } from "./history.ts";
import type { HistoryRow } from "./history.ts";
import { renderMessage } from "./message.ts";
import { notify } from "./notify.ts";
import { matches } from "./rules.ts";
import { loadState, saveState } from "./state.ts";
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
  for (const i of invalid) console.error(`invalid watch ${i.file}: ${i.error}`);

  const statePath = join(cfg.dataDir, "state.json");
  const historyPath = join(cfg.dataDir, "history.csv");
  const state = loadState(statePath);
  const session = new BrowserSession(cfg.browser);
  try {
    for (const watch of watches.filter((w) => w.enabled)) {
      try {
        const offers = await fetchOffers(session, watch);
        const results = offers.map((offer) => ({ offer, ...matches(offer, watch.match) }));
        const matching = results.filter((r) => r.matched);
        const prev = state[watch.id]?.alerted ?? {};
        const { alerts, nextAlerted } = diff(prev, matching);
        appendHistory(historyPath, historyRows(watch, results));
        if (alerts.length > 0) await notify(cfg.notifyCmd, renderMessage(watch.name, alerts));
        state[watch.id] = { broken: state[watch.id]?.broken ?? null, alerted: nextAlerted };
        saveState(statePath, state);
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

async function fetchOffers(session: BrowserSession, watch: Watch): Promise<Offer[]> {
  const offers: Offer[] = [];
  for (const url of watch.urls) offers.push(...(await session.withPage(url, (page) => extract(page, watch))));
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
