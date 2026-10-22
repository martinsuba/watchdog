import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { ExtractError } from "../../src/errors.ts";
import {
  assertProductUrl,
  assertRequestedUrl,
  buildOffer,
  mergeSizes,
  parseListing,
  readListing,
  readSizeButtons,
} from "../../src/extractors/canyon.ts";
import type { RawListing } from "../../src/extractors/canyon.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/canyon/${name}`, import.meta.url), "utf8");
const ENDURANCE_URL = "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/";
const GRAIL_URL = "https://www.canyon.com/en-sk/gravel-bikes/race/grail/";

describe("canyon extractor on the recorded fixtures", () => {
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

  test("endurance listing: the 3 grid tiles only (not the carousel tile), counter, prices, stable ids and urls without query", async () => {
    await load("endurance-listing.html");
    const raw = await readListing(page);
    assert.notEqual(raw, null);
    assert.equal(raw!.count, "11"); // the fixture is trimmed to 3 of the 11 tiles: the counter is set to what is there
    const parsed = parseListing({ ...raw!, count: "3" }, ENDURANCE_URL);
    assert.equal(parsed.total, 3);
    assert.deepEqual(
      parsed.tiles.map((t) => [t.id, t.name, t.price, t.listPrice, t.currency, t.url]),
      [
        [
          "4432",
          "Endurace CF SLX 8 Di2",
          4649,
          undefined,
          "EUR",
          "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf-slx/endurace-cf-slx-8-di2/4432.html",
        ],
        [
          "4477",
          "Endurace AllRoad",
          1149,
          undefined,
          "EUR",
          "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/allroad/endurace-allroad/4477.html",
        ],
        [
          "4427",
          "Endurace CF 7",
          2399,
          undefined,
          "EUR",
          "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html",
        ],
      ],
    );
  });

  test("a counter that disagrees with the number of grid tiles is an error (more than one page, or a changed page)", async () => {
    await load("endurance-listing.html");
    const raw = (await readListing(page))!;
    assert.throws(() => parseListing(raw, ENDURANCE_URL), /counter says 11.*3 tiles/);
  });

  test("grail listing: 2 grid tiles; promo li and carousel tiles (discounted Grizl 6, e-bike) are ignored; colour variants are listed", async () => {
    await load("grail-cf-sl-listing.html");
    const parsed = parseListing((await readListing(page))!, GRAIL_URL);
    assert.deepEqual(
      parsed.tiles.map((t) => [t.id, t.name, t.price]),
      [
        ["4508", "Grail CF 7", 2599],
        ["4509", "Grail CF 7 Speed", 3699],
      ],
    );
    assert.deepEqual(parsed.tiles[0]?.variantUrls, [
      "https://www.canyon.com/en-sk/gravel-bikes/race/grail/cf/grail-cf-7/4508.html?dwvar_4508_pv_rahmenfarbe=R139_P01",
      "https://www.canyon.com/en-sk/gravel-bikes/race/grail/cf/grail-cf-7/4508.html?dwvar_4508_pv_rahmenfarbe=R139_P03",
      "https://www.canyon.com/en-sk/gravel-bikes/race/grail/cf/grail-cf-7/4508.html?dwvar_4508_pv_rahmenfarbe=R139_P02",
    ]);
  });

  test("discounted tile markup (recorded on the Grizl 6 carousel tile) gives sale and list price", async () => {
    await load("grail-cf-sl-listing.html");
    // the recorded discounted tile is a carousel tile: move it into the grid to read it with the grid rules
    await page.evaluate(() => {
      const tile = document.querySelector('[data-product-tile-context="slider"]')!;
      tile.setAttribute("data-product-tile-context", "grid");
      document.querySelector("ul.productGrid__list")!.appendChild(tile);
      document.querySelector(".js-productCount")!.textContent = "3";
    });
    const parsed = parseListing((await readListing(page))!, GRAIL_URL);
    const grizl = parsed.tiles.find((t) => t.id === "4444");
    assert.deepEqual([grizl?.name, grizl?.price, grizl?.listPrice], ["Grizl 6", 1649, 1849]);
  });

  test("synthetic empty listing (counter 0, no tiles) parses to zero tiles", async () => {
    await load("listing-empty.html");
    const parsed = parseListing((await readListing(page))!, GRAIL_URL);
    assert.deepEqual([parsed.total, parsed.tiles.length], [0, 0]);
  });

  test("the live page has a second '.js-productCount' (filter list, text '6 items'): the results counter is the one in the results header", async () => {
    await page.setContent(
      '<span class="js-productCount productFilters__listItemResultsCounter"> 6 items </span>' +
        fixture("listing-empty.html"),
    );
    assert.equal((await readListing(page))?.count, "0");
  });

  test("a page without the grid or the counter has no marker", async () => {
    await page.setContent("<html><body><h1>Maintenance</h1></body></html>");
    assert.equal(await readListing(page), null);
    await page.setContent('<span class="js-productCount">2</span>');
    assert.equal(await readListing(page), null);
    await page.setContent('<ul class="productGrid__list"></ul>');
    assert.equal(await readListing(page), null);
  });

  test("product page: all seven sizes with availability by whole class token ('unpurchasable' is not 'purchasable')", async () => {
    await load("product-sizes.html");
    assert.deepEqual(await readSizeButtons(page), [
      { label: "2XS", purchasable: true },
      { label: "XS", purchasable: false },
      { label: "S", purchasable: true },
      { label: "M", purchasable: false },
      { label: "L", purchasable: true },
      { label: "XL", purchasable: false },
      { label: "2XL", purchasable: false },
    ]);
  });

  test("product page without a size list gives no buttons", async () => {
    await page.setContent("<html><body>gone</body></html>");
    assert.deepEqual(await readSizeButtons(page), []);
  });
});

