import type { Page } from "playwright";
import { ExtractError } from "../errors.ts";
import { parsePrice } from "../price.ts";
import { MAX_NAME, sanitizeText } from "../sanitize.ts";
import type { Offer, Watch } from "../types.ts";
import type { CookieSpec } from "../browser.ts";

/*
 * aliexpress.com item page (spike T-002, docs/ARCHITECTURE.md). Best effort: AliExpress may serve a captcha/slider page
 * at any time; that is reported as broken ("blocked", REQ-005 / REQ-012), never worked around (no solving, no proxy).
 *
 * Only typed fields are read from the page: the Product JSON-LD (name, offers.price as a plain decimal, priceCurrency,
 * availability URL) and, as a cross-check, the displayed price. The JSON-LD is parsed as data, nothing is evaluated,
 * no link of the page is followed. The compared price is that of the DEFAULT variant in the Slovak region (ship-to SK,
 * EUR), pinned by AliExpress's own region cookie below; a redirect to another site/region is broken.
 */

/** AliExpress's region/currency cookie: global site, EUR, ship to Slovakia, English UI (T-002). */
export const ALIEXPRESS_COOKIES: CookieSpec[] = [
  { name: "aep_usuc_f", value: "site=glo&c_tp=EUR&region=SK&b_locale=en_US", domain: ".aliexpress.com", path: "/" },
];

const CURRENCY = "EUR";

/** How long to wait for the product data (or a challenge) to show up, and how often to look. */
const SETTLE_MS = 12_000;
const POLL_MS = 1000;

const LD = 'script[type="application/ld+json"]';
const DOM_PRICE = '[class*="price-default--current"]';
/** Elements of AliExpress's anti-bot challenge (baxia / nocaptcha slider). Presence only; their text is never used. */
const BLOCK_SELECTORS = ['[class*="baxia-dialog"]', "#nc_1_wrapper", "#baxia-punish", '[id^="nc_"][id$="_wrapper"]'];
const BLOCK_TITLE = /captcha|verify|punish|security check/i;
/** Text of the challenge dialog (seen 2026-10-22: "We need to check if you are a robot", reCAPTCHA). Only tested, never kept. */
const BLOCK_TEXT = /check if you are a robot|slide to verify|unusual traffic/i;
const BLOCK_URL = /_{3,}tmd_{3,}|\/punish|x5secdata|x5step/i;

/** Strings read from the page; validation happens in parseItem. */
export type RawItem = {
  finalUrl: string;
  /** Text of every JSON-LD script. */
  ld: string[];
  /** Text of the displayed price element, null when absent. */
  domPrice: string | null;
  /** A challenge element or title was found. */
  blocked: boolean;
};

export async function readItemPage(page: Page): Promise<RawItem> {
  const found = await page.evaluate(
    ([ld, price, blockSelectors]) => {
      const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        ld: Array.from(document.querySelectorAll(ld as string)).map((s) => (s.textContent ?? "").slice(0, 200_000)),
        domPrice:
          document.querySelector(price as string) === null ? null : text(document.querySelector(price as string)),
        blockElement: (blockSelectors as string[]).some((s) => document.querySelector(s) !== null),
        title: document.title.slice(0, 200),
        body: (document.body?.innerText ?? "").slice(0, 20_000),
      };
    },
    [LD, DOM_PRICE, BLOCK_SELECTORS],
  );
  return {
    finalUrl: page.url(),
    ld: found.ld,
    domPrice: found.domPrice,
    blocked:
      found.blockElement ||
      BLOCK_TITLE.test(found.title) ||
      BLOCK_TEXT.test(found.body) ||
      page.frames().some((f) => BLOCK_URL.test(f.url())),
  };
}

