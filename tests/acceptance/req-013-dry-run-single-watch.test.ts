import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listingHtml } from "./support/pages.ts";
import { hasPrice, historyPath, makeEnv, messages, readText, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-013 dry run and single watch", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test("REQ-013: --dry-run prints the due message, does not call notify and writes no state or history", async () => {
    env.server.set("/list.html", listingHtml([{ name: "Bike Dry", price: 2000, sizes: ["S"] }]));
    writeWatch(env, { id: "dry", urls: [env.server.url("/list.html")], match: { maxPrice: 3000 } });
    const res = await runCli(env, { args: ["--dry-run"] });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Bike Dry/);
    assert.equal(messages(env).length, 0, "notify command not called");
    assert.equal(readText(env.notifyFile), null);
    assert.ok(!existsSync(join(env.dataDir, "state.json")), "no state.json");
    assert.ok(!existsSync(historyPath(env)), "no history.csv");
    // since nothing was recorded, a real run afterwards still sends the alert
    await runCli(env);
    assert.equal(messages(env).length, 1);
  });

  test("REQ-013: --dry-run leaves existing state and history byte-for-byte unchanged", async () => {
    env.server.set("/list.html", listingHtml([{ name: "Bike Dry", price: 2800, sizes: ["S"] }]));
    writeWatch(env, { id: "dry", urls: [env.server.url("/list.html")], match: { maxPrice: 3000 } });
    await runCli(env);
    assert.equal(messages(env).length, 1);
    const state = readText(join(env.dataDir, "state.json"));
    const history = readText(historyPath(env));
    assert.ok(state, "state.json written by the real run");
    assert.ok(history, "history.csv written by the real run");

    env.server.set("/list.html", listingHtml([{ name: "Bike Dry", price: 2700, sizes: ["S"] }]));
    const res = await runCli(env, { args: ["--dry-run"] });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /cheaper/i);
    assert.ok(hasPrice(res.stdout, 2700));
    assert.equal(messages(env).length, 1, "notify command not called");
    assert.equal(readText(join(env.dataDir, "state.json")), state);
    assert.equal(readText(historyPath(env)), history);
  });

  test("REQ-013: --watch <id> runs only that watch (3 watches, only one page fetched)", async () => {
    for (const id of ["one", "two", "three"]) {
      env.server.set(`/${id}.html`, listingHtml([{ name: `Bike ${id}`, price: 2000, sizes: ["S"] }]));
      writeWatch(env, { id, name: `Watch ${id}`, urls: [env.server.url(`/${id}.html`)], match: { maxPrice: 3000 } });
    }
    const res = await runCli(env, { args: ["--watch", "two"] });
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(env.server.requests, ["/two.html"]);
    const msgs = messages(env);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Bike two/);
  });
});
