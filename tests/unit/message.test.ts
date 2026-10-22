import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderBroken, renderInvalidWatch, renderMessage, renderRecovered } from "../../src/message.ts";

const WATCH = ["http://x/list"];
const alert = (name: string) => ({
  reasons: ["new" as const],
  offer: {
    id: name,
    name,
    url: `http://x/${name}`,
    price: 2800,
    currency: "EUR",
    sizes: [{ label: "S", available: true }],
    inStock: true,
  },
  matchingSizes: ["S"],
});

describe("renderMessage", () => {
  test("one message holds the watch name and every alert", () => {
    const msg = renderMessage("My watch", [alert("First"), alert("Second")], WATCH);
    assert.match(msg, /My watch/);
    assert.match(msg, /First/);
    assert.match(msg, /Second/);
    assert.match(msg, /new/i);
    assert.match(msg, /2800/);
    assert.match(msg, /http:\/\/x\/First/);
  });
  test("an offer note is shown under the offer, sanitized", () => {
    const a = alert("Noted");
    a.offer = { ...a.offer, note: "orderable with delivery in weeks: XS <b>x</b>" } as typeof a.offer;
    const msg = renderMessage("W", [a], WATCH);
    assert.match(msg, /\nNote: orderable with delivery in weeks: XS/);
    assert.doesNotMatch(msg, /<b>/);
  });
  test("an offer without a note has no Note line", () => {
    assert.doesNotMatch(renderMessage("W", [alert("Plain")], WATCH), /Note:/);
  });
});

describe("renderMessage details", () => {
  const base = alert("Detail");
  test("shows list price and discount percent, rounded", () => {
    const a = { ...base, offer: { ...base.offer, price: 850, listPrice: 1000 } };
    const msg = renderMessage("W", [a], WATCH);
    assert.match(msg, /850/);
    assert.match(msg, /1000/);
    assert.match(msg, /15 ?%/);
  });
  test("no list price or a list price not above the price: no discount shown", () => {
    assert.doesNotMatch(renderMessage("W", [base], WATCH), /%/);
    const a = { ...base, offer: { ...base.offer, listPrice: 2800 } };
    assert.doesNotMatch(renderMessage("W", [a], WATCH), /%/);
  });
  test("shows every reason", () => {
    const msg = renderMessage("W", [{ ...base, reasons: ["cheaper" as const, "new size" as const] }], WATCH);
    assert.match(msg, /cheaper/);
    assert.match(msg, /new size/);
  });
  test("lists matching sizes", () => {
    const msg = renderMessage("W", [{ ...base, matchingSizes: ["S", "M"] }], WATCH);
    assert.match(msg, /sizes: S, M/);
  });
});

describe("renderInvalidWatch", () => {
  test("contains 'invalid watch', the file and the problem", () => {
    const m = renderInvalidWatch({ file: "x.yaml", error: "x.yaml: urls: too small", hash: "h" });
    assert.match(m, /invalid watch/i);
    assert.match(m, /x\.yaml/);
    assert.match(m, /urls: too small/);
  });
});

describe("renderMessage hardening (REQ-008)", () => {
  const base = alert("Hard");
  const withOffer = (o: object) => ({ ...base, offer: { ...base.offer, ...o } });
  // eslint-disable-next-line no-control-regex
  const BAD = /[<>\u202E\u0007]/;

  test("foreign, javascript: and over-long links are replaced by the watch URL", () => {
    for (const url of ["https://evil.example/x", "javascript:alert(1)", `http://x/${"a".repeat(600)}`]) {
      const msg = renderMessage("W", [withOffer({ url })], WATCH);
      assert.ok(msg.includes("http://x/list"), url.slice(0, 30));
      assert.doesNotMatch(msg, /evil|javascript/);
    }
  });
  test("own-domain link is kept", () => {
    assert.match(renderMessage("W", [base], WATCH), /http:\/\/x\/Hard/);
  });
  test("names are sanitized and capped again at render time", () => {
    const name = `A\u202E<b>B</b>\u0007${"z".repeat(500)}`;
    const msg = renderMessage("W", [withOffer({ name })], WATCH);
    assert.doesNotMatch(msg, BAD);
    const shown = /\] (A B z+…?)/.exec(msg)?.[1] ?? "";
    assert.ok(shown.length > 50 && shown.length <= 120, String(shown.length));
  });
  test("watch name and sizes are sanitized too", () => {
    const msg = renderMessage("<i>W\u202E</i>", [{ ...base, matchingSizes: ["S\u0007", "<b>M</b>"] }], WATCH);
    assert.match(msg, /^Watchdog: W\n/);
    assert.match(msg, /sizes: S, M/);
  });
  test("many offers: at most 3500 chars, first offers kept whole, '... and N more' line", () => {
    const alerts = Array.from({ length: 40 }, (_, i) => alert(`Bike${String(i).padStart(2, "0")}${"y".repeat(100)}`));
    const msg = renderMessage("W", alerts, WATCH);
    assert.ok(msg.length <= 3500, String(msg.length));
    assert.match(msg, /Bike00/);
    const m = /… and (\d+) more\n$/.exec(msg);
    assert.ok(m, "footer present");
    const shown = (msg.match(/^\[new\]/gm) ?? []).length;
    assert.equal(shown + Number(m[1]), 40);
  });
  test("every kept URL is complete (never cut mid-URL)", () => {
    const alerts = Array.from({ length: 40 }, (_, i) => alert(`B${i}${"y".repeat(100)}`));
    const msg = renderMessage("W", alerts, WATCH);
    const urls = msg.match(/^http:\/\/\S+$/gm) ?? [];
    assert.ok(urls.length > 5);
    for (const u of urls) assert.match(u, /^http:\/\/x\/B\d+y{100}$/);
  });
  test("a short message has no 'more' line", () => {
    assert.doesNotMatch(renderMessage("W", [base], WATCH), /more/);
  });
});

describe("other messages are capped and sanitized (REQ-008)", () => {
  // eslint-disable-next-line no-control-regex
  const BAD = /[<>\u202E\u0007]/;
  test("invalid-watch message", () => {
    const m = renderInvalidWatch({ file: "x.yaml", error: "e".repeat(9000), hash: "h" });
    assert.ok(m.length <= 3500);
  });
  test("broken and recovered messages sanitize and cap the watch name", () => {
    const name = `<b>N\u202E</b>${"n".repeat(9000)}`;
    for (const m of [renderBroken(name, "r"), renderRecovered(name)]) {
      assert.ok(m.length <= 3500);
      assert.doesNotMatch(m, BAD);
    }
  });
  test("broken reason is sanitized", () => {
    assert.doesNotMatch(renderBroken("W", "a\u202E<b>x</b>\u0007"), BAD);
  });
});
