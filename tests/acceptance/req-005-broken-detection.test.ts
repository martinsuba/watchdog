import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { listingHtml } from "./support/pages.ts";
import { listDir, makeEnv, messages, readHistory, runCli, todo, writeWatch } from "./support/harness.ts";
import type { Env } from "./support/harness.ts";

describe("REQ-005 broken watch detection", () => {
  let env: Env;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => env.cleanup());

  const good = () => env.server.set("/shop.html", listingHtml([{ name: "Bike Good", price: 2000, sizes: ["S"] }]));
  const watch = (id = "shop", path = "/shop.html") =>
    writeWatch(env, { id, name: `Shop ${id}`, urls: [env.server.url(path)], match: { maxPrice: 3000 } });
  const broken = (msgs: string[]) => msgs.filter((m) => /broken/i.test(m));

  test(
    "REQ-005: a page missing the expected structure sends one broken alert with a reason and saves a snapshot",
    todo("T-007"),
    async () => {
      watch("shop", "/no-structure.html");
      await runCli(env);
      const msgs = messages(env);
      assert.equal(msgs.length, 1, JSON.stringify(msgs));
      assert.match(msgs[0] ?? "", /Shop shop/);
      assert.match(msgs[0] ?? "", /broken/i);
      assert.match(msgs[0] ?? "", /broken:\s*\S+/i, "a reason follows 'broken:'");
      const files = listDir(join(env.dataDir, "broken", "shop"));
      assert.ok(
        files.some((f) => f.endsWith(".html")),
        `html snapshot in ${files}`,
      );
      assert.ok(
        files.some((f) => f.endsWith(".png")),
        `screenshot in ${files}`,
      );
    },
  );

  test("REQ-005: the same broken page on the next run sends no further alert", todo("T-007"), async () => {
    watch("shop", "/no-structure.html");
    await runCli(env);
    await runCli(env);
    assert.equal(messages(env).length, 1);
  });

  test(
    "REQ-005: once the page is fixed one 'recovered' message is sent, plus normal offer alerts",
    todo("T-007"),
    async () => {
      watch();
      env.server.set("/shop.html", "<html><body>maintenance</body></html>");
      await runCli(env);
      assert.equal(broken(messages(env)).length, 1);
      good();
      const res = await runCli(env);
      assert.equal(res.code, 0, res.stderr);
      const after = messages(env).slice(1);
      assert.equal(after.filter((m) => /recovered/i.test(m)).length, 1, JSON.stringify(after));
      assert.ok(
        after.some((m) => /Bike Good/.test(m)),
        "normal offer alert also sent",
      );
      await runCli(env);
      assert.equal(messages(env).length, 1 + after.length, "nothing more on the following run");
    },
  );

  test(
    "REQ-005: a broken watch keeps its alert state: no repeat offer alert after recovery",
    todo("T-007"),
    async () => {
      watch();
      good();
      await runCli(env);
      assert.equal(messages(env).length, 1, "initial offer alert");
      env.server.set("/shop.html", "<html><body>maintenance</body></html>");
      await runCli(env);
      good();
      await runCli(env);
      const rest = messages(env).slice(1);
      assert.equal(rest.length, 2, JSON.stringify(rest));
      assert.equal(rest.filter((m) => /recovered/i.test(m)).length, 1);
      assert.ok(!rest.some((m) => /Bike Good/.test(m)), "no repeat alert for the already alerted offer");
    },
  );

  test("REQ-005: a correctly structured page with zero products is not broken", todo("T-007"), async () => {
    watch("shop", "/empty-list.html");
    const res = await runCli(env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(messages(env), []);
    assert.deepEqual(listDir(join(env.dataDir, "broken")), []);
    assert.ok(env.server.requests.includes("/empty-list.html"), "page was actually fetched");
  });

  test(
    "REQ-005: a page that times out is broken with reason 'timeout' and other watches still run",
    todo("T-007"),
    async () => {
      watch("slowshop", "/slow");
      watch("goodshop", "/shop.html");
      good();
      await runCli(env, { env: { WATCHDOG_PAGE_TIMEOUT_MS: "1500" } });
      const msgs = messages(env);
      const brokenMsgs = broken(msgs);
      assert.equal(brokenMsgs.length, 1, JSON.stringify(msgs));
      assert.match(brokenMsgs[0] ?? "", /slowshop/);
      assert.match(brokenMsgs[0] ?? "", /timeout/i);
      assert.ok(
        msgs.some((m) => /Bike Good/.test(m)),
        "other watch still alerted",
      );
      assert.ok(readHistory(env).some((r) => r.watch === "goodshop"));
    },
  );

  test("REQ-005: an HTTP error status is broken", todo("T-007"), async () => {
    watch("errshop", "/status/500");
    await runCli(env);
    const msgs = messages(env);
    assert.equal(msgs.length, 1, JSON.stringify(msgs));
    assert.match(msgs[0] ?? "", /broken/i);
    assert.match(msgs[0] ?? "", /500|http/i);
  });

  test(
    "REQ-005: an unexpected currency is broken with reason 'unexpected currency' and nothing matches",
    todo("T-007"),
    async () => {
      env.server.set("/shop.html", listingHtml([{ name: "Bike Dollar", price: 100, symbol: "$", sizes: ["S"] }]));
      watch();
      await runCli(env);
      const msgs = messages(env);
      assert.equal(msgs.length, 1, JSON.stringify(msgs));
      assert.match(msgs[0] ?? "", /broken/i);
      assert.match(msgs[0] ?? "", /unexpected currency/i);
      assert.doesNotMatch(msgs[0] ?? "", /Bike Dollar/);
    },
  );
});
