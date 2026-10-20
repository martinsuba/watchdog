import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderInvalidWatch, renderMessage } from "../../src/message.ts";

const alert = (name: string) => ({
  reason: "new" as const,
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

describe("renderInvalidWatch", () => {
  test("contains 'invalid watch', the file and the problem", () => {
    const m = renderInvalidWatch({ file: "x.yaml", error: "x.yaml: urls: too small" });
    assert.match(m, /invalid watch/i);
    assert.match(m, /x\.yaml/);
    assert.match(m, /urls: too small/);
  });
});
