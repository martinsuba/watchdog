import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendHistory, csvLine, HISTORY_HEADER } from "../../src/history.ts";

describe("csvLine", () => {
  test("quotes fields with commas, quotes and newlines", () => {
    assert.equal(csvLine(["a", "b,c", 'd"e', "f\ng"]), 'a,"b,c","d""e","f\ng"');
  });
});

describe("appendHistory", () => {
  test("writes the header once and appends rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-hist-"));
    try {
      const file = join(dir, "sub", "history.csv");
      const row = {
        ts: "t",
        watch: "w",
        offerId: "o",
        name: "n, x",
        price: 1,
        listPrice: undefined,
        currency: "EUR",
        sizesAvailable: ["S", "M"],
        matched: true,
        error: "",
      };
      appendHistory(file, [row]);
      appendHistory(file, [{ ...row, matched: false, listPrice: 2 }]);
      assert.equal(
        readFileSync(file, "utf8"),
        `${HISTORY_HEADER}\nt,w,o,"n, x",1,,EUR,S;M,yes,\nt,w,o,"n, x",1,2,EUR,S;M,no,\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
