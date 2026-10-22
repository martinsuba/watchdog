import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { ExtractError } from "../../src/errors.ts";
import { ALIEXPRESS_COOKIES, itemIdOf, parseItem, readItemPage } from "../../src/extractors/aliexpress.ts";
import type { RawItem } from "../../src/extractors/aliexpress.ts";
import { cookiesFor } from "../../src/extractors/index.ts";
import { BrowserSession } from "../../src/browser.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/aliexpress/${name}`, import.meta.url), "utf8");
const URL_SK = "https://www.aliexpress.com/item/1005006902683405.html";

const raw = (over: Partial<RawItem> = {}): RawItem => ({
  finalUrl: URL_SK,
  ld: [
    JSON.stringify([
      {
        "@type": "Product",
        name: "Wheels",
        offers: { "@type": "Offer", availability: "https://schema.org/InStock", priceCurrency: "EUR", price: "371.95" },
      },
    ]),
  ],
  domPrice: "€371.95",
  blocked: false,
  ...over,
});
const withOffer = (offers: unknown, name: unknown = "Wheels") =>
  raw({ domPrice: null, ld: [JSON.stringify({ "@type": "Product", name, offers })] });
const broken = (r: RawItem, re: RegExp) =>
  assert.throws(
    () => parseItem(r, URL_SK),
    (e) => e instanceof ExtractError && re.test(e.reason),
  );

describe("aliexpress pure parsing", () => {
  test("item id is the digits of /item/<id>.html, nothing else", () => {
    assert.equal(itemIdOf("https://www.aliexpress.com/item/1005006902683405.html?spm=a2g0o&x=1"), "1005006902683405");
    assert.equal(itemIdOf("https://www.aliexpress.com/item/abc.html"), null);
    assert.equal(itemIdOf("https://www.aliexpress.com/other/1005006902683405.html"), null);
  });

  test("reads price, currency, availability, stable id and canonical url", () => {
    const o = parseItem(raw(), URL_SK);
    assert.deepEqual(o, {
      id: "1005006902683405",
      name: "Wheels",
      url: URL_SK,
      price: 371.95,
      currency: "EUR",
      sizes: [],
      inStock: true,
    });
  });

  test("tracking parameters in the requested url do not reach the offer", () => {
    const o = parseItem(raw({ finalUrl: `${URL_SK}?spm=x&gps-id=1` }), `${URL_SK}?spm=y`);
    assert.equal(o.url, URL_SK);
    assert.equal(o.id, "1005006902683405");
  });

  test("OutOfStock and SoldOut are not in stock; the price is still read", () => {
    for (const a of ["https://schema.org/OutOfStock", "https://schema.org/SoldOut", "http://schema.org/OutOfStock"]) {
      const o = parseItem(withOffer({ availability: a, priceCurrency: "EUR", price: "400.00" }), URL_SK);
      assert.equal(o.inStock, false, a);
      assert.equal(o.price, 400);
    }
  });

  test("an unknown availability value is broken, not guessed", () => {
    broken(
      withOffer({ availability: "https://schema.org/PreOrder", priceCurrency: "EUR", price: "1" }),
      /availability/,
    );
    broken(withOffer({ priceCurrency: "EUR", price: "1" }), /availability/);
  });

  test("the Product is found among other JSON-LD (VideoObject first, several scripts, offers as list)", () => {
    const video = JSON.stringify([{ "@type": "VideoObject", name: "v" }]);
    const product = JSON.stringify([
      {
        "@type": "Product",
        name: "P",
        offers: [{ availability: "https://schema.org/InStock", priceCurrency: "EUR", price: "5.5" }],
      },
    ]);
    assert.equal(parseItem(raw({ domPrice: null, ld: [video, "not json", product] }), URL_SK).price, 5.5);
  });

  test("block markers win: reason says blocked", () => {
    broken(raw({ blocked: true, ld: [] }), /^blocked/);
    broken(raw({ finalUrl: "https://www.aliexpress.com/_____tmd_____/punish?x5secdata=abc", ld: [] }), /^blocked/);
    broken(
      raw({ finalUrl: "https://www.aliexpress.com/item/1005006902683405.html?x5secdata=abc", ld: [] }),
      /^blocked/,
    );
    broken(raw({ finalUrl: "https://www.aliexpress.com/punish/captcha", ld: [] }), /^blocked/);
  });

  test("missing, unparsable or product-less JSON-LD is broken and mentions blocked or changed", () => {
    broken(raw({ ld: [] }), /blocked or changed/);
    broken(raw({ ld: ["{oops"] }), /blocked or changed/);
    broken(raw({ ld: [JSON.stringify([{ "@type": "VideoObject" }])] }), /blocked or changed/);
  });

  test("a redirect to another region/site or item is broken (SK region is pinned by cookie)", () => {
    const de = "https://de.aliexpress.com/item/1005006902683405.html?gatewayAdapt=glo2deu";
    broken(raw({ finalUrl: de }), /redirected/);
    broken(raw({ finalUrl: "https://www.aliexpress.com/item/1005000000000001.html" }), /redirected/);
    broken(raw({ finalUrl: "https://www.aliexpress.com/" }), /redirected/);
  });

  test("a non-EUR currency is broken", () => {
    broken(
      withOffer({ availability: "https://schema.org/InStock", priceCurrency: "USD", price: "400.00" }),
      /currency/,
    );
    broken(withOffer({ availability: "https://schema.org/InStock", price: "400.00" }), /currency/);
  });

  test("a price that is not a plain decimal number is broken", () => {
    for (const price of ["", "abc", "-5", "0", "1e3", "12,50", "Infinity", "1 000.00", 371.95, null]) {
      broken(withOffer({ availability: "https://schema.org/InStock", priceCurrency: "EUR", price }), /price/);
    }
  });

  test("a DOM price that disagrees with the JSON-LD price is broken; a missing one is tolerated", () => {
    broken(raw({ domPrice: "€354.69" }), /price/);
    assert.equal(parseItem(raw({ domPrice: "371,95€" }), URL_SK).price, 371.95);
    assert.equal(parseItem(raw({ domPrice: null }), URL_SK).price, 371.95);
  });

  test("the name is sanitized and capped; a missing name is broken", () => {
    const o = parseItem(
      withOffer(
        { availability: "https://schema.org/InStock", priceCurrency: "EUR", price: "1" },
        `<b>A</b>${"x".repeat(500)}`,
      ),
      URL_SK,
    );
    assert.ok(o.name.length <= 120 && !o.name.includes("<"));
    broken(withOffer({ availability: "https://schema.org/InStock", priceCurrency: "EUR", price: "1" }, 42), /name/);
  });
});

