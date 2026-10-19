import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { listingHtml } from "./support/pages.ts";
import { makeEnv, messages, runCli, todo, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-008 safe handling of untrusted pages", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  test(
    "REQ-008: a product name with tags, control characters and 500 characters is plain text capped at 120",
    todo("T-010"),
    async () => {
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
      const longestX = Math.max(...[...msg.matchAll(/x+/g)].map((m) => m[0].length));
      assert.ok(longestX <= 120, `name capped at 120 chars, got ${longestX} x's`);
      assert.ok(longestX >= 60, `name not over-trimmed, got ${longestX} x's`);
      assert.ok(msg.length <= 3500);
    },
  );

  test(
    "REQ-008: a product link to another domain or javascript: is replaced by the watch URL",
    todo("T-010"),
    async () => {
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
      assert.ok(msg.includes(watchUrl), "watch URL used instead");
      assert.ok(msg.includes(env.server.url("/p/honest")), "same-domain link kept");
    },
  );
});
