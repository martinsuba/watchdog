import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePrice } from "../../src/price.ts";

describe("parsePrice", () => {
  const cases: [string, number, string | undefined][] = [
    ["2 999,00 €", 2999, "EUR"],
    ["2 999,00 €", 2999, "EUR"],
    ["2 999,00 €", 2999, "EUR"],
    ["€2,999.00", 2999, "EUR"],
    ["2.999 €", 2999, "EUR"],
    ["4.649 €", 4649, "EUR"],
    ["899,00 €", 899, "EUR"],
    ["€1,450.50", 1450.5, "EUR"],
    ["371.95", 371.95, undefined],
    ["From 9.300 €", 9300, "EUR"],
    ["1.234.567,89", 1234567.89, undefined],
    ["$12.50", 12.5, "USD"],
    ["£1,000", 1000, "GBP"],
    ["EUR 45,5", 45.5, "EUR"],
    ["1,5 €", 1.5, "EUR"],
  ];
  for (const [text, amount, currency] of cases) {
    test(`parses ${JSON.stringify(text)}`, () => {
      const p = parsePrice(text);
      assert.equal(p.amount, amount);
      assert.equal(p.currency, currency);
    });
  }

  test("returns exactly {amount, currency} when the currency is known", () => {
    assert.deepEqual(parsePrice("2 999,00 €"), { amount: 2999, currency: "EUR" });
  });

  for (const bad of ["", "free", "—", "€"]) {
    test(`throws on ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parsePrice(bad), /price/i);
    });
  }
});
