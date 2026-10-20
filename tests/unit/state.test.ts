import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../../src/state.ts";

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
});
