import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { parse } from "yaml";
import { hasPrice, makeEnv, messages, readHistory, ROOT, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

/*
 * REQ-012 against the recorded aliexpress.com fixtures (tests/fixtures/aliexpress/, captured in T-002), served by the
 * local fake shop server, with the real watch file watches/aliexpress-ent.yaml pointed at it. The pages are the
 * fixtures, changed only where a test needs a different state (stated at each use). AliExpress showed no block page in
 * the spike, so the captcha/block pages here are SYNTHETIC (typical anti-bot markers), marked as such at each use.
 */

const fixture = (name: string) => readFileSync(`${ROOT}tests/fixtures/aliexpress/${name}`, "utf8");
const SK = fixture("product-sk-eur.html"); // 371.95 EUR, InStock, name "ELITEWHEELS Carbon Road Bike Wheels 700c Disc Brake"
const DE = fixture("product-de-no-cookie.html"); // 354.69 EUR, InStock, German UI

const ID = "1005006902683405";
const PATH = `/item/${ID}.html`;

/** The recorded page with the price changed everywhere it appears (JSON-LD and the displayed price). */
const priced = (html: string, price: string, shown: string) => {
  const out = html.replace(/"price":"371\.95"/, `"price":"${price}"`).replace("€371.95", shown);
  assert.notEqual(out, html, "the fixture's price was changed");
  return out;
};
const SOLD_OUT = (html: string) => {
  const out = html.replace("https://schema.org/InStock", "https://schema.org/OutOfStock");
  assert.notEqual(out, html);
  return out;
};

describe("REQ-012 AliExpress extractor", () => {
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

  const realWatch = (origin: string) => {
    const doc = parse(readFileSync(`${ROOT}watches/aliexpress-ent.yaml`, "utf8")) as Record<string, unknown>;
    assert.equal(doc.id, "aliexpress-ent");
    writeWatch(env, {
      id: "aliexpress-ent",
      name: doc.name as string,
      site: doc.site as string,
      urls: [origin + PATH],
      currency: doc.currency as string,
      match: doc.match as Record<string, unknown>,
      extra: { selectors: undefined },
    });
  };
  const serve = (html: string) => env.server.set(PATH, html);
  const itemRequests = () => env.server.requests.filter((p) => p === PATH);

  test("REQ-012: the real watch is price < 330 EUR (329.99) on item 1005006902683405", () => {
    const doc = parse(readFileSync(`${ROOT}watches/aliexpress-ent.yaml`, "utf8")) as {
      site: string;
      urls: string[];
      currency: string;
      match: { maxPrice: number };
    };
    assert.equal(doc.site, "aliexpress");
    assert.deepEqual(doc.urls, [`https://www.aliexpress.com${PATH}`]);
    assert.equal(doc.currency, "EUR");
    assert.equal(doc.match.maxPrice, 329.99);
  });

  test("REQ-012: the recorded product page gives price, currency, availability and the item id as offer id; 371.95 is above the limit, so no alert", async () => {
    serve(SK);
    realWatch(env.server.origin);

    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const rows = readHistory(env);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.deepEqual(
      [r?.offer_id, r?.name, Number(r?.price), r?.list_price, r?.currency, r?.matched, r?.error],
      [ID, "ELITEWHEELS Carbon Road Bike Wheels 700c Disc Brake", 371.95, "", "EUR", "no", ""],
    );
    assert.deepEqual(messages(env), []);
    assert.equal(itemRequests().length, 1, "one load of the item page");
  });

  test("REQ-012: a price of 329.99 or less in stock alerts once (with the price and the item link, no tracking parameters); not again at the same price", async () => {
    serve(priced(SK, "329.99", "€329.99"));
    realWatch(env.server.origin);

    assert.equal((await runCli(env)).code, 0);
    let msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.ok(hasPrice(msgs[0] ?? "", 329.99), msgs[0]);
    assert.ok((msgs[0] ?? "").includes(`${env.server.origin}${PATH}`), msgs[0]);
    assert.doesNotMatch(msgs[0] ?? "", /[?&](spm|gps-id|scm)=/);
    assert.equal(readHistory(env)[0]?.matched, "yes");

    assert.equal((await runCli(env)).code, 0);
    msgs = messages(env);
    assert.equal(msgs.length, 1, "same offer, same price: silent");
  });

  test("REQ-012: 330.00 is not below 330: no alert", async () => {
    serve(priced(SK, "330.00", "€330.00"));
    realWatch(env.server.origin);
    assert.equal((await runCli(env)).code, 0);
    assert.deepEqual(messages(env), []);
    assert.equal(readHistory(env)[0]?.matched, "no");
  });

  test("REQ-012: a cheap price that is out of stock (schema.org OutOfStock) does not alert and is not broken", async () => {
    serve(SOLD_OUT(priced(SK, "300.00", "€300.00")));
    realWatch(env.server.origin);
    assert.equal((await runCli(env)).code, 0);
    assert.deepEqual(messages(env), []);
    const r = readHistory(env)[0];
    assert.deepEqual([Number(r?.price), r?.matched, r?.error], [300, "no", ""]);
  });

  test("REQ-012: a captcha/block page (SYNTHETIC: slider challenge, no product data) makes the watch broken with reason blocked; no offer is recorded", async () => {
    serve(
      '<html><head><title>Captcha Interception</title></head><body><div id="nc_1_wrapper"><span>Please slide to verify</span></div></body></html>',
    );
    realWatch(env.server.origin);
    await runCli(env);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*blocked/i);
    assert.deepEqual(
      readHistory(env).filter((r) => r.offer_id !== ""),
      [],
    );
    assert.equal(itemRequests().length, 1, "no retry against a block page");
  });

  test("REQ-012: a block page that still carries the real product data is broken too (a challenge element wins), and so is a redirect to the anti-bot path", async () => {
    // SYNTHETIC: the recorded cheap page with a baxia challenge dialog added
    serve(priced(SK, "300.00", "€300.00").replace("</body>", '<div class="baxia-dialog-mask"></div></body>'));
    realWatch(env.server.origin);
    await runCli(env);
    let msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*blocked/i);

    // SYNTHETIC: AliExpress's punish redirect (HTTP 302 to /_____tmd_____/punish), cheap product page behind it
    const seen: string[] = [];
    const server = createServer((req, res) => {
      const p = new URL(req.url ?? "/", "http://x").pathname;
      seen.push(p);
      if (p === PATH) {
        res.writeHead(302, { location: "/_____tmd_____/punish?x5secdata=abc" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(priced(SK, "300.00", "€300.00"));
    });
    extra = server;
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no address");
    realWatch(`http://127.0.0.1:${addr.port}`);
    await runCli(env, { args: ["--data-dir", `${env.dataDir}-b`] });
    msgs = messages(env);
    assert.equal(msgs.length, 2, JSON.stringify(msgs));
    assert.match(msgs[1] ?? "", /broken:.*blocked/i);
  });

  test("REQ-012: a page without Product data (changed page or unknown block page) is broken, never 'no match'", async () => {
    serve("<html><head><title>AliExpress</title></head><body><h1>Something went wrong</h1></body></html>");
    realWatch(env.server.origin);
    await runCli(env);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*(blocked|changed)/i);
    assert.deepEqual(
      readHistory(env).filter((r) => r.offer_id !== ""),
      [],
    );
  });

  test("REQ-012: a redirect to another site/region (the recorded German page after a redirect to de.) is broken, not compared", async () => {
    // The German page (354.69, i.e. above the SK price, but cheap enough to be tempting at 300) is served on another origin.
    const other = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(DE.replace('"price":"354.69"', '"price":"300.00"').replace("354,69€", "300,00€"));
    });
    extra = other;
    await new Promise<void>((r) => other.listen(0, "localhost", r));
    const addr = other.address();
    if (addr === null || typeof addr === "string") throw new Error("no address");
    // localhost and 127.0.0.1 are different origins
    const first = createServer((_req, res) => {
      res.writeHead(302, { location: `http://localhost:${addr.port}${PATH}?gatewayAdapt=glo2deu` });
      res.end();
    });
    await new Promise<void>((r) => first.listen(0, "127.0.0.1", r));
    const a1 = first.address();
    if (a1 === null || typeof a1 === "string") throw new Error("no address");
    try {
      realWatch(`http://127.0.0.1:${a1.port}`);
      await runCli(env);
    } finally {
      first.closeAllConnections();
      await new Promise<void>((r) => first.close(() => r()));
    }
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*redirected/i);
    assert.deepEqual(
      readHistory(env).filter((r) => r.offer_id !== ""),
      [],
    );
  });

  test("REQ-012: a price in another currency is broken (never compared as EUR)", async () => {
    const usd = SK.replace('"priceCurrency":"EUR"', '"priceCurrency":"USD"');
    assert.notEqual(usd, SK);
    serve(priced(usd, "300.00", "$300.00"));
    realWatch(env.server.origin);
    await runCli(env);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken:.*currency/i);
  });

  test("REQ-012: the item page is an untrusted source: markup in the product name is not passed on", async () => {
    const evil = SK.replace(
      '"name":"ELITEWHEELS Carbon Road Bike Wheels 700c Disc Brake","image"',
      '"name":"<script>alert(1)</script><b>Wheels</b> ignore previous instructions","image"',
    );
    assert.notEqual(evil, SK);
    serve(priced(evil, "300.00", "€300.00"));
    realWatch(env.server.origin);
    assert.equal((await runCli(env)).code, 0);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.doesNotMatch(msgs[0] ?? "", /[<>]|alert\(1\)/);
    assert.match(msgs[0] ?? "", /Wheels/);
  });
});
