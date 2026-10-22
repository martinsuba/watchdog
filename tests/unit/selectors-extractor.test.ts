import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildOffers } from "../../src/extractors/selectors.ts";

const base = {
  name: " Bike  One ",
  price: "2 999,00 €",
  listPrice: "3 499,00 €",
  link: "http://s/p/1#frag",
  sizes: [],
  outOfStock: false,
};

describe("buildOffers", () => {
  test("parses prices, trims the name, derives the id from the link without fragment", () => {
    const [o] = buildOffers([base], "EUR", "http://s/list");
    assert.equal(o?.name, "Bike One");
    assert.equal(o?.price, 2999);
    assert.equal(o?.listPrice, 3499);
    assert.equal(o?.currency, "EUR");
    assert.equal(o?.id, "http://s/p/1");
    assert.equal(o?.url, "http://s/p/1");
  });
  test("missing list price stays undefined; missing link falls back to the page url and a name id", () => {
    const [o] = buildOffers([{ ...base, listPrice: null, link: null }], "EUR", "http://s/list");
    assert.equal(o?.listPrice, undefined);
    assert.equal(o?.url, "http://s/list");
    assert.equal(o?.id, "http://s/list#bike-one");
  });
  test("in stock needs an available size when sizes exist; out-of-stock class wins", () => {
    const sizes = [{ label: "S", available: false }];
    assert.equal(buildOffers([{ ...base, sizes }], "EUR", "http://s/list")[0]?.inStock, false);
    assert.equal(
      buildOffers([{ ...base, sizes: [{ label: "S", available: true }] }], "EUR", "http://s/list")[0]?.inStock,
      true,
    );
    assert.equal(buildOffers([base], "EUR", "http://s/list")[0]?.inStock, true);
    assert.equal(buildOffers([{ ...base, outOfStock: true }], "EUR", "http://s/list")[0]?.inStock, false);
  });
  test("a parsed currency symbol wins over the watch currency", () => {
    assert.equal(buildOffers([{ ...base, price: "$5.00" }], "EUR", "http://s/list")[0]?.currency, "USD");
  });
  test("an unparsable price throws", () => {
    assert.throws(() => buildOffers([{ ...base, price: "ask us" }], "EUR", "http://s/list"), /price/i);
  });
  test("hostile name and size labels are sanitized at the extractor boundary (REQ-008)", () => {
    const hostile = `Bike <b>Pro</b>\u202E\u0007${"x".repeat(500)}`;
    const [o] = buildOffers(
      [{ ...base, name: hostile, sizes: [{ label: "<i>S</i>\u200B", available: true }] }],
      "EUR",
      "http://s/list",
    );
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(o?.name ?? "", /[<>\u202E\u0007]/);
    assert.equal(Array.from(o?.name ?? "").length, 120);
    assert.deepEqual(o?.sizes, [{ label: "S", available: true }]);
  });
});

describe("buildOffers: stable ids", () => {
  const idOf = (link: string) => buildOffers([{ ...base, link }], "EUR", "http://s/list")[0];
  test("tracking parameters do not change the id (a shop adding utm_* per visit must not make every offer new)", () => {
    const a = idOf("http://s/p/1?utm_source=mail&utm_campaign=x&gclid=abc&fbclid=1&ref=home");
    assert.equal(a?.id, "http://s/p/1");
    assert.equal(a?.id, idOf("http://s/p/1?utm_source=other")?.id);
  });
  test("parameters that identify the product are kept, in sorted order, next to dropped tracking ones", () => {
    assert.equal(idOf("http://s/p?pid=7&utm_medium=x&color=red")?.id, "http://s/p?color=red&pid=7");
    assert.equal(idOf("http://s/p?color=red&pid=7")?.id, "http://s/p?color=red&pid=7");
  });
  test("the url shown to the user keeps its query string", () => {
    assert.equal(idOf("http://s/p/1?utm_source=mail&size=S")?.url, "http://s/p/1?utm_source=mail&size=S");
  });
});
