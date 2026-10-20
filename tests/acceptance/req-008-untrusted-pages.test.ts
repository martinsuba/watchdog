import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { listingHtml } from "./support/pages.ts";
import { makeEnv, messages, runCli, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-008 safe handling of untrusted pages", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test("REQ-008: a product name with tags, control characters and 500 characters is plain text capped at 120", async () => {
    // escapeHtml() in pages.ts makes the tags literal text in the DOM, so the extractor sees "<b>Pro</b>".
    const hostile = `Bike <b>Pro</b><script>alert(1)</script> \u0007\u0001${"x".repeat(500)}`;
    env.server.set("/list.html", listingHtml([{ name: hostile, price: 2000, sizes: ["S"] }]));
    writeWatch(env, { id: "hostile", urls: [env.server.url("/list.html")], match: { maxPrice: 3000 } });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1);
    const msg = msgs[0] ?? "";
    assert.match(msg, /Bike\s+Pro/);
    assert.doesNotMatch(msg, /<\/?(b|script)/i, "markup stripped");
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(msg, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, "control characters stripped");
    const nameInMsg = /Bike\s+Pro\s+x+/.exec(msg)?.[0] ?? "";
    assert.ok(nameInMsg.length >= 60, `name present and not over-trimmed: "${nameInMsg}"`);
    assert.ok(nameInMsg.length <= 120, `whole name capped at 120 chars, got ${nameInMsg.length}`);
    assert.doesNotMatch(nameInMsg, /[<>]/);
    assert.ok(msg.length <= 3500);
  });

  test("REQ-008: a product link to another domain or javascript: is replaced by the watch URL", async () => {
    env.server.set(
      "/list.html",
      listingHtml([
        { name: "Bike Evil", price: 2000, sizes: ["S"], href: "https://evil.example/steal" },
        { name: "Bike Script", price: 2100, sizes: ["S"], href: "javascript:alert(1)" },
        { name: "Bike Honest", price: 2200, sizes: ["S"], href: "/p/honest" },
      ]),
    );
    const watchUrl = env.server.url("/list.html");
    writeWatch(env, { id: "links", urls: [watchUrl], match: { maxPrice: 3000 } });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msg = messages(env).join("\n");
    assert.match(msg, /Bike Evil/);
    assert.match(msg, /Bike Script/);
    assert.doesNotMatch(msg, /evil\.example/);
    assert.doesNotMatch(msg, /javascript:/i);
    // each offer's own block (from its name to the next offer name) must carry the replacement
    const names = ["Bike Evil", "Bike Script", "Bike Honest"];
    const block = (name: string) => {
      const start = msg.indexOf(name);
      const ends = names.map((n) => msg.indexOf(n, start + 1)).filter((i) => i > start);
      return msg.slice(start, ends.length ? Math.min(...ends) : undefined);
    };
    for (const name of ["Bike Evil", "Bike Script"]) {
      assert.ok(block(name).includes(watchUrl), `${name}: watch URL used instead, block: ${block(name)}`);
    }
    const urls = msg.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
    for (const u of urls) assert.equal(new URL(u).origin, env.server.origin, `foreign URL ${u}`);
    assert.ok(msg.includes(env.server.url("/p/honest")), "same-domain link kept");
  });

  test("REQ-008: a message with many long offers is capped at 3500 characters (one notify call)", async () => {
    const products = Array.from({ length: 40 }, (_, i) => ({
      name: `Bike ${String(i).padStart(2, "0")} ${"y".repeat(100)}`,
      price: 1000 + i,
      listPrice: 2000,
      sizes: ["S", "M", "L"],
    }));
    env.server.set("/list.html", listingHtml(products));
    writeWatch(env, { id: "many", urls: [env.server.url("/list.html")], match: { maxPrice: 3000 } });
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, "still one notify call");
    assert.ok((msgs[0] ?? "").length <= 3500, `length ${(msgs[0] ?? "").length}`);
    assert.match(msgs[0] ?? "", /Bike 00/, "first offer present");
  });
});
