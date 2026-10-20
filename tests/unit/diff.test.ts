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
const m = (o: Offer, sizes = ["S"]) => ({ offer: o, matchingSizes: sizes });

describe("diff", () => {
  test("an offer not alerted before is a 'new' alert and is remembered", () => {
    const r = diff({}, [m(offer("a", 90))]);
    assert.equal(r.alerts.length, 1);
    assert.deepEqual(r.alerts[0]?.reasons, ["new"]);
    assert.equal(r.alerts[0]?.offer.id, "a");
    assert.deepEqual(r.nextAlerted, { a: { price: 90, sizes: ["S"] } });
  });
  test("an already alerted offer with the same price and sizes sends nothing and keeps its entry", () => {
    const prev = { a: { price: 90, sizes: ["S"] } };
    const r = diff(prev, [m(offer("a", 90))]);
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

  // [name, previous entry, current price, current matching sizes, expected reasons, expected stored entry]
  const table: [
    string,
    { price: number; sizes: string[] },
    number,
    string[],
    string[],
    { price: number; sizes: string[] },
  ][] = [
    ["cheaper", { price: 2800, sizes: ["S"] }, 2700, ["S"], ["cheaper"], { price: 2700, sizes: ["S"] }],
    [
      "price rise is silent, baseline stays at the alerted price",
      { price: 2800, sizes: ["S"] },
      2900,
      ["S"],
      [],
      { price: 2800, sizes: ["S"] },
    ],
    [
      "rise then fall back to the alerted price is silent",
      { price: 2800, sizes: ["S"] },
      2800,
      ["S"],
      [],
      { price: 2800, sizes: ["S"] },
    ],
    [
      "drop below the alerted price after a rise alerts",
      { price: 2800, sizes: ["S"] },
      2799,
      ["S"],
      ["cheaper"],
      { price: 2799, sizes: ["S"] },
    ],
    ["new size", { price: 2800, sizes: ["S"] }, 2800, ["S", "M"], ["new size"], { price: 2800, sizes: ["S", "M"] }],
    [
      "shrinking sizes is silent, current sizes are stored",
      { price: 2800, sizes: ["S", "M"] },
      2800,
      ["S"],
      [],
      { price: 2800, sizes: ["S"] },
    ],
    [
      "a size that vanished and came back alerts as new size",
      { price: 2800, sizes: ["S"] },
      2800,
      ["S", "M"],
      ["new size"],
      { price: 2800, sizes: ["S", "M"] },
    ],
    [
      "cheaper and new size give both reasons",
      { price: 2800, sizes: ["S"] },
      2700,
      ["S", "M"],
      ["cheaper", "new size"],
      { price: 2700, sizes: ["S", "M"] },
    ],
    [
      "new size at a higher price alerts and the alerted price becomes the baseline",
      { price: 2800, sizes: ["S"] },
      2900,
      ["S", "M"],
      ["new size"],
      { price: 2900, sizes: ["S", "M"] },
    ],
    [
      "swapped size (one gone, another new) is a new size",
      { price: 2800, sizes: ["S"] },
      2800,
      ["M"],
      ["new size"],
      { price: 2800, sizes: ["M"] },
    ],
  ];
  for (const [name, prevEntry, price, sizes, reasons, stored] of table) {
    test(`table: ${name}`, () => {
      const r = diff({ a: prevEntry }, [m(offer("a", price), sizes)]);
      assert.deepEqual(
        r.alerts.map((a) => a.reasons),
        reasons.length ? [reasons] : [],
      );
      assert.deepEqual(r.nextAlerted, { a: stored });
    });
  }

  test("stops matching, then matches again at a higher price: new again", () => {
    const step1 = diff({ a: { price: 2800, sizes: ["S"] } }, []);
    const step2 = diff(step1.nextAlerted, [m(offer("a", 2900))]);
    assert.deepEqual(step2.alerts[0]?.reasons, ["new"]);
  });
  test("several alert-worthy offers are all returned", () => {
    const r = diff({ b: { price: 10, sizes: ["S"] } }, [m(offer("a")), m(offer("b", 9)), m(offer("d", 10))]);
    assert.deepEqual(
      r.alerts.map((a) => a.offer.id),
      ["a", "b", "d"],
    );
  });
});
