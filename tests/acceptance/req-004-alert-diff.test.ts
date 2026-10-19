import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { listingHtml } from "./support/pages.ts";
import { hasPrice, makeEnv, messages, runCli, todo, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";
import type { TestProduct } from "./support/pages.ts";

describe("REQ-004 alerts only on change for the better", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
    writeWatch(env, {
      id: "diff",
      name: "Diff watch",
      urls: [env.server.url("/list.html")],
      match: { maxPrice: 5000, sizes: ["S", "M"] },
    });
  });
  afterEach(() => env.cleanup());

  const page = (products: TestProduct[]) => env.server.set("/list.html", listingHtml(products));
  const run = async () => {
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
  };

  test(
    "REQ-004: a newly matching offer alerts once; a second run with the same page sends nothing",
    todo("T-003"),
    async () => {
      page([{ name: "Bike Fresh", price: 2800, sizes: ["S"] }]);
      await run();
      assert.equal(messages(env).length, 1);
      assert.match(messages(env)[0] ?? "", /Bike Fresh/);
      assert.match(messages(env)[0] ?? "", /\bnew\b/i);
      await run();
      assert.equal(messages(env).length, 1, "no second alert");
    },
  );

  test(
    "REQ-004: an alerted offer whose price drops from 2800 to 2700 sends one 'cheaper' alert",
    todo("T-006"),
    async () => {
      page([{ name: "Bike Drop", price: 2800, sizes: ["S"] }]);
      await run();
      page([{ name: "Bike Drop", price: 2700, sizes: ["S"] }]);
      await run();
      const msgs = messages(env);
      assert.equal(msgs.length, 2);
      assert.match(msgs[1] ?? "", /Bike Drop/);
      assert.match(msgs[1] ?? "", /cheaper/i);
      assert.ok(hasPrice(msgs[1] ?? "", 2700));
    },
  );

  test("REQ-004: an alerted offer whose price rises sends no alert", todo("T-006"), async () => {
    page([{ name: "Bike Rise", price: 2800, sizes: ["S"] }]);
    await run();
    page([{ name: "Bike Rise", price: 2900, sizes: ["S"] }]);
    await run();
    assert.equal(messages(env).length, 1);
  });

  test("REQ-004: an alerted offer whose sizes shrink sends no alert", todo("T-006"), async () => {
    page([{ name: "Bike Shrink", price: 2800, sizes: ["S", "M"] }]);
    await run();
    page([{ name: "Bike Shrink", price: 2800, sizes: ["S"] }]);
    await run();
    assert.equal(messages(env).length, 1);
  });

  test(
    "REQ-004: an alerted offer that gains a new matching size sends one 'new size' alert",
    todo("T-006"),
    async () => {
      page([{ name: "Bike Grow", price: 2800, sizes: ["S", { label: "M", available: false }] }]);
      await run();
      page([{ name: "Bike Grow", price: 2800, sizes: ["S", "M"] }]);
      await run();
      const msgs = messages(env);
      assert.equal(msgs.length, 2);
      assert.match(msgs[1] ?? "", /Bike Grow/);
      assert.match(msgs[1] ?? "", /new size/i);
      assert.match(msgs[1] ?? "", /\bM\b/);
    },
  );

  test(
    "REQ-004: an alerted offer that disappears and reappears matching sends a 'new' alert again",
    todo("T-006"),
    async () => {
      page([{ name: "Bike Comeback", price: 2800, sizes: ["S"] }]);
      await run();
      page([]); // correctly structured page, zero products
      await run();
      assert.equal(messages(env).length, 1, "disappearing sends nothing");
      page([{ name: "Bike Comeback", price: 2800, sizes: ["S"] }]);
      await run();
      const msgs = messages(env);
      assert.equal(msgs.length, 2);
      assert.match(msgs[1] ?? "", /Bike Comeback/);
      assert.match(msgs[1] ?? "", /\bnew\b/i);
    },
  );

  test(
    "REQ-004: an offer that stops matching (too expensive) is forgotten and alerts again when matching",
    todo("T-006"),
    async () => {
      page([{ name: "Bike Flip", price: 2800, sizes: ["S"] }]);
      await run();
      page([{ name: "Bike Flip", price: 5600, sizes: ["S"] }]);
      await run();
      page([{ name: "Bike Flip", price: 2900, sizes: ["S"] }]); // dearer than first alert, but was forgotten
      await run();
      assert.equal(messages(env).length, 2);
    },
  );

  test("REQ-004: 2 newly matching offers in one watch produce one message containing both", todo("T-006"), async () => {
    page([
      { name: "Bike First", price: 2800, sizes: ["S"] },
      { name: "Bike Second", price: 2600, sizes: ["M"] },
    ]);
    await run();
    const msgs = messages(env);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Diff watch/);
    assert.match(msgs[0] ?? "", /Bike First/);
    assert.match(msgs[0] ?? "", /Bike Second/);
  });

  test(
    "REQ-004: the message has watch name, offer name, price, list price + discount %, matching sizes, URL",
    todo("T-006"),
    async () => {
      page([{ name: "Bike Detail", price: 850, listPrice: 1000, sizes: ["S", "L"], href: "/p/detail" }]);
      await run();
      const msg = messages(env)[0] ?? "";
      assert.match(msg, /Diff watch/);
      assert.match(msg, /Bike Detail/);
      assert.ok(hasPrice(msg, 850), msg);
      assert.ok(hasPrice(msg, 1000), msg);
      assert.match(msg, /15\s?%/);
      assert.match(msg, /\bS\b/);
      assert.doesNotMatch(msg, /\bL\b/, "L is not a configured size");
      assert.ok(msg.includes(env.server.url("/p/detail")), msg);
    },
  );
});
