import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../../src/rules.ts";
import type { Offer } from "../../src/types.ts";

const offer = (price: number, extra: Partial<Offer> = {}): Offer => ({
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
  ...extra,
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

  describe("maxPrice boundaries", () => {
    for (const [price, expected] of [
      [2999, true],
      [3000, true],
      [3001, false],
    ] as const) {
      test(`${price} vs 3000`, () => assert.equal(matches(offer(price), { maxPrice: 3000 }).matched, expected));
    }
  });

  describe("minDiscountPct", () => {
    const d = (price: number, listPrice?: number) => offer(price, listPrice === undefined ? {} : { listPrice });
    test("exactly 15% matches", () => assert.equal(matches(d(850, 1000), { minDiscountPct: 15 }).matched, true));
    test("14.9% does not match 15", () => assert.equal(matches(d(851, 1000), { minDiscountPct: 15 }).matched, false));
    test("15% matches 14.9 threshold", () =>
      assert.equal(matches(d(850, 1000), { minDiscountPct: 14.9 }).matched, true));
    test("14.9% matches threshold 14.9 (no float drift)", () =>
      assert.equal(matches(d(851, 1000), { minDiscountPct: 14.9 }).matched, true));
    test("no listPrice fails", () => assert.equal(matches(d(1), { minDiscountPct: 1 }).matched, false));
    test("0 threshold without listPrice still fails", () =>
      assert.equal(matches(d(1), { minDiscountPct: 0 }).matched, false));
  });

  describe("names", () => {
    test("nameIncludes any of, case-insensitive", () => {
      const o = offer(1, { name: "Backroad FF" });
      assert.equal(matches(o, { nameIncludes: ["nope", "BACKROAD"] }).matched, true);
      assert.equal(matches(o, { nameIncludes: ["nope"] }).matched, false);
    });
    test("nameExcludes none of, case-insensitive", () => {
      const o = offer(1, { name: "Backroad al" });
      assert.equal(matches(o, { nameExcludes: ["AL"] }).matched, false);
      assert.equal(matches(o, { nameExcludes: ["xx"] }).matched, true);
    });
    test("empty lists impose nothing", () =>
      assert.equal(matches(offer(1), { nameIncludes: [], nameExcludes: [], sizes: [] }).matched, true));
  });

  describe("sizes", () => {
    test("matches an available configured size, case-insensitive; lists only it", () => {
      const r = matches(offer(1), { sizes: ["xs", "s"] });
      assert.equal(r.matched, true);
      assert.deepEqual(r.matchingSizes, ["S"]);
    });
    test("configured size that is unavailable does not match", () =>
      assert.equal(matches(offer(1), { sizes: ["M"] }).matched, false));
    test("offer without sizes fails when sizes configured", () =>
      assert.equal(matches(offer(1, { sizes: [] }), { sizes: ["S"] }).matched, false));
  });

  describe("availability and currency", () => {
    test("out of stock never matches", () => assert.equal(matches(offer(1, { inStock: false }), {}).matched, false));
    test("all sizes unavailable never matches", () =>
      assert.equal(matches(offer(1, { sizes: [{ label: "S", available: false }] }), {}).matched, false));
    test("currency mismatch never matches and is flagged", () => {
      const r = matches(offer(1, { currency: "USD" }), {}, "EUR");
      assert.equal(r.matched, false);
      assert.equal(r.currencyMismatch, true);
    });
    test("same currency is fine; currency check is skipped when not given", () => {
      assert.equal(matches(offer(1), {}, "EUR").matched, true);
      assert.equal(matches(offer(1), {}, "EUR").currencyMismatch, false);
      assert.equal(matches(offer(1, { currency: "USD" }), {}).matched, true);
    });
  });
});