describe("canyon parseListing validation", () => {
  const tile = (over: Partial<RawListing["tiles"][number]> = {}): RawListing["tiles"][number] => ({
    href: "/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html?dwvar_4427_pv_rahmenfarbe=R129_P01",
    name: "Endurace CF 7",
    price: "2.399 €",
    listPrice: null,
    variantHrefs: [],
    ...over,
  });
  const raw = (tiles: RawListing["tiles"], count = String(tiles.length)): RawListing => ({ count, tiles });

  test("price formats: thousands dot, 'From' prefix, no thousands", () => {
    const p = parseListing(
      raw([
        tile({ price: "From 9.300 €" }),
        tile({ href: "/en-sk/x/4428.html", price: "999 €", listPrice: "1.249 €" }),
      ]),
      ENDURANCE_URL,
    );
    assert.deepEqual(
      p.tiles.map((t) => [t.price, t.listPrice]),
      [
        [9300, undefined],
        [999, 1249],
      ],
    );
  });

  test("the same model listed twice (two colours) is one tile", () => {
    const p = parseListing(raw([tile(), tile()], "2"), ENDURANCE_URL);
    assert.equal(p.tiles.length, 1);
  });

  test("an unreadable counter, a missing link, a link off the shop's domain, a non-model link and a foreign currency are errors", () => {
    const bad = (r: RawListing) => assert.throws(() => parseListing(r, ENDURANCE_URL), ExtractError);
    bad(raw([tile()], "lots"));
    bad(raw([tile({ href: null })]));
    bad(raw([tile({ href: "https://evil.example/en-sk/x/4427.html" })]));
    bad(raw([tile({ href: "/en-sk/road-bikes/endurance-bikes/" })]));
    bad(raw([tile({ price: "$2,399" })]));
    bad(raw([tile({ price: "sold" })]));
  });

  test("variant links on another origin or for another model are dropped, the tile link is always first", () => {
    const p = parseListing(
      raw([
        tile({
          variantHrefs: [
            "https://evil.example/en-sk/x/4427.html",
            "/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/9999.html",
            "/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html?dwvar_4427_pv_rahmenfarbe=R129_P02",
          ],
        }),
      ]),
      ENDURANCE_URL,
    );
    assert.deepEqual(p.tiles[0]?.variantUrls, [
      "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html?dwvar_4427_pv_rahmenfarbe=R129_P01",
      "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html?dwvar_4427_pv_rahmenfarbe=R129_P02",
    ]);
  });

  test("a hostile name is stripped and capped", () => {
    const p = parseListing(
      raw([tile({ name: `<script>alert(1)</script>Endurace ${"x".repeat(500)}` })]),
      ENDURANCE_URL,
    );
    assert.ok(!/[<>]/.test(p.tiles[0]!.name));
    assert.ok(p.tiles[0]!.name.length <= 120);
  });

  test("more variant links than the cap are cut", () => {
    const many = Array.from({ length: 30 }, (_, i) => `/en-sk/a/b/4427.html?dwvar_4427_pv_rahmenfarbe=C${i}`);
    const p = parseListing(raw([tile({ variantHrefs: many })]), ENDURANCE_URL);
    assert.ok(p.tiles[0]!.variantUrls.length <= 8);
  });
});

