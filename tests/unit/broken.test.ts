import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderBroken, renderRecovered } from "../../src/message.ts";
import { pruneSnapshots, snapshotStem } from "../../src/snapshot.ts";
import { describeNavError } from "../../src/browser.ts";
import { loadInvalidFiles, loadState } from "../../src/state.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "wd-broken-"));

describe("broken messages", () => {
  test("broken message names the watch and the reason, on one line each", () => {
    const m = renderBroken("Shop X", "HTTP 500");
    assert.match(m, /Shop X/);
    assert.match(m, /broken: HTTP 500/);
  });
  test("reason is collapsed to one line and capped", () => {
    const m = renderBroken("W", `a\nb ${"x".repeat(500)}`);
    const line = m.split("\n").find((l) => /broken:/.test(l)) ?? "";
    assert.ok(line.length < 260, String(line.length));
    assert.ok(!line.includes("\n"));
    assert.equal(m.split("\n").filter((l) => /broken:/.test(l)).length, 1);
  });
  test("recovered message", () => {
    assert.match(renderRecovered("Shop X"), /Shop X.*recovered/s);
  });
});

describe("snapshots", () => {
  test("stem is filesystem safe and sorts chronologically", () => {
    const a = snapshotStem(new Date("2026-01-02T03:04:05.678Z"));
    const b = snapshotStem(new Date("2026-01-02T03:04:06.000Z"));
    assert.ok(!/[:]/.test(a));
    assert.ok(a < b);
  });
  test("prune keeps the newest N snapshots (html + png pairs) and ignores nothing else silently", () => {
    const dir = tmp();
    try {
      for (let i = 1; i <= 7; i++) {
        const stem = snapshotStem(new Date(Date.UTC(2026, 0, i)));
        writeFileSync(join(dir, `${stem}.html`), "x");
        writeFileSync(join(dir, `${stem}.png`), "x");
      }
      pruneSnapshots(dir, 5);
      const files = readdirSync(dir).sort();
      assert.equal(files.length, 10);
      assert.ok(files[0]?.startsWith(snapshotStem(new Date(Date.UTC(2026, 0, 3)))));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("prune on a missing directory is a no-op", () => {
    pruneSnapshots(join(tmpdir(), "wd-no-such-dir-xyz"), 5);
  });
});

describe("navigation error reasons", () => {
  test("playwright timeout -> timeout", () => {
    const e = new Error("Timeout 1500ms exceeded");
    e.name = "TimeoutError";
    assert.equal(describeNavError(e), "timeout");
  });
  test("other errors give a short single-line reason", () => {
    const r = describeNavError(new Error(`net::ERR_CONNECTION_REFUSED at http://x\n${"y".repeat(500)}`));
    assert.match(r, /^load failed: net::ERR_CONNECTION_REFUSED/);
    assert.ok(r.length <= 120);
    assert.ok(!r.includes("\n"));
  });
});

describe("corrupt state.json", () => {
  test("is moved aside, logged, and loads as empty state; the second read is also empty", () => {
    const dir = tmp();
    try {
      const file = join(dir, "state.json");
      writeFileSync(file, "{not json");
      const orig = console.error;
      const logged: string[] = [];
      console.error = (...a: unknown[]) => void logged.push(a.join(" "));
      try {
        assert.deepEqual(loadState(file), {});
        assert.deepEqual(loadInvalidFiles(file), {});
      } finally {
        console.error = orig;
      }
      assert.equal(logged.length, 1);
      assert.match(logged[0] ?? "", /corrupt/i);
      const names = readdirSync(dir);
      const kept = names.filter((n) => n.startsWith("state.json.corrupt-"));
      assert.equal(kept.length, 1, names.join());
      assert.equal(readFileSync(join(dir, kept[0] ?? ""), "utf8"), "{not json");
      assert.ok(!existsSync(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a non-object top level counts as corrupt; malformed watch entries are dropped", () => {
    const dir = tmp();
    try {
      const file = join(dir, "state.json");
      writeFileSync(file, "[1,2]");
      const orig = console.error;
      console.error = () => undefined;
      try {
        assert.deepEqual(loadState(file), {});
      } finally {
        console.error = orig;
      }
      writeFileSync(
        file,
        JSON.stringify({
          a: 5,
          b: { alerted: { o: { price: 1, sizes: [] } } },
          c: { broken: { reason: "r", since: "t" } },
        }),
      );
      assert.deepEqual(loadState(file), {
        b: { broken: null, alerted: { o: { price: 1, sizes: [] } } },
        c: { broken: { reason: "r", since: "t" }, alerted: {} },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
