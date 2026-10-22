import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { messages, readHistory, ROOT, runCli, writeWatch } from "./support/harness.ts";
import { makeEnv } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

/*
 * REQ-010 against the recorded rosebikes.com fixtures (tests/fixtures/rose/, captured in T-001), served by the local
 * fake shop server. Nothing here is invented page structure: the pages are the fixtures, changed only where a test
 * needs a different state (stated at each use).
 */

const fixture = (name: string) => readFileSync(`${ROOT}tests/fixtures/rose/${name}`, "utf8");
const LISTING = fixture("sale-listing.html");
const EMPTY = fixture("sale-listing-empty.html");
const NEXT_LINK = /<a data-test="pagination-next-link"[^>]*>Next<\/a>/;
/** The recorded page 1 has a "next" link (the other 15 of 63 results). Tests that are not about paging drop it. */
const SINGLE_PAGE = LISTING.replace(NEXT_LINK, "");

/** The product fixtures were captured after clicking one size each: this is the colour/traffic-light block of that state. */
const colourBlock = (html: string) =>
  html.slice(html.indexOf('<div data-test="bike-step-color">'), html.indexOf("\n</div>\n</main>"));
const XS_BLOCK = colourBlock(fixture("product-size-xs.html")); // no green: yellow (weeks) + sold out
const S_BLOCK = colourBlock(fixture("product-size-s.html")); // 3 x green, 2 x sold out

/**
 * A product page that behaves like the real one for the test: choosing a size radio shows the colour block recorded for
 * that size. `blocks` maps size label -> recorded block. The page itself is product-size-s.html.
 */
function productPage(blocks: Record<string, string>): string {
  const base = fixture("product-size-s.html");
  const data = JSON.stringify(blocks).replaceAll("<", "\\u003c");
  const script = `<script>const B=${data};document.querySelectorAll('input[name="bike-select-size"]').forEach(i=>i.addEventListener('click',()=>{const b=B[i.value];if(b)document.querySelector('[data-test="bike-step-color"]').outerHTML=b;}));</script>`;
  return base.replace("</main>", `${script}</main>`);
}
const NORMAL = productPage({ XS: XS_BLOCK, S: S_BLOCK }); // XS: only yellow, S: green
const SWAPPED = productPage({ XS: S_BLOCK, S: XS_BLOCK }); // XS: green, S: only yellow

const SKU_FF = "2709984"; // Backroad FF GRX RX825 Di2, 4000 (list 4500)
const SKU_FORCE = "2723816"; // Backroad FF Force XPLR AXS, 4450 (list 5000)
const SKU_BLEND = "2715089"; // Blend Gravel, 1300 (list 1400)
const SKU_ROAD = "2723845"; // Blend Road, 1200 (list 1300)
const SKU_GRX = "2719082"; // Backroad GRX RX820 1x12, 2099 (list 2799)
const SKU_AL = "160226"; // Backroad AL Plus Cues, 3300 (list 3500)

const slugOf: Record<string, string> = {
  [SKU_FF]: "rose-backroad-ff-grx-rx825-di2",
  [SKU_FORCE]: "rose-backroad-ff-force-xplr-axs",
  [SKU_BLEND]: "rose-blend-gravel",
  [SKU_ROAD]: "rose-blend-road",
  [SKU_GRX]: "rose-backroad-grx-rx820-1x12",
  [SKU_AL]: "rose-backroad-al-plus-cues",
};
const productPath = (sku: string) => `/p/${slugOf[sku]}-${sku}`;

