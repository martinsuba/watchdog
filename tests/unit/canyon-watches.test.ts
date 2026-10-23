import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { buildOffer, parseListing, readListing } from "../../src/extractors/canyon.ts";
import { matches } from "../../src/rules.ts";
import type { Offer, Watch } from "../../src/types.ts";
import { loadWatches } from "../../src/watches.ts";

const WATCHES_DIR = new URL("../../watches", import.meta.url).pathname;
const GRAIL_URL = "https://www.canyon.com/en-sk/gravel-bikes/race/grail/";

const loaded = loadWatches(WATCHES_DIR);
const watch = (id: string): Watch => {
  const w = loaded.watches.find((x) => x.id === id);
  assert.ok(w, `watch ${id} loads from watches/`);
  return w;
};
const grail = watch("canyon-grail");
const endurance = watch("canyon-endurance");

/** An offer that satisfies every other condition of the Grail watch (price, discount >= 15%, size S). */
const offer = (over: Partial<Offer> = {}): Offer => ({
  id: "1",
  name: "Grail CF 7",
  url: "https://www.canyon.com/en-sk/gravel-bikes/race/grail/cf/grail-cf-7/1.html",
  price: 2000,
  listPrice: 2999,
  currency: "EUR",
  sizes: [{ label: "S", available: true }],
  inStock: true,
  ...over,
});
const ok = (w: Watch, o: Offer) => matches(o, w.match, w.currency);

describe("the real canyon watch files load", () => {
  test("no canyon file is invalid", () => {
    assert.deepEqual(
      loaded.invalid.filter((i) => i.file.startsWith("canyon-")),
      [],
    );
  });
});

describe("canyon-grail name filter", () => {
  test("the baseline offer matches (so the negative cases below fail only for their one change)", () => {
    assert.equal(ok(grail, offer()).matched, true);
  });

  for (const name of [
    "Grail CFR",
    "Grail CF SLX 8",
    "Grail CFR Ultimate",
    "Grail:ON CF 8",
    "Grail CF:ON 8",
    "Grail CF SLX 7 AXS",
  ]) {
    test(`"${name}" is excluded`, () => {
      assert.equal(ok(grail, offer({ name })).matched, false);
    });
  }

  for (const name of ["Grail CF 7", "Grail CF 7 Speed", "GRAIL CF 8"]) {
    test(`"${name}" is included`, () => {
      assert.equal(ok(grail, offer({ name })).matched, true);
    });
  }

  test("a model not named Grail CF is not included", () => {
    assert.equal(ok(grail, offer({ name: "Grizl CF 7" })).matched, false);
    assert.equal(ok(grail, offer({ name: "Grail AL 6" })).matched, false);
  });
});

describe("canyon-grail maxPrice", () => {
  test("the file sets maxPrice 3000", () => {
    assert.equal(grail.match.maxPrice, 3000);
  });

  test("equal to maxPrice matches, one cent above does not", () => {
    // list price high enough that the discount condition holds at both prices
    assert.equal(ok(grail, offer({ price: 3000, listPrice: 4000 })).matched, true);
    assert.equal(ok(grail, offer({ price: 3000.01, listPrice: 4000 })).matched, false);
  });
});

describe("canyon sizes", () => {
  test("grail watch sizes are XS and S", () => {
    assert.deepEqual(grail.match.sizes, ["XS", "S"]);
  });

  test("an offer with only XS available matches the grail watch (XS is wanted) and lists XS", () => {
    const only = offer({
      sizes: [
        { label: "XS", available: true },
        { label: "S", available: false },
        { label: "M", available: true },
      ],
    });
    const r = ok(grail, only);
    assert.equal(r.matched, true);
    assert.deepEqual(r.matchingSizes, ["XS"]);
  });

  test("an offer with only XS available does not match the endurance watch (L/XL)", () => {
    assert.deepEqual(endurance.match.sizes, ["L", "XL"]);
    const only = offer({
      name: "Endurace CF 7",
      sizes: [
        { label: "XS", available: true },
        { label: "L", available: false },
        { label: "XL", available: false },
      ],
    });
    assert.equal(ok(endurance, only).matched, false);
    assert.equal(ok(endurance, { ...only, sizes: [{ label: "XL", available: true }] }).matched, true);
  });

  test("a sold-out XS alone does not match", () => {
    assert.equal(ok(grail, offer({ sizes: [{ label: "XS", available: false }] })).matched, false);
  });
});

describe("canyon-endurance filter", () => {
  test("maxPrice boundary and the :ON safety net", () => {
    const e = (over: Partial<Offer>) =>
      ok(
        endurance,
        offer({
          name: "Endurace CF 7",
          price: 4500,
          listPrice: 6000,
          sizes: [{ label: "L", available: true }],
          ...over,
        }),
      ).matched;
    assert.equal(endurance.match.maxPrice, 4500);
    assert.equal(e({}), true);
    assert.equal(e({ price: 4500.01 }), false);
    assert.equal(e({ name: "Endurace:ON CF 7" }), false);
  });
});

describe("recorded fixture guard", () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser.close();
  });

  test("the current Grail fixture has at least one offer the grail name filter includes", async () => {
    const page = await browser.newPage();
    await page.setContent(
      readFileSync(new URL("../fixtures/canyon/grail-cf-sl-listing.html", import.meta.url), "utf8"),
    );
    const parsed = parseListing((await readListing(page))!, GRAIL_URL);
    // give each recorded tile a discount and a wanted size, so only the name (and price) can decide
    const offers = parsed.tiles.map((t) => buildOffer({ ...t, listPrice: 4000 }, [{ label: "S", available: true }]));
    const included = offers.filter((o) => ok(grail, o).matched);
    assert.ok(included.length >= 1, `no fixture offer passes the grail watch: ${offers.map((o) => o.name).join(", ")}`);
    assert.ok(included.some((o) => o.name === "Grail CF 7"));
  });
});
