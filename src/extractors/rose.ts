import type { Page } from "playwright";
import { ExtractError } from "../errors.ts";
import { parsePrice } from "../price.ts";
import { matches } from "../rules.ts";
import { MAX_NAME, sanitizeText } from "../sanitize.ts";
import type { Offer, Watch } from "../types.ts";
import type { ExtractContext } from "./index.ts";

/*
 * rosebikes.com sale listing (spike T-001, docs/ARCHITECTURE.md). Only typed fields are read from the pages (a SKU made
 * of digits, plain texts that are parsed or sanitized and capped, traffic light colours from a fixed set); nothing from
 * a page is evaluated or followed except links on the listing's own origin.
 *
 * Flow: listing pages (follow "next" links) -> filter candidates by everything the listing shows (name, price,
 * discount) -> one product page per candidate: click each wanted frame size and read the traffic lights per colour.
 * A size is available only when some colour is GREEN (in stock, delivery in days); yellow (orderable, delivery in
 * weeks) is mentioned in the offer note only.
 */

const MAX_LISTING_PAGES = 10;
/** The product page loads its availability asynchronously after a size is chosen (~2 s measured in T-001). */
const SETTLE_MS = 2000;
const MAX_SIZE_LABEL = 40;
const MAX_NOTE = 200;

const SIZE_LABEL = 'label:has(input[name="bike-select-size"])';
const COLOUR_LIGHT = '[data-test^="bike-step-value-color-"] [data-test="product-availability"]';

/** Strings read from one listing page; parsing and validation happen in parseListing. */
export type RawListing = {
  count: string;
  nextHref: string | null;
  tiles: { sku: string; name: string; price: string; listPrice: string | null; href: string | null }[];
};

export type ListingTile = {
  sku: string;
  name: string;
  url: string;
  price: number;
  listPrice?: number;
  currency: string;
};

export type ParsedListing = { total: number; tiles: ListingTile[]; nextUrl: string | null };

export type Light = "green" | "yellow" | "red" | "other";
export type SizeCheck = { label: string; lights: Light[] };

/** null when the result counter (the page marker) is missing. */
export async function readListing(page: Page): Promise<RawListing | null> {
  return page.evaluate(() => {
    const marker = document.querySelector('[data-test="catalog-result"]');
    if (marker === null) return null;
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const next = document.querySelector('a[data-test="pagination-next-link"]');
    return {
      count: text(marker.querySelector("strong")),
      nextHref: next?.getAttribute("href") ?? null,
      tiles: Array.from(document.querySelectorAll("catalog-product-tile")).map((tile) => {
        const title = tile.querySelector('[data-test="catalog-product-tile__title"]')?.cloneNode(true);
        if (title instanceof Element) title.querySelector(".product-tile-title__brand")?.remove();
        const old = tile.querySelector(".product-tile-price__old-value");
        return {
          sku: tile.getAttribute("data-test-abstract-sku") ?? "",
          name: text(title instanceof Element ? title : null),
          price: text(tile.querySelector(".product-tile-price__current-value")),
          listPrice: old === null ? null : text(old),
          href: tile.querySelector("a.catalog-product-tile__link")?.getAttribute("href") ?? null,
        };
      }),
    };
  });
}

function sameOriginUrl(href: string, base: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    throw new ExtractError(`${what} is not a valid link`);
  }
  if (u.origin !== new URL(base).origin) throw new ExtractError(`${what} leaves the shop's domain`);
  return u;
}

/** Pure. Validates and converts the raw strings; ExtractError when the page does not have the expected structure. */
export function parseListing(raw: RawListing, pageUrl: string): ParsedListing {
  if (!/^\d{1,6}$/.test(raw.count)) throw new ExtractError("result counter unreadable");
  const total = Number(raw.count);
  if (total > 0 && raw.tiles.length === 0) throw new ExtractError(`counter says ${total} results but no tiles found`);
  const tiles = raw.tiles.map((t): ListingTile => {
    if (!/^\d{1,12}$/.test(t.sku)) throw new ExtractError("product tile without a numeric sku");
    if (t.href === null || t.href === "") throw new ExtractError(`product link missing (sku ${t.sku})`);
    const link = sameOriginUrl(t.href, pageUrl, `product link (sku ${t.sku})`);
    const price = readPrice(t.price, `price (sku ${t.sku})`);
    const list =
      t.listPrice === null || t.listPrice === "" ? undefined : readPrice(t.listPrice, `list price (sku ${t.sku})`);
    return {
      sku: t.sku,
      name: sanitizeText(t.name, MAX_NAME),
      url: link.origin + link.pathname,
      price,
      ...(list === undefined ? {} : { listPrice: list }),
      currency: "EUR",
    };
  });
  const nextUrl = raw.nextHref === null ? null : sameOriginUrl(raw.nextHref, pageUrl, "next page link").href;
  return { total, tiles, nextUrl };
}

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

/** "59cm" -> "59" (watch files use the bare number); other labels are only trimmed and capped. */
export function normalizeSize(label: string): string {
  const t = sanitizeText(label, MAX_SIZE_LABEL);
  const m = /^(\d+(?:[.,]\d+)?)\s*cm$/i.exec(t);
  return m === null ? t : (m[1] as string);
}

/** Page labels to check: the configured sizes (compared normalised, case-insensitive); all labels when none are configured. */
export function wantedSizes(pageLabels: string[], configured: string[] | undefined): string[] {
  if (configured === undefined || configured.length === 0) return pageLabels;
  const wanted = configured.map((s) => normalizeSize(s).toLowerCase());
  return pageLabels.filter((l) => wanted.includes(normalizeSize(l).toLowerCase()));
}

