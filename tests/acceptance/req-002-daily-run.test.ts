import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, messages, readHistory, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-002 daily run with a real browser", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test("REQ-002: a page with 3 products yields 3 offers with name, price, list price and sizes", async () => {
    writeWatch(env, { id: "three", urls: [env.server.url("/products-3.html")] });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const rows = readHistory(env);
    assert.equal(rows.length, 3, JSON.stringify(rows));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    const alpha = byName["Gravel Alpha"];
    assert.ok(alpha, "Gravel Alpha extracted");
    assert.equal(Number(alpha.price), 2999);
    assert.equal(Number(alpha.list_price), 3499);
    assert.equal(alpha.currency, "EUR");
    assert.match(alpha.sizes_available ?? "", /\bXS\b/);
    assert.match(alpha.sizes_available ?? "", /\bS\b/);
    assert.doesNotMatch(alpha.sizes_available ?? "", /\bM\b/, "M is unavailable");

    const beta = byName["Road Beta"];
    assert.ok(beta, "Road Beta extracted");
    assert.equal(Number(beta.price), 1450);
    assert.equal(beta.list_price, "", "no list price");
    assert.match(beta.sizes_available ?? "", /\bM\b/);
    assert.match(beta.sizes_available ?? "", /\bL\b/);

    const gamma = byName["Trail Gamma"];
    assert.ok(gamma, "Trail Gamma extracted");
    assert.equal(Number(gamma.price), 899);
    assert.equal(Number(gamma.list_price), 1099);
    assert.equal(gamma.sizes_available, "", "all sizes unavailable");
  });

  test("REQ-002: a watch with 2 URLs combines the offers of both pages into one watch result", async () => {
    writeWatch(env, {
      id: "two-urls",
      name: "Two pages",
      urls: [env.server.url("/products-3.html"), env.server.url("/products-b.html")],
      match: { maxPrice: 2200 },
    });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(env.server.requests.includes("/products-3.html"));
    assert.ok(env.server.requests.includes("/products-b.html"));
    const rows = readHistory(env);
    assert.equal(rows.length, 4);
    assert.deepEqual([...new Set(rows.map((r) => r.watch))], ["two-urls"]);
    assert.ok(
      rows.some((r) => r.name === "Aero Delta"),
      "offer from page 2",
    );
    assert.ok(
      rows.some((r) => r.name === "Road Beta"),
      "offer from page 1",
    );
    // one watch result: matching offers of both pages arrive in a single message
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /Aero Delta/);
    assert.match(msgs[0] ?? "", /Road Beta/);
  });
});