/** The item id of `/item/<digits>.html`, null for any other url. Query strings (tracking) are ignored. */
export function itemIdOf(url: string): string | null {
  try {
    return /^\/item\/(\d{5,20})\.html$/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function* ldNodes(texts: string[]): Generator<Record<string, unknown>> {
  for (const t of texts) {
    let doc: unknown;
    try {
      doc = JSON.parse(t);
    } catch {
      continue;
    }
    for (const n of Array.isArray(doc) ? doc : [doc]) if (isObject(n)) yield n;
  }
}

function availabilityOf(value: unknown): boolean {
  const v = typeof value === "string" ? /^https?:\/\/schema\.org\/(\w+)$/.exec(value)?.[1] : undefined;
  if (v === "InStock" || v === "LimitedAvailability" || v === "OnlineOnly") return true;
  if (v === "OutOfStock" || v === "SoldOut" || v === "Discontinued") return false;
  throw new ExtractError("item page: availability missing or unknown");
}

/** Pure. Page strings -> offer; ExtractError (broken) for a block page, a redirect or anything unexpected. */
export function parseItem(raw: RawItem, requestedUrl: string): Offer {
  const id = itemIdOf(requestedUrl);
  if (id === null) throw new ExtractError("watch url is not an AliExpress item url (/item/<id>.html)");
  if (raw.blocked || BLOCK_URL.test(raw.finalUrl))
    throw new ExtractError("blocked (AliExpress captcha/verification page)");

  const want = new URL(requestedUrl);
  const final = new URL(raw.finalUrl);
  if (final.origin !== want.origin || itemIdOf(raw.finalUrl) !== id)
    throw new ExtractError(
      `redirected to ${sanitizeText(final.host + final.pathname, 80)} instead of the requested item`,
    );

  const product = Array.from(ldNodes(raw.ld)).find((n) => n["@type"] === "Product");
  if (product === undefined) throw new ExtractError("no Product data on the page (blocked or changed)");
  const offerNode = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (!isObject(offerNode)) throw new ExtractError("no offer data on the page (blocked or changed)");

  const rawPrice = offerNode.price;
  if (typeof rawPrice !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(rawPrice) || Number(rawPrice) <= 0)
    throw new ExtractError("item page: price unreadable");
  const price = Number(rawPrice);
  if (offerNode.priceCurrency !== CURRENCY)
    throw new ExtractError(
      `item page: unexpected currency ${sanitizeText(String(offerNode.priceCurrency ?? "none"), 10)} (expected ${CURRENCY})`,
    );
  if (typeof product.name !== "string" || sanitizeText(product.name, MAX_NAME) === "")
    throw new ExtractError("item page: name missing");

  if (raw.domPrice !== null) {
    let shown: number | undefined;
    try {
      shown = parsePrice(raw.domPrice).amount;
    } catch {
      shown = undefined;
    }
    if (shown !== price) throw new ExtractError("item page: displayed price does not match the product data");
  }

  return {
    id,
    name: sanitizeText(product.name, MAX_NAME),
    url: `${want.origin}/item/${id}.html`,
    price,
    currency: CURRENCY,
    sizes: [],
    inStock: availabilityOf(offerNode.availability),
  };
}

export async function extract(page: Page, watch: Watch): Promise<Offer[]> {
  // The JSON-LD is in the HTML on a good day; on a challenged page it never comes. Poll until it is there or a challenge
  // shows (so a block page is reported quickly), at most SETTLE_MS; parseItem judges what is there.
  const deadline = Date.now() + SETTLE_MS;
  let raw = await readItemPage(page);
  while (raw.ld.length === 0 && !raw.blocked && Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    raw = await readItemPage(page);
  }
  // The url that was asked for: the watch url naming the item the page ended up on, else the first one (-> "redirected").
  const finalId = itemIdOf(raw.finalUrl);
  const requested = watch.urls.find((u) => itemIdOf(u) === finalId) ?? watch.urls[0];
  if (requested === undefined) throw new ExtractError("watch has no url");
  return [parseItem(raw, requested)];
}