describe("aliexpress on the recorded fixtures", () => {
  let browser: Browser;
  let page: Page;
  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  after(async () => {
    await browser.close();
  });
  const load = async (name: string): Promise<RawItem> => {
    await page.setContent(fixture(name));
    const r = await readItemPage(page);
    return r;
  };

  test("SK/EUR page: 371.95 EUR in stock (default variant)", async () => {
    const r = await load("product-sk-eur.html");
    assert.equal(r.blocked, false);
    assert.equal(r.domPrice, "€371.95");
    const o = parseItem({ ...r, finalUrl: URL_SK }, URL_SK);
    assert.deepEqual([o.id, o.price, o.currency, o.inStock], ["1005006902683405", 371.95, "EUR", true]);
    assert.match(o.name, /^ELITEWHEELS Carbon Road Bike Wheels/);
  });

  test("DE page (no cookie): price 354.69 is consistent in the page, but the redirect marks it as the wrong region", async () => {
    const r = await load("product-de-no-cookie.html");
    assert.equal(r.domPrice, "354,69€");
    assert.equal(parseItem({ ...r, finalUrl: URL_SK }, URL_SK).price, 354.69);
    broken(
      { ...r, finalUrl: "https://de.aliexpress.com/item/1005006902683405.html?gatewayAdapt=glo2deu" },
      /redirected/,
    );
  });

  test("a captcha-like page is flagged by its DOM markers", async () => {
    await page.setContent('<html><body><div id="nc_1_wrapper">slide</div></body></html>');
    assert.equal((await readItemPage(page)).blocked, true);
    await page.setContent("<html><body><div class='baxia-dialog-mask'></div></body></html>");
    assert.equal((await readItemPage(page)).blocked, true);
    await page.setContent("<html><title>Captcha Interception</title><body>x</body></html>");
    assert.equal((await readItemPage(page)).blocked, true);
  });

  test("the robot-check text seen on the real block page (2026-10-22) and a challenge frame are flagged", async () => {
    await page.setContent("<html><body><div>We need to check if you are a robot.</div></body></html>");
    assert.equal((await readItemPage(page)).blocked, true);
    // a frame whose address is the anti-bot path (the real challenge came from .../_____tmd_____/punish?x5secdata=...)
    await page.route("https://www.aliexpress.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>x</p>" }),
    );
    await page.setContent("<html><body><p>shop</p></body></html>");
    await page.evaluate(() => {
      const f = document.createElement("iframe");
      f.src = "https://www.aliexpress.com/_____tmd_____/punish?x5secdata=abc";
      document.body.appendChild(f);
    });
    await page.waitForEvent("framenavigated", { predicate: (f) => f.url().includes("punish") });
    assert.equal((await readItemPage(page)).blocked, true);
    await page.unroute("https://www.aliexpress.com/**");
    await page.setContent("<html><body><p>a perfectly normal shop page about robots and wheels</p></body></html>");
    assert.equal((await readItemPage(page)).blocked, false);
  });
});

describe("region cookie", () => {
  test("is the SK/EUR cookie on .aliexpress.com, and only AliExpress watches get it", () => {
    assert.deepEqual(cookiesFor("aliexpress"), ALIEXPRESS_COOKIES);
    assert.deepEqual(cookiesFor("rose"), []);
    assert.equal(ALIEXPRESS_COOKIES.length, 1);
    const c = ALIEXPRESS_COOKIES[0];
    assert.deepEqual([c?.name, c?.domain, c?.path], ["aep_usuc_f", ".aliexpress.com", "/"]);
    assert.equal(c?.value, "site=glo&c_tp=EUR&region=SK&b_locale=en_US");
  });

  test("BrowserSession sends cookies it was given with the first request", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.cookie);
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>ok</body></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no address");
    const origin = `http://127.0.0.1:${addr.port}`;
    const session = new BrowserSession({ timeoutMs: 8000, delayMs: () => 0 });
    try {
      await session.withPage(origin + "/", async () => undefined, undefined, [
        { name: "aep_usuc_f", value: "a=b&c=d", url: origin },
      ]);
    } finally {
      await session.close();
      server.closeAllConnections();
      server.close();
    }
    assert.equal(seen[0], "aep_usuc_f=a=b&c=d");
  });
});
