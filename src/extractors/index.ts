import type { Page } from "playwright";
import type { Offer, Watch } from "../types.ts";
import { extract as extractCanyon } from "./canyon.ts";
import { extract as extractRose } from "./rose.ts";
import { extract as extractSelectors } from "./selectors.ts";

/**
 * What an extractor may do besides reading the page it is given: open further pages of the same watch (pagination,
 * product pages). Each visit goes through the browser session, so it gets the same timeout, the polite delay between
 * pages and a failure snapshot.
 */
export type ExtractContext = {
  visit<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T>;
};

/** Reads one listing page of a watch. Throws ExtractError for missing structure or block pages (REQ-005). */
export type Extractor = (page: Page, watch: Watch, ctx: ExtractContext) => Promise<Offer[]>;

/** Keyed by the watch's `site` (keep in sync with KNOWN_SITES in watches.ts; a unit test checks it). */
export const EXTRACTORS: Record<string, Extractor> = {
  selectors: extractSelectors,
  rose: extractRose,
  canyon: extractCanyon,
};

export function extractorFor(site: string): Extractor {
  const found = Object.hasOwn(EXTRACTORS, site) ? EXTRACTORS[site] : undefined;
  if (found === undefined) throw new Error(`no extractor for site "${site}"`);
  return found;
}
