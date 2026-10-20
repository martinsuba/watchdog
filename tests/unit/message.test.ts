import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderInvalidWatch, renderMessage } from "../../src/message.ts";

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
    const msg = renderMessage("My watch", [alert("First"), alert("Second")]);
    assert.match(msg, /My watch/);
    assert.match(msg, /First/);
    assert.match(msg, /Second/);
    assert.match(msg, /new/i);
    assert.match(msg, /2800/);
    assert.match(msg, /http:\/\/x\/First/);
  });
});

describe("renderMessage details", () => {
  const base = alert("Detail");
  test("shows list price and discount percent, rounded", () => {
    const a = { ...base, offer: { ...base.offer, price: 850, listPrice: 1000 } };
    const msg = renderMessage("W", [a]);
    assert.match(msg, /850/);
    assert.match(msg, /1000/);
    assert.match(msg, /15 ?%/);
  });
  test("no list price or a list price not above the price: no discount shown", () => {
    assert.doesNotMatch(renderMessage("W", [base]), /%/);
    const a = { ...base, offer: { ...base.offer, listPrice: 2800 } };
    assert.doesNotMatch(renderMessage("W", [a]), /%/);
  });
  test("shows every reason", () => {
    const msg = renderMessage("W", [{ ...base, reasons: ["cheaper" as const, "new size" as const] }]);
    assert.match(msg, /cheaper/);
    assert.match(msg, /new size/);
  });
  test("lists matching sizes", () => {
    const msg = renderMessage("W", [{ ...base, matchingSizes: ["S", "M"] }]);
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
