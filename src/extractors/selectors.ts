import type { Page } from "playwright";
import { ExtractError } from "../errors.ts";
import { parsePrice } from "../price.ts";
import { MAX_NAME, sanitizeText } from "../sanitize.ts";
import type { ExtractContext } from "./index.ts";
import type { Offer, Selectors, Size, Watch } from "../types.ts";

/** Typed strings read from the page; the page is untrusted, so nothing else is taken from it. */
export type RawOffer = {
  name: string;
  price: string;
  listPrice: string | null;
  link: string | null;
  sizes: Size[];
  outOfStock: boolean;
};

const MAX_SIZE_LABEL = 40;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const TRACKING_PARAM =
  /^(utm_.*|gclid|dclid|fbclid|msclkid|yclid|gbraid|wbraid|mc_cid|mc_eid|_ga|_gl|ref|ref_.*|referrer|sid|sessionid|session_id|cid|trk|tracking.*)$/i;

/**
 * Stable offer id from a link: no fragment, tracking/session parameters dropped, remaining parameters sorted. A shop
 * that adds per-visit tracking parameters must not make every offer "new" each day. Parameters that may identify the
 * product (`?pid=7`) are kept. The URL shown to the user is not changed.
 */
export function stableId(u: URL): string {
  const id = new URL(u.href);
  id.hash = "";
  const kept = [...id.searchParams]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  id.search = "";
  for (const [k, v] of kept) id.searchParams.append(k, v);
  return id.href;
}

/** Pure: raw strings -> offers. Offer id derives from the link (see stableId). */
export function buildOffers(raws: RawOffer[], watchCurrency: string, pageUrl: string): Offer[] {
  return raws.map((raw) => {
    const name = sanitizeText(raw.name, MAX_NAME);
    const price = parsePrice(raw.price);
    const list = raw.listPrice === null || clean(raw.listPrice) === "" ? undefined : parsePrice(raw.listPrice);
    let url = pageUrl;
    let id = `${pageUrl}#${slug(name)}`;
    if (raw.link) {
      const u = new URL(raw.link, pageUrl);
      u.hash = "";
      url = u.href;
      id = stableId(u);
    }
    const sizes = raw.sizes.map((s) => ({ label: sanitizeText(s.label, MAX_SIZE_LABEL), available: s.available }));
    const inStock = !raw.outOfStock && (sizes.length === 0 || sizes.some((s) => s.available));
    return {
      id,
      name,
      url,
      price: price.amount,
      ...(list === undefined ? {} : { listPrice: list.amount }),
      currency: price.currency ?? watchCurrency,
      sizes,
      inStock,
    };
  });
}

export async function extract(page: Page, watch: Watch, _ctx?: ExtractContext): Promise<Offer[]> {
  const selectors = watch.selectors;
  if (selectors === undefined) throw new ExtractError("selectors missing in watch");
  const pageUrl = page.url();
  const found = await readPage(page, selectors);
  if (found === null) throw new ExtractError(`page marker not found: ${selectors.pageMarker}`);
  return buildOffers(found, watch.currency, pageUrl);
}

async function readPage(page: Page, s: Selectors): Promise<RawOffer[] | null> {
  return page.evaluate((sel) => {
    if (document.querySelector(sel.pageMarker) === null) return null;
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll(sel.item)).map((item) => {
      const link = sel.link ? item.querySelector(sel.link) : null;
      const listPrice = sel.listPrice ? item.querySelector(sel.listPrice) : null;
      return {
        name: text(item.querySelector(sel.name)),
        price: text(item.querySelector(sel.price)),
        listPrice: listPrice ? text(listPrice) : null,
        link: link instanceof HTMLAnchorElement ? link.href : null,
        sizes: sel.sizes
          ? Array.from(item.querySelectorAll(sel.sizes)).map((el) => ({
              label: text(el),
              available: !el.classList.contains("unavailable"),
            }))
          : [],
        outOfStock: item.classList.contains("out-of-stock"),
      };
    });
  }, s);
}
