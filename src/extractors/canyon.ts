import type { Page } from "playwright";
import { ExtractError } from "../errors.ts";
import { parsePrice } from "../price.ts";
import { matches } from "../rules.ts";
import { MAX_NAME, sanitizeText } from "../sanitize.ts";
import type { Offer, Size, Watch } from "../types.ts";
import { dismissCookieBanner } from "./consent.ts";
import type { ExtractContext } from "./index.ts";

/*
 * canyon.com en-sk category pages (spike T-001, docs/ARCHITECTURE.md). Server-rendered; only typed fields are read from
 * the pages (a numeric model id taken from the product link, prices parsed from the shown text, sanitized and capped
 * names, size labels, class tokens) and nothing from a page is evaluated or followed except same-origin links.
 *
 * Flow: category page (one page; the counter must equal the grid tiles) -> filter candidates by everything the listing
 * shows (name, price, discount) -> product pages of the candidates, one per colour (availability is per colour): a size
 * is available when some colour has it purchasable.
 *
 * Redirects: Canyon answers a filter that matches nothing (or an unknown one) with HTTP 200 and the parent category.
 * Every page is therefore checked against the url that was asked for; a different page is broken (REQ-005), never read.
 */

const MAX_VARIANTS = 8;
const MAX_SIZE_LABEL = 40;
/** How long to wait for a cookie banner on the first (listing) page. */
const CONSENT_WAIT_MS = 1500;

const GRID = "ul.productGrid__list";
const COUNTER = ".productFilters__countResults .js-productCount";
const SIZE_BUTTON = 'ul.productConfiguration__optionsList[data-attribute-type="size"] button[data-product-size]';
const SIZE_LIST = 'ul.productConfiguration__optionsList[data-attribute-type="size"]';

/** Strings read from the listing page; parsing and validation happen in parseListing. */
export type RawListing = {
  count: string;
  tiles: {
    href: string | null;
    name: string;
    price: string;
    listPrice: string | null;
    variantHrefs: string[];
  }[];
};

export type ListingTile = {
  /** Canyon model id from the product url (e.g. 4427): the same for every colour, unlike data-pid. */
  id: string;
  name: string;
  /** Product page without query string. */
  url: string;
  price: number;
  listPrice?: number;
  currency: string;
  /** Product page urls to read sizes from: the tile's default colour first, then the other colours. */
  variantUrls: string[];
};

export type ParsedListing = { total: number; tiles: ListingTile[] };
export type SizeButton = { label: string; purchasable: boolean };

/** null when the page marker (product grid and numeric counter element) is missing. */
export async function readListing(page: Page): Promise<RawListing | null> {
  return page.evaluate(
    ([grid, counter]) => {
      const list = document.querySelector(grid as string);
      const count = document.querySelector(counter as string);
      if (list === null || count === null) return null;
      const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      // Selected by the tile context, not by containment: the carousels ("slider") are the tiles to leave out. (The saved
      // fixtures, re-parsed from serialized HTML, do not nest the tiles under the <ul> any more.)
      const tiles = Array.from(document.querySelectorAll('div[data-product-tile-context="grid"][data-pid]'));
      return {
        count: text(count),
        tiles: tiles.map((tile) => {
          const link = tile.querySelector("a.productTileDefault__productName");
          const old = tile.querySelector(".productTile__priceOriginal");
          return {
            href: link?.getAttribute("href") ?? null,
            name: text(link),
            price: text(tile.querySelector(".productTile__priceSale")),
            listPrice: old === null ? null : text(old),
            variantHrefs: Array.from(tile.querySelectorAll("[data-pdp-url]")).map(
              (el) => el.getAttribute("data-pdp-url") ?? "",
            ),
          };
        }),
      };
    },
    [GRID, COUNTER],
  );
}

function readUrl(href: string, base: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    throw new ExtractError(`${what} is not a valid link`);
  }
  if (u.origin !== new URL(base).origin) throw new ExtractError(`${what} leaves the shop's domain`);
  return u;
}

const modelIdOf = (u: URL): string | null => /\/(\d{3,8})\.html$/.exec(u.pathname)?.[1] ?? null;

function readPrice(text: string, what: string): number {
  let parsed;
  try {
    parsed = parsePrice(text);
  } catch {
    throw new ExtractError(`${what} unreadable`);
  }
  if (parsed.currency !== "EUR")
    throw new ExtractError(`${what}: unexpected currency ${parsed.currency ?? "none"} (expected EUR)`);
  return parsed.amount;
}

