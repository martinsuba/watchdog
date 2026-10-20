import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listingHtml } from "./support/pages.ts";
import { makeEnv, messages, readText, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-007 notification via command", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
    env.server.set("/list.html", listingHtml([{ name: "Bike Notify", price: 2000, sizes: ["S"] }]));
    writeWatch(env, {
      id: "notify",
      name: "Notify watch",
      urls: [env.server.url("/list.html")],
      match: { maxPrice: 3000 },
    });
  });
  afterEach(() => env.cleanup());

  test("REQ-007: a due alert is piped to the notify command on stdin", async () => {
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0] ?? "", /Notify watch/);
    assert.match(msgs[0] ?? "", /Bike Notify/);
  });

  test("REQ-007: when the notify command exits 1 the run exits non-zero and the next run sends the same alert again", async () => {
    const failing = await runCli(env, { env: { WATCHDOG_TEST_NOTIFY_FAIL: "1" } });
    assert.notEqual(failing.code, 0);
    assert.equal(messages(env).length, 0);
    const retry = await runCli(env);
    assert.equal(retry.code, 0, retry.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, "alert retried");
    assert.match(msgs[0] ?? "", /Bike Notify/);
    await runCli(env);
    assert.equal(messages(env).length, 1, "and not repeated once delivered");
  });

  test("REQ-007: with WATCHDOG_NOTIFY_CMD unset, run exits non-zero with a clear error and fetches nothing", async () => {
    const res = await runCli(env, { noNotify: true });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /WATCHDOG_NOTIFY_CMD/);
    assert.deepEqual(env.server.requests, []);
    assert.ok(!existsSync(join(env.dataDir, "state.json")));
    assert.equal(readText(env.notifyFile), null);
  });

  test("REQ-007: with WATCHDOG_NOTIFY_CMD unset, --dry-run still works", async () => {
    const res = await runCli(env, { noNotify: true, args: ["--dry-run"] });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Bike Notify/);
  });
});
