import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_HEADER,
  historyPath,
  makeEnv,
  readHistory,
  readText,
  runCli,
  seedHistory,
  writeWatch,
} from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("REQ-006 history", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test("REQ-006: a run extracting 3 offers appends 3 rows with the listed columns", async () => {
    writeWatch(env, { id: "hist", urls: [env.server.url("/products-3.html")], match: { maxPrice: 3000 } });
    const before = Date.now();
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(readText(historyPath(env))?.split("\n")[0], HISTORY_HEADER);
    const rows = readHistory(env);
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.watch, "hist");
      assert.ok(Math.abs(Date.parse(r.ts ?? "") - before) < 120_000, `ts ${r.ts}`);
      assert.ok(r.offer_id, "offer_id");
      assert.equal(r.currency, "EUR");
      assert.equal(r.error, "");
      assert.match(r.matched ?? "", /^(yes|no)$/);
    }
    const alpha = rows.find((r) => r.name === "Gravel Alpha");
    assert.equal(alpha?.matched, "yes");
    assert.equal(Number(alpha?.price), 2999);
    assert.equal(Number(alpha?.list_price), 3499);
    assert.equal(rows.find((r) => r.name === "Trail Gamma")?.matched, "no", "all sizes unavailable");
    await runCli(env);
    assert.equal(readHistory(env).length, 6, "a second run appends 3 more rows");
  });

  test("REQ-006: rows older than 180 days are pruned at the start of a run, newer rows are kept", async () => {
    seedHistory(env, [
      `${daysAgo(200)},hist,old-offer,Ancient Bike,100,,EUR,S,no,`,
      `${daysAgo(181)},hist,old-offer-2,Stale Bike,100,,EUR,S,no,`,
      `${daysAgo(179)},hist,keep-offer,Recent Bike,100,,EUR,S,no,`,
      `${daysAgo(10)},hist,keep-offer-2,Newer Bike,100,,EUR,S,no,`,
    ]);
    writeWatch(env, { id: "hist", urls: [env.server.url("/products-b.html")] });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const names = readHistory(env).map((r) => r.name);
    assert.ok(!names.includes("Ancient Bike"));
    assert.ok(!names.includes("Stale Bike"));
    assert.ok(names.includes("Recent Bike"));
    assert.ok(names.includes("Newer Bike"));
    assert.ok(names.includes("Aero Delta"), "new row appended");
    assert.equal(names.length, 3);
  });

  test("REQ-006: a broken check appends one row with the reason", async () => {
    writeWatch(env, { id: "hist", urls: [env.server.url("/no-structure.html")] });
    await runCli(env);
    const rows = readHistory(env);
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0]?.watch, "hist");
    assert.notEqual(rows[0]?.error, "");
  });
});
