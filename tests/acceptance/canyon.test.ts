import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { parse } from "yaml";
import { makeEnv, messages, readHistory, ROOT, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

/*
 * REQ-011 against the recorded canyon.com fixtures (tests/fixtures/canyon/, captured in T-001), served by the local fake
 * shop server. The pages are the fixtures, changed only where a test needs a different state (stated at each use):
 * absolute links are pointed at the local server, and the trimmed listings (3 of 11 tiles) get the counter of what is
 * there, because the extractor requires counter == tiles.
 */

const fixture = (name: string) => readFileSync(`${ROOT}tests/fixtures/canyon/${name}`, "utf8");
const ENDURANCE = fixture("endurance-listing.html");
const GRAIL = fixture("grail-cf-sl-listing.html");
const EMPTY = fixture("listing-empty.html");
const PRODUCT = fixture("product-sizes.html"); // sizes 2XS S L purchasable; XS M XL 2XL sold out

const ENDURANCE_PATH = "/en-sk/road-bikes/endurance-bikes/";
const GRAIL_PATH = "/en-sk/gravel-bikes/race/grail/";
const CF7_PATH = "/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html"; // Endurace CF 7, 3 colours
const ALLROAD_PATH = "/en-sk/road-bikes/endurance-bikes/endurace/allroad/endurace-allroad/4477.html";
const GRAIL7_PATH = "/en-sk/gravel-bikes/race/grail/cf/grail-cf-7/4508.html"; // Grail CF 7, 3 colours
const GRAIL7S_PATH = "/en-sk/gravel-bikes/race/grail/cf/grail-cf-7-speed/4509.html";

/** The recorded listing as served by the local server, with the counter of the tiles that are there. */
const local = (html: string, origin: string, tiles?: number) => {
  const pointed = html.replaceAll("https://www.canyon.com", origin);
  return tiles === undefined ? pointed : pointed.replace(/(js-productCount">)\d+</, `$1${tiles}<`);
};
/** Recorded discounted-tile markup (as on the Grizl 6 tile): the sale price element followed by the original price. */
const discount = (html: string, sale: string, original: string) => {
  const price = `<div class="productTile__priceSale"> ${sale} </div>`;
  assert.ok(html.includes(price), `fixture has a tile priced ${sale}`);
  return html.replace(price, `${price}\n<s class="productTile__priceOriginal">${original}</s>`);
};

type Route = { status: number; location?: string; body?: string | ((origin: string) => string) };
/** Own tiny server for redirects (the shared fake server cannot redirect); Canyon answers 302 -> parent category, 200. */
async function redirectingServer(
  routes: Record<string, Route>,
): Promise<{ origin: string; server: Server; seen: string[] }> {
  const seen: string[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    seen.push(path);
    const r = routes[path] ?? { status: 404, body: "not found" };
    res.writeHead(r.status, {
      "content-type": "text/html; charset=utf-8",
      ...(r.location ? { location: r.location } : {}),
    });
    res.end(typeof r.body === "function" ? r.body(origin) : (r.body ?? ""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  origin = `http://127.0.0.1:${addr.port}`;
  return { origin, server, seen };
}

describe("REQ-011 Canyon extractor", () => {
  let env: Env;
  let extra: Server | undefined;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => (extra === undefined ? resolve() : extra.close(() => resolve())));
    extra?.closeAllConnections();
    extra = undefined;
    await env.cleanup();
  });

  const productRequests = () => env.server.requests.filter((p) => p.endsWith(".html"));
  const byId = () => Object.fromEntries(readHistory(env).map((r) => [r.offer_id, r]));
  /** The real watch file from watches/, pointed at the given origin and category path. */
  const realWatch = (id: string, origin: string, path: string) => {
    const doc = parse(readFileSync(`${ROOT}watches/${id}.yaml`, "utf8")) as Record<string, unknown>;
    writeWatch(env, {
      id,
      name: doc.name as string,
      site: doc.site as string,
      urls: [origin + path],
      currency: doc.currency as string,
      match: doc.match as Record<string, unknown>,
      extra: { selectors: undefined },
    });
  };
  const serveEndurance = (html = local(ENDURANCE, env.server.origin, 3)) => env.server.set(ENDURANCE_PATH, html);
  const serveGrail = (html = local(GRAIL, env.server.origin)) => env.server.set(GRAIL_PATH, html);

  test("REQ-011: canyon-endurance extracts names, prices, list prices, stable model ids and the sizes of the one candidate from its colour pages", async () => {
    // Endurace CF 7 (2.399 EUR) is shown with an original price of 2.999 (-20%); the other two tiles have no discount.
    serveEndurance(discount(local(ENDURANCE, env.server.origin, 3), "2.399 €", "2.999 €"));
    env.server.set(CF7_PATH, PRODUCT);
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);

    const rows = byId();
    assert.deepEqual(Object.keys(rows).sort(), ["4427", "4432", "4477"]);
    const expected: Record<string, [string, number, string, string, string]> = {
      // model id: [name, price, list price, sizes available (all of the product page), matched]
      "4432": ["Endurace CF SLX 8 Di2", 4649, "", "", "no"],
      "4477": ["Endurace AllRoad", 1149, "", "", "no"],
      "4427": ["Endurace CF 7", 2399, "2999", "2XS;S;L", "yes"],
    };
    for (const [id, [name, price, list, sizes, matched]] of Object.entries(expected)) {
      const r = rows[id];
      assert.deepEqual(
        [r?.name, Number(r?.price), r?.list_price, r?.currency, r?.sizes_available, r?.matched],
        [name, price, list, "EUR", sizes, matched],
        `offer ${id}`,
      );
    }
    assert.equal(readHistory(env).length, 3);

    // Only the candidate costs product page visits: one per colour (3 swatches), the others none.
    assert.deepEqual(productRequests(), [CF7_PATH, CF7_PATH, CF7_PATH]);

    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /Endurace CF 7/);
    assert.match(msgs[0] ?? "", /2399/);
    assert.match(msgs[0] ?? "", /sizes: L\b/);
    assert.doesNotMatch(msgs[0] ?? "", /SLX|AllRoad/);
    assert.ok(
      (msgs[0] ?? "").includes(env.server.url(CF7_PATH)),
      "the alert links to the product page without a query string",
    );
  });

  test("REQ-011: canyon-endurance never alerts for an e-bike (Endurace:ON), however cheap and discounted, and does not open its product page", async () => {
    let html = local(ENDURANCE, env.server.origin, 3);
    html = discount(html, "1.149 €", "1.999 €");
    html = html.replaceAll("Endurace AllRoad", "Endurace:ON AllRoad");
    serveEndurance(html);
    env.server.set(ALLROAD_PATH, PRODUCT);
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.equal(byId()["4477"]?.name, "Endurace:ON AllRoad");
    assert.equal(byId()["4477"]?.matched, "no");
    assert.deepEqual(productRequests(), []);
  });

  test("REQ-011: canyon-endurance does not alert when the candidate's wanted sizes (L, XL) are all sold out", async () => {
    serveEndurance(discount(local(ENDURANCE, env.server.origin, 3), "2.399 €", "2.999 €"));
    // the recorded product page with L turned into a sold-out button (same classes as the recorded XL button)
    const soldOutL = PRODUCT.replace(
      /productConfiguration__selectVariant--purchasable (?=" type="button"[^>]*data-product-size="L")/,
      "productConfiguration__selectVariant--unpurchasable js-unpurchasable productConfiguration__selectVariant--notifyMe ",
    );
    assert.notEqual(soldOutL, PRODUCT, "the fixture's L button was changed");
    env.server.set(CF7_PATH, soldOutL);
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.equal(byId()["4427"]?.sizes_available, "2XS;S");
    assert.equal(byId()["4427"]?.matched, "no");
  });

  test("REQ-011: canyon-grail reads the Grail category, keeps only Grail CF by name (carousel tiles and other models are ignored) and alerts with size S", async () => {
    // Grail CF 7 (2.599) is shown with an original price of 3.199 (-18.8%). "Grail CF 7 Speed" is renamed to a model of
    // another family and made cheap and discounted: only its name keeps it out. The carousel's discounted Grizl 6 is
    // made very cheap too: carousel tiles are not part of the listing.
    let html = local(GRAIL, env.server.origin);
    html = discount(html, "2.599 €", "3.199 €");
    html = html.replaceAll("Grail CF 7 Speed", "Grizl 7 Speed");
    html = html.replace(
      '<div class="productTile__priceSale"> 3.699 € </div>',
      '<div class="productTile__priceSale"> 2.499 € </div>\n<s class="productTile__priceOriginal">3.699 €</s>',
    );
    html = html.replace("1.649 €</div>", "649 €</div>");
    serveGrail(html);
    env.server.set(GRAIL7_PATH, PRODUCT);
    env.server.set(GRAIL7S_PATH, PRODUCT);
    realWatch("canyon-grail", env.server.origin, GRAIL_PATH);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const rows = byId();
    assert.deepEqual(Object.keys(rows).sort(), ["4508", "4509"]);
    assert.deepEqual(
      [
        rows["4508"]?.name,
        Number(rows["4508"]?.price),
        Number(rows["4508"]?.list_price),
        rows["4508"]?.sizes_available,
        rows["4508"]?.matched,
      ],
      ["Grail CF 7", 2599, 3199, "2XS;S;L", "yes"],
    );
    assert.deepEqual(
      [rows["4509"]?.name, Number(rows["4509"]?.price), Number(rows["4509"]?.list_price), rows["4509"]?.matched],
      ["Grizl 7 Speed", 2499, 3699, "no"],
    );
    assert.deepEqual(productRequests(), [GRAIL7_PATH, GRAIL7_PATH, GRAIL7_PATH]);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /Grail CF 7/);
    assert.match(msgs[0] ?? "", /sizes: S\b/);
    assert.doesNotMatch(msgs[0] ?? "", /Grizl|Speed/);
  });

  test("REQ-011: the recorded listings without any discount send no alert, no broken alert and open no product page", async () => {
    serveEndurance();
    serveGrail();
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);
    realWatch("canyon-grail", env.server.origin, GRAIL_PATH);
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.equal(readHistory(env).length, 5);
    assert.ok(readHistory(env).every((r) => r.matched === "no" && r.error === ""));
    assert.deepEqual(productRequests(), []);
  });

  test("REQ-011: a real empty result (counter 0, no tiles) is not broken", async () => {
    serveEndurance(EMPTY);
    serveGrail(EMPTY);
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);
    realWatch("canyon-grail", env.server.origin, GRAIL_PATH);
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.deepEqual(
      readHistory(env).filter((r) => r.error !== ""),
      [],
    );
  });

  test("REQ-011: a page without the product grid or counter, and a counter that disagrees with the tiles, are reported as broken", async () => {
    serveEndurance("<html><body><h1>Maintenance</h1></body></html>");
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);
    await runCli(env);
    let msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:\s*\S+/i);

    // the recorded endurance listing as captured: counter 11, but the trimmed page has only 3 tiles
    serveEndurance(local(ENDURANCE, env.server.origin));
    await runCli(env, { args: ["--data-dir", `${env.dataDir}-b`] });
    msgs = messages(env);
    assert.equal(msgs.length, 2, JSON.stringify(msgs));
    assert.match(msgs[1] ?? "", /broken:\s*\S+/i);
  });

  test("REQ-011: Canyon redirecting the Grail category to its parent (HTTP 200 at another address) is broken, never read as offers", async () => {
    // The parent category page would match (a cheap, discounted Grail CF 7 with sizes) if it were read as the Grail page.
    const real = await redirectingServer({
      [GRAIL_PATH]: { status: 302, location: "/en-sk/gravel-bikes/race/" },
      "/en-sk/gravel-bikes/race/": {
        status: 200,
        body: (origin) => discount(local(GRAIL, origin), "2.599 €", "3.999 €"),
      },
      [GRAIL7_PATH]: { status: 200, body: PRODUCT },
    });
    extra = real.server;
    realWatch("canyon-grail", real.origin, GRAIL_PATH);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*redirected/i);
    assert.doesNotMatch(msgs[0] ?? "", /sizes:/);
    assert.deepEqual(
      readHistory(env).filter((r) => r.matched === "yes"),
      [],
    );
    assert.ok(!real.seen.includes(GRAIL7_PATH), "no product page of the wrongly shown category was opened");
  });

  test("REQ-011: a candidate's product page that redirects to a category, or has no size list, is broken", async () => {
    const routes: Record<string, Route> = {
      [ENDURANCE_PATH]: { status: 200, body: (origin) => discount(local(ENDURANCE, origin, 3), "2.399 €", "2.999 €") },
      [CF7_PATH]: { status: 302, location: ENDURANCE_PATH },
    };
    const real = await redirectingServer(routes);
    extra = real.server;
    realWatch("canyon-endurance", real.origin, ENDURANCE_PATH);
    await runCli(env);
    let msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*product page/i);

    routes[CF7_PATH] = { status: 200, body: "<html><body><h1>Endurace CF 7</h1></body></html>" };
    await runCli(env, { args: ["--data-dir", `${env.dataDir}-b`] });
    msgs = messages(env);
    assert.equal(msgs.length, 2, JSON.stringify(msgs));
    assert.match(msgs[1] ?? "", /broken:.*size list/i);
  });

  test("REQ-011: the cookie banner (in a shadow root) is answered with the necessary-only button, not Allow all or Settings", async () => {
    const banner = `<div id="cmp"></div><script>
      const root = document.getElementById('cmp').attachShadow({ mode: 'open' });
      root.innerHTML = '<div role="dialog"><button id="all">Allow all</button><button id="set">Cookie settings</button><button id="nec">Necessary only</button></div>';
      root.getElementById('all').onclick = () => fetch('/consent-all');
      root.getElementById('set').onclick = () => fetch('/consent-settings');
      root.getElementById('nec').onclick = () => { fetch('/consent-necessary'); root.innerHTML = ''; };
    </script>`;
    serveEndurance(local(ENDURANCE, env.server.origin, 3).replace("</body>", `${banner}</body>`));
    realWatch("canyon-endurance", env.server.origin, ENDURANCE_PATH);
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(
      env.server.requests.filter((p) => p.startsWith("/consent-")),
      ["/consent-necessary"],
    );
    assert.deepEqual(messages(env), []);
  });
});
