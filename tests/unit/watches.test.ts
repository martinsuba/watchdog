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
  test("errors name the file, the field path and the problem", () => {
    withDir({ "b.yaml": "id: b\nname: B\nsite: nope\nurls: []\n" }, (dir) => {
      const e = loadWatches(dir).invalid[0]?.error ?? "";
      assert.match(e, /^b\.yaml: /);
      assert.match(e, /site: /);
      assert.match(e, /urls: /);
    });
  });
  test("a YAML syntax error is reported as single capped line", () => {
    withDir({ "c.yaml": "id: [unclosed\n" + "x".repeat(2000) }, (dir) => {
      const e = loadWatches(dir).invalid[0]?.error ?? "";
      assert.ok(e.startsWith("c.yaml: "));
      assert.ok(!e.includes("\n"));
      assert.ok(e.length <= 400);
    });
  });
  test("an uppercase or invalid id is rejected", () => {
    withDir({ "Bad_Id.yaml": valid.replace("id: a", "id: Bad_Id") }, (dir) => {
      assert.match(loadWatches(dir).invalid[0]?.error ?? "", /id: /);
    });
  });

  for (const [field, line] of [
    ["match.nameIncludes", "match: {nameIncludes: ['  ']}"],
    ["match.nameExcludes", "match: {nameExcludes: ['']}"],
    ["match.sizes", "match: {sizes: [' ']}"],
  ] as const) {
    test(`blank entries in ${field} are invalid (they would match everything)`, () => {
      withDir({ "a.yaml": valid.replace("match: {maxPrice: 10}", line) }, (dir) => {
        const r = loadWatches(dir);
        assert.equal(r.watches.length, 0);
        assert.match(r.invalid[0]?.error ?? "", new RegExp(field.replace(".", "\\.")));
      });
    });
  }
  test("match terms are trimmed", () => {
    withDir(
      { "a.yaml": valid.replace("match: {maxPrice: 10}", "match: {nameIncludes: [' gravel '], sizes: [' 56 ']}") },
      (dir) => {
        const m = loadWatches(dir).watches[0]?.match;
        assert.deepEqual(m?.nameIncludes, ["gravel"]);
        assert.deepEqual(m?.sizes, ["56"]);
      },
    );
  });
});

describe("the watch files shipped in watches/", () => {
  test("all load without errors and use a known site", () => {
    const { watches, invalid } = loadWatches(new URL("../../watches/", import.meta.url).pathname);
    assert.deepEqual(invalid, []);
    const sites = Object.fromEntries(watches.map((w) => [w.id, w.site]));
    assert.equal(sites["rose-gravel"], "rose");
    assert.equal(sites["rose-road"], "rose");
  });
});

describe("watch id format", () => {
  for (const id of ["rose-gravel!", "Rose", "a b", "a_b", "a.b"]) {
    test(`id ${JSON.stringify(id)} is invalid`, () => {
      withDir({ [`${id}.yaml`]: valid.replace("id: a", `id: ${JSON.stringify(id)}`) }, (dir) => {
        const r = loadWatches(dir);
        assert.equal(r.watches.length, 0);
        assert.equal(r.invalid.length, 1);
      });
    });
  }
  test("a lowercase id with digits and dashes is valid", () => {
    withDir({ "rose-3.yaml": valid.replace("id: a", "id: rose-3") }, (dir) => {
      assert.equal(loadWatches(dir).watches.length, 1);
    });
  });
});
