import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePrice } from "../../src/price.ts";
import { makeEnv, readHistory, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-009 generic selectors extractor", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test("REQ-009: offers are extracted as configured by the watch's selectors", async () => {
    writeWatch(env, {
      id: "alt",
      urls: [env.server.url("/alt-markup.html")],
      selectors: {
        pageMarker: "#catalog",
        item: "div.card",
        name: ".title",
        price: ".now",
        listPrice: ".was",
        sizes: ".variant",
        link: "a.more",
      },
    });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const rows = readHistory(env);
    assert.equal(rows.length, 2, JSON.stringify(rows));
    const one = rows.find((r) => r.name === "Wheelset One");
    assert.equal(Number(one?.price), 2999);
    assert.equal(Number(one?.list_price), 3499);
    assert.match(one?.sizes_available ?? "", /\b28\b/);
    assert.doesNotMatch(one?.sizes_available ?? "", /\b30\b/);
    const two = rows.find((r) => r.name === "Wheelset Two");
    assert.equal(Number(two?.price), 2499);
    assert.equal(two?.list_price, "");
  });

  test("REQ-009: price strings in common formats are parsed to the right numeric value", () => {
    const cases: [string, number][] = [
      ["2 999,00 €", 2999],
      ["2 999,00 €", 2999],
      ["€2,999.00", 2999],
      ["2.999 €", 2999],
      ["899,00 €", 899],
      ["€1,450.50", 1450.5],
    ];
    for (const [text, amount] of cases) {
      assert.deepEqual(parsePrice(text), { amount, currency: "EUR" }, text);
    }
  });
});
