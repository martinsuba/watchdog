import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { listingHtml } from "./support/pages.ts";
import { makeEnv, messages, readHistory, runCli, todo, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-001 watch definitions", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
    env.server.set("/a.html", listingHtml([{ name: "Gravel Alpha", price: 2500, sizes: ["S"] }]));
    env.server.set("/b.html", listingHtml([{ name: "Road Beta", price: 1500, sizes: ["M"] }]));
  });
  afterEach(() => env.cleanup());

  test("REQ-001: two valid watch files are both checked", todo("T-004"), async () => {
    writeWatch(env, { id: "watch-a", urls: [env.server.url("/a.html")] });
    writeWatch(env, { id: "watch-b", urls: [env.server.url("/b.html")] });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const watches = new Set(readHistory(env).map((r) => r.watch));
    assert.deepEqual([...watches].sort(), ["watch-a", "watch-b"]);
    assert.ok(env.server.requests.includes("/a.html"));
    assert.ok(env.server.requests.includes("/b.html"));
  });

  test(
    "REQ-001: a watch file with a missing field is reported once, others still run, exit non-zero",
    todo("T-004"),
    async () => {
      writeWatch(env, { id: "watch-a", urls: [env.server.url("/a.html")] });
      writeWatch(env, { id: "watch-bad", urls: [env.server.url("/b.html")], extra: { urls: undefined } });
      const res = await runCli(env);
      assert.notEqual(res.code, 0);
      assert.match(res.stderr + res.stdout, /watch-bad/);
      assert.deepEqual([...new Set(readHistory(env).map((r) => r.watch))], ["watch-a"]);
      const invalid = messages(env).filter((m) => /invalid watch/i.test(m));
      assert.equal(invalid.length, 1, `messages: ${JSON.stringify(messages(env))}`);
      assert.match(invalid[0] ?? "", /watch-bad/);
      assert.ok(!env.server.requests.includes("/b.html"), "invalid watch must not be fetched");
    },
  );

  test(
    "REQ-001: a watch file with an unknown site is reported once, others still run, exit non-zero",
    todo("T-004"),
    async () => {
      writeWatch(env, { id: "watch-a", urls: [env.server.url("/a.html")] });
      writeWatch(env, { id: "watch-alien", site: "no-such-site", urls: [env.server.url("/b.html")] });
      const res = await runCli(env);
      assert.notEqual(res.code, 0);
      assert.match(res.stderr + res.stdout, /watch-alien/);
      assert.deepEqual([...new Set(readHistory(env).map((r) => r.watch))], ["watch-a"]);
      const invalid = messages(env).filter((m) => /invalid watch/i.test(m));
      assert.equal(invalid.length, 1, `messages: ${JSON.stringify(messages(env))}`);
      assert.match(invalid[0] ?? "", /watch-alien/);
    },
  );

  test("REQ-001: a watch with enabled: false is skipped", todo("T-004"), async () => {
    writeWatch(env, { id: "watch-a", urls: [env.server.url("/a.html")] });
    writeWatch(env, { id: "watch-off", enabled: false, urls: [env.server.url("/b.html")] });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual([...new Set(readHistory(env).map((r) => r.watch))], ["watch-a"]);
    assert.ok(env.server.requests.includes("/a.html"));
    assert.ok(!env.server.requests.includes("/b.html"), "disabled watch must not be fetched");
  });
});
