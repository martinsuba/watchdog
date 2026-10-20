import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diff } from "../../src/diff.ts";
import type { Offer } from "../../src/types.ts";

const offer = (id: string, price = 100): Offer => ({
  id,
  name: `Bike ${id}`,
  url: `http://x/${id}`,
  price,
  currency: "EUR",
  sizes: [{ label: "S", available: true }],
  inStock: true,
});
const m = (o: Offer) => ({ offer: o, matchingSizes: ["S"] });

describe("diff", () => {
  test("an offer not alerted before is a 'new' alert and is remembered", () => {
    const r = diff({}, [m(offer("a", 90))]);
    assert.equal(r.alerts.length, 1);
    assert.equal(r.alerts[0]?.reason, "new");
    assert.equal(r.alerts[0]?.offer.id, "a");
    assert.deepEqual(r.nextAlerted, { a: { price: 90, sizes: ["S"] } });
  });
  test("an already alerted offer sends nothing and keeps its entry", () => {
    const prev = { a: { price: 90, sizes: ["S"] } };
    const r = diff(prev, [m(offer("a", 95))]);
    assert.deepEqual(r.alerts, []);
    assert.deepEqual(r.nextAlerted, prev);
  });
  test("an offer that no longer matches is forgotten", () => {
    const r = diff({ a: { price: 90, sizes: ["S"] } }, []);
    assert.deepEqual(r.nextAlerted, {});
  });
  test("does not mutate the previous state", () => {
    const prev = { a: { price: 90, sizes: ["S"] } };
    diff(prev, [m(offer("b"))]);
    assert.deepEqual(prev, { a: { price: 90, sizes: ["S"] } });
  });
});
