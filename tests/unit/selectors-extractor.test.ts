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
});
