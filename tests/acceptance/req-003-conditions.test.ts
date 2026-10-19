import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { listingHtml } from "./support/pages.ts";
import { hasPrice, makeEnv, messages, runCli, todo, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";
import type { TestProduct } from "./support/pages.ts";

// Conventions: every test has a positive control (an offer that must alert) so "no alert for X" cannot pass trivially.
describe("REQ-003 conditions", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  async function runWith(match: Record<string, unknown>, products: TestProduct[]) {
    env.server.set("/list.html", listingHtml(products));
    writeWatch(env, { id: "cond", name: "Conditions", urls: [env.server.url("/list.html")], match });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    return messages(env);
  }

  test("REQ-003: maxPrice 3000 matches 2999 not 3001", todo("T-005"), async () => {
    const msgs = await runWith({ maxPrice: 3000 }, [
      { name: "Bike Under", price: 2999, sizes: ["M"] },
      { name: "Bike Over", price: 3001, sizes: ["M"] },
    ]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Bike Under/);
    assert.doesNotMatch(msgs[0] ?? "", /Bike Over/);
  });

  test("REQ-003: minDiscountPct 15 matches a 15% discount not 14.9%", todo("T-005"), async () => {
    const msgs = await runWith({ minDiscountPct: 15 }, [
      { name: "Bike Fifteen", price: 850, listPrice: 1000, sizes: ["M"] },
      { name: "Bike Almost", price: 851, listPrice: 1000, sizes: ["M"] },
      { name: "Bike NoList", price: 100, sizes: ["M"] }, // no listPrice fails the condition
    ]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Bike Fifteen/);
    assert.doesNotMatch(msgs[0] ?? "", /Bike Almost/);
    assert.doesNotMatch(msgs[0] ?? "", /Bike NoList/);
  });

  test("REQ-003: sizes [XS, S] does not match an offer with only M/L available", todo("T-005"), async () => {
    const msgs = await runWith({ sizes: ["XS", "S"] }, [
      {
        name: "Bike Wrongsize",
        price: 1000,
        sizes: [{ label: "XS", available: false }, { label: "S", available: false }, "M", "L"],
      },
      { name: "Bike Rightsize", price: 1000, sizes: ["M", "s"] },
    ]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Bike Rightsize/);
    assert.doesNotMatch(msgs[0] ?? "", /Bike Wrongsize/);
  });

  test(
    "REQ-003: with S available the offer matches and the message lists only matching available sizes",
    todo("T-005"),
    async () => {
      const msgs = await runWith({ sizes: ["XS", "S"] }, [
        {
          name: "Bike Mixed",
          price: 1000,
          sizes: [{ label: "XS", available: false }, "S", "M", "L"],
        },
      ]);
      assert.equal(msgs.length, 1);
      const msg = msgs[0] ?? "";
      assert.match(msg, /Bike Mixed/);
      assert.match(msg, /\bS\b/, "matching available size S listed");
      assert.doesNotMatch(msg, /\bXS\b/, "XS is unavailable");
      assert.doesNotMatch(msg, /\bM\b/, "M is not a configured size");
      assert.doesNotMatch(msg, /\bL\b/, "L is not a configured size");
    },
  );

  test(
    "REQ-003: nameIncludes [Backroad] and nameExcludes [AL]: Backroad FF matches, Backroad AL does not",
    todo("T-005"),
    async () => {
      const msgs = await runWith({ nameIncludes: ["Backroad"], nameExcludes: ["AL"] }, [
        { name: "Backroad FF", price: 2000, sizes: ["S"] },
        { name: "Backroad AL", price: 1500, sizes: ["S"] },
        { name: "Shave SL", price: 1500, sizes: ["S"] },
      ]);
      assert.equal(msgs.length, 1);
      assert.match(msgs[0] ?? "", /Backroad FF/);
      assert.doesNotMatch(msgs[0] ?? "", /Backroad AL/);
      assert.doesNotMatch(msgs[0] ?? "", /Shave SL/);
      assert.ok(hasPrice(msgs[0] ?? "", 2000));
    },
  );

  test("REQ-003: nameIncludes is case-insensitive", todo("T-005"), async () => {
    const msgs = await runWith({ nameIncludes: ["backroad"] }, [{ name: "BACKROAD FF", price: 2000, sizes: ["S"] }]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /BACKROAD FF/);
  });

  test("REQ-003: an out-of-stock offer does not match", todo("T-005"), async () => {
    const msgs = await runWith({ maxPrice: 3000 }, [
      { name: "Bike Instock", price: 2000, sizes: ["M"] },
      {
        name: "Bike Soldout",
        price: 1000,
        sizes: [
          { label: "M", available: false },
          { label: "L", available: false },
        ],
      },
    ]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Bike Instock/);
    assert.doesNotMatch(msgs[0] ?? "", /Bike Soldout/);
  });
});
