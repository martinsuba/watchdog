import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../../src/rules.ts";
import type { Offer } from "../../src/types.ts";

const offer = (price: number): Offer => ({
  id: "o1",
  name: "Bike",
  url: "http://x/p/1",
  price,
  currency: "EUR",
  sizes: [
    { label: "S", available: true },
    { label: "M", available: false },
  ],
  inStock: true,
});

describe("matches", () => {
  test("no conditions: matches", () => {
    assert.equal(matches(offer(5000), {}).matched, true);
  });
  test("maxPrice is inclusive", () => {
    assert.equal(matches(offer(3000), { maxPrice: 3000 }).matched, true);
  });
  test("price above maxPrice does not match", () => {
    assert.equal(matches(offer(3001), { maxPrice: 3000 }).matched, false);
  });
  test("matchingSizes lists the available sizes", () => {
    assert.deepEqual(matches(offer(1), {}).matchingSizes, ["S"]);
  });
});