describe("REQ-010 Rose extractor", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  const productRequests = () => env.server.requests.filter((p) => p.startsWith("/p/"));
  const byId = () => Object.fromEntries(readHistory(env).map((r) => [r.offer_id, r]));
  const roseWatch = (id: string, match: Record<string, unknown>) =>
    writeWatch(env, {
      id,
      name: `Rose ${id}`,
      site: "rose",
      urls: [env.server.url("/sale/bikes")],
      match,
      extra: { selectors: undefined },
    });
  /** The real watch file from watches/, pointed at the local server. */
  const realWatch = (id: string) => {
    const doc = parse(readFileSync(`${ROOT}watches/${id}.yaml`, "utf8")) as Record<string, unknown>;
    writeWatch(env, {
      id,
      name: doc.name as string,
      site: doc.site as string,
      urls: [env.server.url("/sale/bikes")],
      currency: doc.currency as string,
      match: doc.match as Record<string, unknown>,
      extra: { selectors: undefined },
    });
  };

  test("REQ-010: offers, prices, list prices and available sizes are extracted from the recorded listing and product pages, across pages", async () => {
    // Page 1 = the recorded listing, its "next" link pointed at a second page. Page 2 = the same recorded listing with
    // one tile turned into a new product (sku 2800001) and no next link: the repeated tiles must not be counted twice.
    env.server.set("/sale/bikes", LISTING.replace("/sale/bikes?sf=1&amp;page=2", "/sale/bikes-2"));
    env.server.set(
      "/sale/bikes-2",
      LISTING.replaceAll(SKU_FF, "2800001")
        .replaceAll("Backroad FF GRX RX825 Di2", "Backroad FF Second Page")
        .replace(NEXT_LINK, ""),
    );
    env.server.set(productPath(SKU_FF), NORMAL);
    env.server.set(productPath(SKU_FORCE), SWAPPED);
    env.server.set(productPath(SKU_GRX), NORMAL);
    env.server.set(`/p/${slugOf[SKU_FF]}-2800001`, NORMAL);
    roseWatch("rose-test", {
      nameIncludes: ["Backroad"],
      nameExcludes: ["Backroad AL"],
      maxPrice: 5000,
      minDiscountPct: 10,
      sizes: ["XS", "S"],
    });

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);

    const rows = byId();
    assert.deepEqual(
      Object.keys(rows).sort(),
      [SKU_FF, SKU_FORCE, SKU_BLEND, SKU_ROAD, SKU_GRX, SKU_AL, "2800001"].sort(),
    );
    const expected: Record<string, [string, string, string, string, string]> = {
      // sku: [name, price, list price, sizes available, matched]
      [SKU_FF]: ["Backroad FF GRX RX825 Di2", "4000", "4500", "S", "yes"],
      [SKU_FORCE]: ["Backroad FF Force XPLR AXS", "4450", "5000", "XS", "yes"],
      [SKU_GRX]: ["Backroad GRX RX820 1x12", "2099", "2799", "S", "yes"],
      "2800001": ["Backroad FF Second Page", "4000", "4500", "S", "yes"],
      [SKU_BLEND]: ["Blend Gravel", "1300", "1400", "", "no"],
      [SKU_ROAD]: ["Blend Road", "1200", "1300", "", "no"],
      [SKU_AL]: ["Backroad AL Plus Cues", "3300", "3500", "", "no"],
    };
    for (const [sku, [name, price, list, sizes, matched]] of Object.entries(expected)) {
      const r = rows[sku];
      assert.deepEqual(
        [r?.name, Number(r?.price), Number(r?.list_price), r?.currency, r?.sizes_available, r?.matched],
        [name, Number(price), Number(list), "EUR", sizes, matched],
        `offer ${sku}`,
      );
    }
    assert.equal(readHistory(env).length, 7);

    // product pages only for the offers that can match; none for Blend, Blend Road or Backroad AL
    assert.deepEqual(
      productRequests().sort(),
      [productPath(SKU_FF), productPath(SKU_FORCE), productPath(SKU_GRX), `/p/${slugOf[SKU_FF]}-2800001`].sort(),
    );

    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    const msg = msgs[0] ?? "";
    for (const name of [
      "Backroad FF GRX RX825 Di2",
      "Backroad FF Force XPLR AXS",
      "Backroad GRX RX820 1x12",
      "Backroad FF Second Page",
    ]) {
      assert.match(msg, new RegExp(name));
    }
    for (const name of ["Blend", "AL Plus"]) assert.doesNotMatch(msg, new RegExp(name));
    assert.ok(msg.includes(env.server.url(productPath(SKU_FF))), "the alert links to the product page");
  });

  test("REQ-010: a size that is only orderable with weeks of delivery (yellow) is not available and does not alert, but is mentioned as a note", async () => {
    env.server.set("/sale/bikes", SINGLE_PAGE);
    env.server.set(productPath(SKU_FF), NORMAL); // XS yellow only, S green
    env.server.set(productPath(SKU_FORCE), NORMAL);
    env.server.set(productPath(SKU_GRX), NORMAL);
    // only XS wanted: every candidate has XS yellow at best -> nothing is available
    roseWatch("rose-xs", {
      nameIncludes: ["Backroad"],
      nameExcludes: ["Backroad AL"],
      maxPrice: 5000,
      minDiscountPct: 10,
      sizes: ["XS"],
    });
    let res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    const rows = byId();
    for (const sku of [SKU_FF, SKU_FORCE, SKU_GRX]) {
      assert.equal(rows[sku]?.sizes_available, "", `sku ${sku}`);
      assert.equal(rows[sku]?.matched, "no", `sku ${sku}`);
    }

    // XS and S wanted: S is green and alerts; the alert says that XS is only orderable with delivery in weeks
    roseWatch("rose-xs", { nameIncludes: ["Backroad FF GRX"], maxPrice: 5000, minDiscountPct: 10, sizes: ["XS", "S"] });
    res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /sizes: S\b/);
    assert.doesNotMatch(msgs[0] ?? "", /sizes:[^\n]*XS/);
    assert.match(msgs[0] ?? "", /XS[^\n]*weeks|weeks[^\n]*XS/i);
  });

  test("REQ-010: the real rose-gravel watch alerts for a cheap Backroad with size S, never for Backroad AL, and skips what is too dear", async () => {
    // From the recorded listing: Backroad GRX RX820 (2099, list 2799, -25%) fits; Backroad AL Plus Cues is changed to
    // a price and discount that would fit, to show that only its name keeps it out.
    env.server.set("/sale/bikes", SINGLE_PAGE.replaceAll("€3,300.00", "€1,500.00"));
    env.server.set(productPath(SKU_GRX), NORMAL);
    env.server.set(productPath(SKU_AL), NORMAL);
    realWatch("rose-gravel");

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /Backroad GRX RX820 1x12/);
    assert.match(msgs[0] ?? "", /2099/);
    assert.match(msgs[0] ?? "", /sizes: S\b/);
    assert.doesNotMatch(msgs[0] ?? "", /AL Plus|Blend|FF/);
    const rows = byId();
    assert.equal(rows[SKU_GRX]?.matched, "yes");
    assert.equal(rows[SKU_AL]?.matched, "no");
    assert.equal(rows[SKU_FF]?.matched, "no"); // 4000 > 3000
    assert.deepEqual(productRequests(), [productPath(SKU_GRX)]);
  });

  test("REQ-010: with a recorded listing that has no Shave, rose-road sends no alert and no broken alert", async () => {
    env.server.set("/sale/bikes", SINGLE_PAGE);
    realWatch("rose-road");
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.equal(readHistory(env).length, 6);
    assert.ok(readHistory(env).every((r) => r.matched === "no" && r.error === ""));
    assert.deepEqual(productRequests(), []);
  });

  test("REQ-010: a real empty result (counter 0, no tiles) is not broken", async () => {
    env.server.set("/sale/bikes", EMPTY);
    realWatch("rose-road");
    realWatch("rose-gravel");
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.deepEqual(
      readHistory(env).filter((r) => r.error !== ""),
      [],
    );
  });

  test("REQ-010: a page without the result counter, and a counter above zero without tiles, are reported as broken", async () => {
    env.server.set("/sale/bikes", "<html><body><h1>Maintenance</h1></body></html>");
    realWatch("rose-road");
    await runCli(env);
    let msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:\s*\S+/i);

    env.server.set("/sale/bikes", EMPTY.replace("<strong>0</strong>", "<strong>12</strong>"));
    await runCli(env, { args: ["--data-dir", `${env.dataDir}-b`] });
    msgs = messages(env);
    assert.equal(msgs.length, 2, JSON.stringify(msgs));
    assert.match(msgs[1] ?? "", /broken:\s*\S+/i);
  });
});