describe("canyon redirect and product page checks", () => {
  test("the final url must be one of the requested pages (trailing slash and host case do not matter)", () => {
    assertRequestedUrl(GRAIL_URL, [GRAIL_URL]);
    assertRequestedUrl("https://www.canyon.com/en-sk/gravel-bikes/race/grail", [GRAIL_URL]);
    assertRequestedUrl("https://www.canyon.com/en-sk/gravel-bikes/race/grail/?srule=x", [GRAIL_URL]);
  });

  test("a redirect to the parent category (what Canyon does for a filter that matches nothing) is an error", () => {
    assert.throws(
      () => assertRequestedUrl("https://www.canyon.com/en-sk/gravel-bikes/race/", [GRAIL_URL]),
      /redirected/,
    );
    assert.throws(() => assertRequestedUrl("https://www.canyon.com/en-sk/road-bikes/", [ENDURANCE_URL]), /redirected/);
  });

  test("a filter in the requested url must survive in the final url", () => {
    const filtered = `${GRAIL_URL}?prefn1=pc_rahmen_modifikation_werkstoff&prefv1=CF%20SL`;
    assertRequestedUrl(filtered, [filtered]);
    assert.throws(() => assertRequestedUrl(GRAIL_URL, [filtered]), /redirected/);
    assert.throws(() =>
      assertRequestedUrl(`${GRAIL_URL}?prefn1=pc_rahmen_modifikation_werkstoff&prefv1=ZZZ`, [filtered]),
    );
  });

  test("a product page must be the tile's model", () => {
    const url = "https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html";
    assertProductUrl(`${url}?dwvar_4427_pv_rahmenfarbe=R129_P02`, "4427");
    assert.throws(() => assertProductUrl("https://www.canyon.com/en-sk/road-bikes/", "4427"), /product page/);
    assert.throws(() => assertProductUrl(url.replace("4427", "4428"), "4427"), /product page/);
  });
});

describe("canyon sizes and offers", () => {
  const tile = {
    id: "4427",
    name: "Endurace CF 7",
    url: "https://www.canyon.com/en-sk/x/4427.html",
    price: 2399,
    listPrice: 2999,
    currency: "EUR",
    variantUrls: [],
  };

  test("a size is available when any colour has it purchasable; order of first appearance", () => {
    const colourA = [
      { label: "S", purchasable: true },
      { label: "M", purchasable: false },
      { label: "L", purchasable: false },
    ];
    const colourB = [
      { label: "S", purchasable: false },
      { label: "M", purchasable: false },
      { label: "L", purchasable: true },
      { label: "XL", purchasable: false },
    ];
    assert.deepEqual(mergeSizes([colourA, colourB]), [
      { label: "S", available: true },
      { label: "M", available: false },
      { label: "L", available: true },
      { label: "XL", available: false },
    ]);
  });

  test("offer: sizes from product pages; in stock when some size is available", () => {
    const o = buildOffer(tile, [
      { label: "L", available: true },
      { label: "XL", available: false },
    ]);
    assert.deepEqual(
      [o.id, o.name, o.url, o.price, o.listPrice, o.currency, o.inStock],
      ["4427", "Endurace CF 7", tile.url, 2399, 2999, "EUR", true],
    );
    assert.deepEqual(o.sizes, [
      { label: "L", available: true },
      { label: "XL", available: false },
    ]);
  });

  test("offer: all sizes sold out is not in stock; sizes not checked (listing decided) stays in stock with no sizes", () => {
    assert.equal(buildOffer(tile, [{ label: "L", available: false }]).inStock, false);
    const plain = buildOffer(tile, null);
    assert.deepEqual([plain.sizes, plain.inStock], [[], true]);
  });

  test("offer: no list price key when the tile has none", () => {
    const noList = { ...tile, listPrice: undefined };
    delete noList.listPrice;
    assert.equal("listPrice" in buildOffer(noList, null), false);
  });
});