/** Green in any colour = available. Yellow without green = orderable (delivery in weeks) but NOT available. */
export function sizeStatus(lights: Light[]): { available: boolean; orderable: boolean } {
  const available = lights.includes("green");
  return { available, orderable: !available && lights.includes("yellow") };
}

/** Pure: listing tile (+ checked sizes of its product page, null when not checked) -> offer. */
export function buildOffer(tile: ListingTile, checks: SizeCheck[] | null): Offer {
  const sizes = (checks ?? []).map((c) => ({
    label: normalizeSize(c.label),
    available: sizeStatus(c.lights).available,
  }));
  const weeks = (checks ?? []).filter((c) => sizeStatus(c.lights).orderable).map((c) => normalizeSize(c.label));
  const note =
    weeks.length === 0
      ? undefined
      : sanitizeText(`orderable with delivery in weeks, not counted as available: ${weeks.join(", ")}`, MAX_NOTE);
  return {
    id: tile.sku,
    name: tile.name,
    url: tile.url,
    price: tile.price,
    ...(tile.listPrice === undefined ? {} : { listPrice: tile.listPrice }),
    currency: tile.currency,
    sizes,
    inStock: checks === null || sizes.some((s) => s.available),
    ...(note === undefined ? {} : { note }),
  };
}

/** Frame size choices of a product page (labels are page text: capped). */
export async function readSizes(page: Page): Promise<{ label: string; disabled: boolean }[]> {
  const found = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((label) => {
      const input = label.querySelector<HTMLInputElement>('input[name="bike-select-size"]');
      return {
        label: input?.value ?? "",
        disabled:
          input?.disabled === true || label.hasAttribute("disabled") || label.getAttribute("aria-disabled") === "true",
      };
    });
  }, SIZE_LABEL);
  return found.map((s) => ({ label: sanitizeText(s.label, MAX_SIZE_LABEL), disabled: s.disabled }));
}

/** Traffic light of every colour for the size that is currently chosen (only a fixed set of values is passed on). */
export async function readLights(page: Page): Promise<Light[]> {
  const raw = await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).map((el) => el.getAttribute("data-test-traffic-light-color") ?? ""),
    COLOUR_LIGHT,
  );
  return raw.map((c): Light => (c === "green" || c === "yellow" || c === "red" ? c : "other"));
}

/**
 * The live site shows a Usercentrics consent dialog (open shadow root) that sits on top of the size buttons and
 * intercepts clicks. Choose the minimal option ("Reject") if it is there; never "Agree". Nothing to do when absent.
 */
export async function dismissConsent(page: Page): Promise<void> {
  const reject = page.locator("#usercentrics-cmp-ui button#deny");
  if ((await reject.count()) === 0) return;
  await reject.click();
  await reject.waitFor({ state: "detached" }).catch(() => undefined);
}

/** Product page: choose each wanted size (UI state only, nothing is added to a cart) and read the lights. */
async function checkSizes(page: Page, configured: string[] | undefined): Promise<SizeCheck[]> {
  try {
    await page.waitForSelector('input[name="bike-select-size"]', { state: "attached" });
  } catch {
    throw new ExtractError("product page: frame size choice not found");
  }
  await dismissConsent(page);
  const sizes = await readSizes(page);
  const checks: SizeCheck[] = [];
  for (const label of wantedSizes(
    sizes.map((s) => s.label),
    configured,
  )) {
    const index = sizes.findIndex((s) => s.label === label);
    if (sizes[index]?.disabled === true) {
      checks.push({ label, lights: [] }); // cannot even be chosen: not available
      continue;
    }
    await dismissConsent(page); // it may show up late
    await page.locator(SIZE_LABEL).nth(index).click();
    await page.waitForTimeout(SETTLE_MS);
    const lights = await readLights(page);
    if (lights.length === 0)
      throw new ExtractError(`product page: no colour availability after choosing size ${label}`);
    checks.push({ label, lights });
  }
  return checks;
}

async function readParsed(page: Page): Promise<ParsedListing> {
  const raw = await readListing(page);
  if (raw === null) throw new ExtractError('page marker not found: [data-test="catalog-result"]');
  return parseListing(raw, page.url());
}

export async function extract(page: Page, watch: Watch, ctx: ExtractContext): Promise<Offer[]> {
  let parsed = await readParsed(page);
  const tiles = [...parsed.tiles];
  for (let n = 1; parsed.nextUrl !== null; n++) {
    if (n >= MAX_LISTING_PAGES) throw new ExtractError(`more than ${MAX_LISTING_PAGES} listing pages`);
    parsed = await ctx.visit(parsed.nextUrl, readParsed);
    tiles.push(...parsed.tiles);
  }
  const seen = new Set<string>();
  const unique = tiles.filter((t) => !seen.has(t.sku) && seen.add(t.sku));

  // Candidates: everything the listing can decide; only these cost a product page visit.
  const withoutSizes = { ...watch.match };
  delete withoutSizes.sizes;
  const offers: Offer[] = [];
  for (const tile of unique) {
    const plain = buildOffer(tile, null);
    if (!matches(plain, withoutSizes, watch.currency).matched) {
      offers.push(plain);
      continue;
    }
    const checks = await ctx.visit(tile.url, (p) => checkSizes(p, watch.match.sizes));
    offers.push(buildOffer(tile, checks));
  }
  return offers;
}
