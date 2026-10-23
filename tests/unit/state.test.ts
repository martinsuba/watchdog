import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInvalidFiles, loadState, saveState } from "../../src/state.ts";

describe("state", () => {
  test("missing file loads as empty state", () => {
    assert.deepEqual(loadState(join(tmpdir(), "does-not-exist-wd", "state.json")), {});
  });
  test("save then load round-trips, creates the directory and leaves no temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-state-"));
    try {
      const file = join(dir, "data", "state.json");
      const state = { w: { broken: null, alerted: { a: { price: 1, sizes: ["S"] } } } };
      saveState(file, state);
      assert.ok(existsSync(file));
      assert.deepEqual(loadState(file), state);
      assert.deepEqual(readdirSync(join(dir, "data")), ["state.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("invalidFiles is stored beside the watches and an old file without it loads as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-state-"));
    try {
      const file = join(dir, "state.json");
      const state = { w: { broken: null, alerted: {} } };
      saveState(file, state);
      assert.deepEqual(loadInvalidFiles(file), {});
      saveState(file, state, { "x.yaml": "abc" });
      assert.deepEqual(loadInvalidFiles(file), { "x.yaml": "abc" });
      assert.deepEqual(loadState(file), state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("state: corrupt file and broken entries", () => {
  const corruptFiles = (dir: string) => readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  function inDir(fn: (dir: string, file: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "wd-state-"));
    try {
      fn(dir, join(dir, "state.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const quiet = (fn: () => void) => {
    const orig = console.error;
    console.error = () => {};
    try {
      fn();
    } finally {
      console.error = orig;
    }
  };

  test("a dry run (readOnly) leaves a corrupt state file in place and creates no backup", () => {
    inDir((dir, file) => {
      writeFileSync(file, "{not json");
      quiet(() => assert.deepEqual(loadState(file, true), {}));
      assert.equal(readFileSync(file, "utf8"), "{not json");
      assert.deepEqual(corruptFiles(dir), []);
    });
  });
  test("a normal run renames a corrupt state file to a .corrupt-* backup", () => {
    inDir((dir, file) => {
      writeFileSync(file, "{not json");
      quiet(() => assert.deepEqual(loadState(file), {}));
      assert.equal(existsSync(file), false);
      assert.equal(corruptFiles(dir).length, 1);
    });
  });
  test("a non-object top level is treated as corrupt (renamed, or untouched when readOnly)", () => {
    inDir((dir, file) => {
      writeFileSync(file, "[1]");
      quiet(() => loadState(file, true));
      assert.deepEqual(corruptFiles(dir), []);
      quiet(() => loadState(file));
      assert.equal(corruptFiles(dir).length, 1);
    });
  });
  test("the same holds for loadInvalidFiles", () => {
    inDir((dir, file) => {
      writeFileSync(file, "{not json");
      quiet(() => assert.deepEqual(loadInvalidFiles(file, true), {}));
      assert.deepEqual(corruptFiles(dir), []);
      quiet(() => assert.deepEqual(loadInvalidFiles(file), {}));
      assert.equal(corruptFiles(dir).length, 1);
    });
  });

  const since = "2026-10-20T08:00:00.000Z";
  const brokenOf = (b: unknown) =>
    new Promise<unknown>((resolve) => {
      inDir((_dir, file) => {
        writeFileSync(file, JSON.stringify({ w: { broken: b, alerted: {} } }));
        resolve(loadState(file)["w"]?.broken);
      });
    });
  for (const [label, b] of [
    ["missing reason", { since }],
    ["non-string reason", { reason: 5, since }],
    ["missing since", { reason: "r" }],
    ["non-string since", { reason: "r", since: 5 }],
    ["a string", "broken"],
    ["null", null],
  ] as const) {
    test(`broken with ${label} loads as null`, async () => {
      assert.equal(await brokenOf(b), null);
    });
  }
  test("a valid broken entry loads unchanged", async () => {
    assert.deepEqual(await brokenOf({ reason: "r", since }), { reason: "r", since });
  });
});
