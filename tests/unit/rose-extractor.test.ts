import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { ExtractError } from "../../src/errors.ts";
import {
  buildOffer,
  dismissConsent,
  normalizeSize,
  parseListing,
  readLights,
  readListing,
  readSizes,
  sizeStatus,
  wantedSizes,
} from "../../src/extractors/rose.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/rose/${name}`, import.meta.url), "utf8");
const LISTING_URL = "https://www.rosebikes.com/sale/bikes?sf=1";

describe("rose extractor on the recorded fixtures", () => {
  let browser: Browser;
  let page: Page;
  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  after(async () => {
    await browser.close();
  });
  const load = (name: string) => page.setContent(fixture(name));

  test("listing: counter, six tiles with SKU, trimmed name, prices and stable product url", async () => {
    await load("sale-listing.html");
    const raw = await readListing(page);
    assert.notEqual(raw, null);
    const parsed = parseListing(raw!, LISTING_URL);
    assert.equal(parsed.total, 63);
    assert.deepEqual(
      parsed.tiles.map((t) => [t.sku, t.name, t.price, t.listPrice, t.currency]),
      [
        ["2709984", "Backroad FF GRX RX825 Di2", 4000, 4500, "EUR"],
        ["2723816", "Backroad FF Force XPLR AXS", 4450, 5000, "EUR"],
        ["2715089", "Blend Gravel", 1300, 1400, "EUR"],
        ["2723845", "Blend Road", 1200, 1300, "EUR"],
        ["2719082", "Backroad GRX RX820 1x12", 2099, 2799, "EUR"],
        ["160226", "Backroad AL Plus Cues", 3300, 3500, "EUR"],
      ],
    );
    assert.equal(parsed.tiles[0]?.url, "https://www.rosebikes.com/p/rose-backroad-ff-grx-rx825-di2-2709984");
  });

  test("listing: the next-page link is resolved against the page url", async () => {
    await load("sale-listing.html");
    const parsed = parseListing((await readListing(page))!, LISTING_URL);
    assert.equal(parsed.nextUrl, "https://www.rosebikes.com/sale/bikes?sf=1&page=2");
  });

  test("listing: a real empty result (counter 0, no tiles) parses to zero tiles and is not an error", async () => {
    await load("sale-listing-empty.html");
    const parsed = parseListing((await readListing(page))!, LISTING_URL);
    assert.equal(parsed.total, 0);
    assert.deepEqual(parsed.tiles, []);
    assert.equal(parsed.nextUrl, null);
  });

  test("listing: a page without the result counter has no structure (readListing returns null)", async () => {
    await page.setContent("<html><body><h1>Maintenance</h1></body></html>");
    assert.equal(await readListing(page), null);
  });

  test("consent banner (Usercentrics, open shadow root, seen on the live site): 'Reject' is clicked, 'Agree' never", async () => {
    await page.setContent(`<div id="usercentrics-cmp-ui"></div><script>
      const root = document.getElementById("usercentrics-cmp-ui").attachShadow({ mode: "open" });
      root.innerHTML = '<button id="accept">Agree</button><button id="deny">Reject</button>';
      root.getElementById("accept").onclick = () => (window.choice = "accept");
      root.getElementById("deny").onclick = () => (window.choice = "deny");
    </script>`);
    await dismissConsent(page);
    assert.equal(await page.evaluate(() => (window as unknown as { choice?: string }).choice), "deny");
  });

  test("no consent banner: nothing to dismiss and no waiting", async () => {
    await load("product-size-s.html");
    const started = Date.now();
    await dismissConsent(page);
    assert.ok(Date.now() - started < 1000);
  });

  test("product page: size labels", async () => {
    await load("product-size-xs.html");
    assert.deepEqual(
      (await readSizes(page)).map((s) => s.label),
      ["XS", "S", "M", "M/L", "L", "XL"],
    );
  });

  test("product page after choosing XS: no green colour, so XS is not available (yellow is only a note)", async () => {
    await load("product-size-xs.html");
    const lights = await readLights(page);
    assert.ok(lights.includes("yellow"));
    assert.ok(!lights.includes("green"));
    assert.deepEqual(sizeStatus(lights), { available: false, orderable: true });
  });

  test("product page after choosing S: three green colours and two sold out", async () => {
    await load("product-size-s.html");
    const lights = await readLights(page);
    assert.equal(lights.filter((l) => l === "green").length, 3);
    assert.equal(lights.filter((l) => l === "red").length, 2);
    assert.deepEqual(sizeStatus(lights), { available: true, orderable: false });
  });
});

