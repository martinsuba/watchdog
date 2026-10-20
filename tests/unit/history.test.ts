import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { appendHistory, csvLine, HISTORY_HEADER, neutralise, pruneHistory } from "../../src/history.ts";
import { pruneCorruptBackups } from "../../src/state.ts";

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

const NOW = Date.parse("2026-10-20T00:00:00.000Z");
const dayAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const tmp = () => mkdtempSync(join(tmpdir(), "wd-hist-"));

describe("neutralise (spreadsheet formula injection)", () => {
  test("prefixes a single quote to text starting with = + - @ (or tab/CR)", () => {
    for (const c of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) assert.equal(neutralise(c), `'${c}`);
    assert.equal(neutralise("Gravel =Alpha"), "Gravel =Alpha");
    assert.equal(neutralise(""), "");
  });
  test("appendHistory neutralises name and error but not numbers", () => {
    const dir = tmp();
    try {
      const file = join(dir, "h.csv");
      appendHistory(file, [
        {
          ts: "t",
          watch: "w",
          offerId: "o",
          name: '=HYPERLINK("x","y")',
          price: -5,
          currency: "EUR",
          sizesAvailable: [],
          matched: false,
          error: "",
        },
      ]);
      assert.equal(readFileSync(file, "utf8").split("\n")[1], `t,w,o,"'=HYPERLINK(""x"",""y"")",-5,,EUR,,no,`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a broken row has empty offer columns and the reason in error", () => {
    const dir = tmp();
    try {
      const file = join(dir, "h.csv");
      appendHistory(file, [{ ts: "t", watch: "w", error: "no, offers" }]);
      assert.equal(readFileSync(file, "utf8"), `${HISTORY_HEADER}\nt,w,,,,,,,,"no, offers"\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pruneHistory", () => {
  test("drops rows older than 180 days, keeps multi-line records intact, keeps unparsable ts", () => {
    const dir = tmp();
    try {
      const file = join(dir, "h.csv");
      writeFileSync(
        file,
        [
          HISTORY_HEADER,
          `${dayAgo(200)},w,o1,"Old\nmultiline, bike",1,,EUR,,no,`,
          `${dayAgo(179)},w,o2,"New\nmultiline, bike",1,,EUR,,no,`,
          `garbage,w,o3,Legacy,1,,EUR,,no,`,
        ].join("\n") + "\n",
      );
      const errs: string[] = [];
      const removed = pruneHistory(file, NOW, (m) => errs.push(m));
      assert.equal(removed, 1);
      assert.equal(
        readFileSync(file, "utf8"),
        [
          HISTORY_HEADER,
          `${dayAgo(179)},w,o2,"New\nmultiline, bike",1,,EUR,,no,`,
          `garbage,w,o3,Legacy,1,,EUR,,no,`,
        ].join("\n") + "\n",
      );
      assert.equal(errs.length, 1);
      assert.ok(readdirSync(dir).every((f) => !f.endsWith(".tmp")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("missing, empty, header-less and unterminated-quote files do not throw or lose data", () => {
    const dir = tmp();
    try {
      assert.equal(
        pruneHistory(join(dir, "none.csv"), NOW, () => {}),
        0,
      );
      const empty = join(dir, "e.csv");
      writeFileSync(empty, "");
      assert.equal(
        pruneHistory(empty, NOW, () => {}),
        0,
      );
      const odd = join(dir, "o.csv");
      const text = `legacy line\n${dayAgo(300)},w,o,"unterminated,1\n`;
      writeFileSync(odd, text);
      pruneHistory(odd, NOW, () => {});
      assert.ok(readFileSync(odd, "utf8").includes("unterminated"));
      appendFileSync(odd, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pruneCorruptBackups", () => {
  test("keeps the newest 3 state.json.corrupt-* files", () => {
    const dir = tmp();
    try {
      const file = join(dir, "state.json");
      for (const d of ["01", "02", "03", "04", "05"]) writeFileSync(`${file}.corrupt-2026-10-${d}T00-00-00.000Z`, "x");
      writeFileSync(file, "{}");
      pruneCorruptBackups(file, 3);
      assert.deepEqual(readdirSync(dir).sort(), [
        "state.json",
        "state.json.corrupt-2026-10-03T00-00-00.000Z",
        "state.json.corrupt-2026-10-04T00-00-00.000Z",
        "state.json.corrupt-2026-10-05T00-00-00.000Z",
      ]);
      assert.ok(existsSync(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
