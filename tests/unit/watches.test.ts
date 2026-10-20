import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWatches } from "../../src/watches.ts";

const valid = `id: a
name: A
site: selectors
urls: [http://x/1]
match: {maxPrice: 10}
selectors: {pageMarker: "#m", item: ".i", name: ".n", price: ".p"}
`;

function withDir(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "wd-watches-"));
  try {
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadWatches", () => {
  test("loads a valid watch and applies defaults", () => {
    withDir({ "a.yaml": valid }, (dir) => {
      const r = loadWatches(dir);
      assert.equal(r.invalid.length, 0);
      assert.equal(r.watches[0]?.currency, "EUR");
      assert.equal(r.watches[0]?.enabled, true);
    });
  });
  test("a broken file is reported and does not stop the others", () => {
    withDir({ "a.yaml": valid, "b.yaml": "id: b\n" }, (dir) => {
      const r = loadWatches(dir);
      assert.deepEqual(
        r.watches.map((w) => w.id),
        ["a"],
      );
      assert.equal(r.invalid.length, 1);
      assert.equal(r.invalid[0]?.file, "b.yaml");
    });
  });
  test("unknown site is invalid", () => {
    withDir({ "a.yaml": valid.replace("selectors\n", "nope\n") }, (dir) => {
      assert.equal(loadWatches(dir).invalid.length, 1);
    });
  });
  test("site selectors requires the selectors block", () => {
    withDir({ "a.yaml": valid.split("selectors: {")[0] ?? "" }, (dir) => {
      assert.equal(loadWatches(dir).invalid.length, 1);
    });
  });
  test("id must equal the file name", () => {
    withDir({ "zzz.yaml": valid }, (dir) => {
      assert.equal(loadWatches(dir).invalid.length, 1);
    });
  });
  test("disabled watches are loaded with enabled=false", () => {
    withDir({ "a.yaml": valid + "enabled: false\n" }, (dir) => {
      assert.equal(loadWatches(dir).watches[0]?.enabled, false);
    });
  });
});