/** Pure. Validates and converts the raw strings; ExtractError when the page does not have the expected structure. */
export function parseListing(raw: RawListing, pageUrl: string): ParsedListing {
  if (!/^\d{1,6}$/.test(raw.count)) throw new ExtractError("result counter unreadable");
  const total = Number(raw.count);
  if (total !== raw.tiles.length)
    throw new ExtractError(`counter says ${total} results but the page has ${raw.tiles.length} tiles`);
  const seen = new Set<string>();
  const tiles: ListingTile[] = [];
  for (const t of raw.tiles) {
    if (t.href === null || t.href === "") throw new ExtractError("product link missing");
    const link = readUrl(t.href, pageUrl, "product link");
    const id = modelIdOf(link);
    if (id === null) throw new ExtractError("product link without a model id");
    if (seen.has(id)) continue;
    seen.add(id);
    const price = readPrice(t.price, `price (model ${id})`);
    const list =
      t.listPrice === null || t.listPrice === "" ? undefined : readPrice(t.listPrice, `list price (model ${id})`);
    const variants = new Set<string>([link.href]);
    for (const href of t.variantHrefs) {
      if (variants.size >= MAX_VARIANTS) break;
      try {
        const v = new URL(href, pageUrl);
        if (v.origin === link.origin && modelIdOf(v) === id) variants.add(v.href);
      } catch {
        // not a link: skipped
      }
    }
    tiles.push({
      id,
      name: sanitizeText(t.name, MAX_NAME),
      url: link.origin + link.pathname,
      price,
      ...(list === undefined ? {} : { listPrice: list }),
      currency: "EUR",
      variantUrls: [...variants],
    });
  }
  return { total, tiles };
}

const trimPath = (p: string) => p.replace(/\/+$/, "");

/**
 * The page that was loaded must be one of the pages asked for: same origin and path (trailing slash ignored), and every
 * query parameter of the request (a filter) still present. Canyon redirects with HTTP 200 otherwise.
 */
export function assertRequestedUrl(finalUrl: string, requested: string[]): void {
  const final = new URL(finalUrl);
  const ok = requested.some((r) => {
    const want = new URL(r);
    if (want.origin !== final.origin || trimPath(want.pathname) !== trimPath(final.pathname)) return false;
    return Array.from(want.searchParams).every(([k, v]) => final.searchParams.getAll(k).includes(v));
  });
  if (!ok) throw new ExtractError(`redirected to ${sanitizeText(final.pathname, 80)} instead of the requested page`);
}

/** A product page must still be the model it was linked as (a removed product redirects to a category). */
export function assertProductUrl(finalUrl: string, id: string): void {
  if (modelIdOf(new URL(finalUrl)) !== id) {
    throw new ExtractError(
      `product page for model ${id} redirected to ${sanitizeText(new URL(finalUrl).pathname, 80)}`,
    );
  }
}

/** Size buttons of a product page (labels are page text: capped). Availability = the whole class token `--purchasable`. */
export async function readSizeButtons(page: Page): Promise<SizeButton[]> {
  const found = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((b) => ({
      label: b.getAttribute("data-product-size") ?? "",
      purchasable: b.classList.contains("productConfiguration__selectVariant--purchasable"),
    }));
  }, SIZE_BUTTON);
  return found.map((s) => ({ label: sanitizeText(s.label, MAX_SIZE_LABEL), purchasable: s.purchasable }));
}

/** A size is available when any colour has it purchasable; labels in order of first appearance. */
export function mergeSizes(perColour: SizeButton[][]): Size[] {
  const merged = new Map<string, boolean>();
  for (const colour of perColour)
    for (const s of colour) {
      if (s.label === "") continue;
      merged.set(s.label, (merged.get(s.label) ?? false) || s.purchasable);
    }
  return Array.from(merged, ([label, available]) => ({ label, available }));
}

/** Pure: listing tile (+ sizes from its product pages, null when not checked) -> offer. */
export function buildOffer(
  tile: Omit<ListingTile, "variantUrls"> & { variantUrls?: string[] },
  sizes: Size[] | null,
): Offer {
  const list = sizes ?? [];
  return {
    id: tile.id,
    name: tile.name,
    url: tile.url,
    price: tile.price,
    ...(tile.listPrice === undefined ? {} : { listPrice: tile.listPrice }),
    currency: tile.currency,
    sizes: list,
    inStock: sizes === null || list.some((s) => s.available),
  };
}

async function readParsed(page: Page, watch: Watch): Promise<ParsedListing> {
  await dismissCookieBanner(page, CONSENT_WAIT_MS);
  assertRequestedUrl(page.url(), watch.urls);
  const raw = await readListing(page);
  if (raw === null) throw new ExtractError(`page marker not found: ${GRID} with ${COUNTER}`);
  return parseListing(raw, page.url());
}

/** One product page (one colour): its size buttons. */
async function readProductSizes(page: Page, id: string): Promise<SizeButton[]> {
  assertProductUrl(page.url(), id);
  await dismissCookieBanner(page, 0);
  try {
    await page.waitForSelector(SIZE_LIST, { state: "attached" });
  } catch {
    throw new ExtractError("product page: size list not found");
  }
  const buttons = await readSizeButtons(page);
  if (buttons.length === 0) throw new ExtractError("product page: no sizes listed");
  return buttons;
}

export async function extract(page: Page, watch: Watch, ctx: ExtractContext): Promise<Offer[]> {
  const { tiles } = await readParsed(page, watch);

  // Candidates: everything the listing can decide; only these cost product page visits.
  const withoutSizes = { ...watch.match };
  delete withoutSizes.sizes;
  const offers: Offer[] = [];
  for (const tile of tiles) {
    const plain = buildOffer(tile, null);
    if (!matches(plain, withoutSizes, watch.currency).matched) {
      offers.push(plain);
      continue;
    }
    const perColour: SizeButton[][] = [];
    for (const url of tile.variantUrls) perColour.push(await ctx.visit(url, (p) => readProductSizes(p, tile.id)));
    offers.push(buildOffer(tile, mergeSizes(perColour)));
  }
  return offers;
}