describe("rose pure helpers", () => {
  const tile = {
    sku: "2709984",
    name: "Backroad FF GRX RX825 Di2",
    url: "https://www.rosebikes.com/p/rose-backroad-ff-grx-rx825-di2-2709984",
    price: 4000,
    listPrice: 4500,
    currency: "EUR",
  };
  const raw = (over: Record<string, unknown> = {}) => ({
    count: "63",
    nextHref: null,
    tiles: [{ sku: "1", name: " Rose Bike ", price: "€1,000.00", listPrice: "€1,500.00", href: "/p/rose-bike-1" }].map(
      (t) => ({ ...t, ...over }),
    ),
  });

  test("normalizeSize turns frame sizes in cm into the bare number and leaves letters alone", () => {
    assert.equal(normalizeSize("59cm"), "59");
    assert.equal(normalizeSize(" 53 CM "), "53");
    assert.equal(normalizeSize("XS"), "XS");
    assert.equal(normalizeSize("M/L"), "M/L");
    assert.equal(normalizeSize('19"'), '19"');
  });

  test("wantedSizes: configured sizes pick page labels case-insensitively, normalised; none configured = all", () => {
    const labels = ["XS", "S", "M", "59cm"];
    assert.deepEqual(wantedSizes(labels, ["xs", "S", "59"]), ["XS", "S", "59cm"]);
    assert.deepEqual(wantedSizes(labels, undefined), labels);
    assert.deepEqual(wantedSizes(labels, []), labels);
    assert.deepEqual(wantedSizes(labels, ["XXL"]), []);
  });

  test("sizeStatus: green wins, yellow alone is orderable but not available, red or nothing is neither", () => {
    assert.deepEqual(sizeStatus(["yellow", "green"]), { available: true, orderable: false });
    assert.deepEqual(sizeStatus(["yellow", "red"]), { available: false, orderable: true });
    assert.deepEqual(sizeStatus(["red", "red"]), { available: false, orderable: false });
    assert.deepEqual(sizeStatus(["other"]), { available: false, orderable: false });
  });

  test("buildOffer: id is the SKU, availability counts green only, yellow sizes go into the note", () => {
    const o = buildOffer(tile, [
      { label: "XS", lights: ["yellow", "red"] },
      { label: "S", lights: ["green", "red"] },
      { label: "59cm", lights: ["red"] },
    ]);
    assert.equal(o.id, "2709984");
    assert.deepEqual(o.sizes, [
      { label: "XS", available: false },
      { label: "S", available: true },
      { label: "59", available: false },
    ]);
    assert.equal(o.inStock, true);
    assert.equal(o.note, "orderable with delivery in weeks, not counted as available: XS");
  });

  test("buildOffer: no size available means not in stock; no yellow means no note", () => {
    const o = buildOffer(tile, [{ label: "S", lights: ["red"] }]);
    assert.equal(o.inStock, false);
    assert.equal(o.note, undefined);
  });

  test("buildOffer without a size check (not a candidate): no sizes, in stock", () => {
    const o = buildOffer(tile, null);
    assert.deepEqual(o.sizes, []);
    assert.equal(o.inStock, true);
    assert.equal(o.listPrice, 4500);
  });

  test("parseListing: a page text is capped and stripped of markup (REQ-008)", () => {
    const hostile = `<script>alert(1)</script>Evil ${"x".repeat(500)}`;
    const t = parseListing(raw({ name: hostile }), LISTING_URL).tiles[0];
    assert.ok(t !== undefined && t.name.length <= 120);
    assert.doesNotMatch(t.name, /[<>]|script/i);
  });

  test("parseListing: counter above 0 but no tiles is a broken page", () => {
    assert.throws(
      () => parseListing({ count: "12", nextHref: null, tiles: [] }, LISTING_URL),
      (e: unknown) => e instanceof ExtractError && /no tiles/.test(e.reason),
    );
  });

  test("parseListing: unreadable counter, bad SKU, missing price or foreign currency are broken pages", () => {
    const broken = (r: ReturnType<typeof raw>, re: RegExp) =>
      assert.throws(
        () => parseListing(r, LISTING_URL),
        (e: unknown) => e instanceof ExtractError && re.test(e.reason),
      );
    broken({ ...raw(), count: "many" }, /counter/);
    broken(raw({ sku: "abc; DROP" }), /sku/i);
    broken(raw({ price: "" }), /price/);
    broken(raw({ price: "$10.00" }), /currency/);
    broken(raw({ href: null }), /link/);
  });

  test("parseListing: product and next links must stay on the listing's origin and lose their query string", () => {
    const t = parseListing(raw({ href: "/p/rose-bike-1?size=S&product_shape=x" }), LISTING_URL).tiles[0];
    assert.equal(t?.url, "https://www.rosebikes.com/p/rose-bike-1");
    assert.throws(
      () => parseListing(raw({ href: "https://evil.example/p/rose-bike-1" }), LISTING_URL),
      (e: unknown) => e instanceof ExtractError,
    );
    assert.throws(
      () => parseListing({ ...raw(), nextHref: "https://evil.example/sale/bikes?page=2" }, LISTING_URL),
      (e: unknown) => e instanceof ExtractError,
    );
  });
});
