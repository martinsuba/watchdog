import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { alertInvalid } from "../../src/invalid.ts";

const bad = (hash: string) => [{ file: "x.yaml", error: "x.yaml: urls: bad", hash }];

function recorder(failTimes = 0) {
  const sent: string[] = [];
  let fails = failTimes;
  return {
    sent,
    send: async (m: string) => {
      if (fails-- > 0) throw new Error("down");
      sent.push(m);
    },
  };
}

describe("alertInvalid", () => {
  test("same invalid content twice gives one alert", async () => {
    const r = recorder();
    const s1 = await alertInvalid(bad("h1"), {}, r.send);
    const s2 = await alertInvalid(bad("h1"), s1, r.send);
    assert.equal(r.sent.length, 1);
    assert.deepEqual(s2, { "x.yaml": "h1" });
  });
  test("changed invalid content alerts again", async () => {
    const r = recorder();
    const s1 = await alertInvalid(bad("h1"), {}, r.send);
    await alertInvalid(bad("h2"), s1, r.send);
    assert.equal(r.sent.length, 2);
  });
  test("fixed then broken again alerts again; entry removed while valid", async () => {
    const r = recorder();
    const s1 = await alertInvalid(bad("h1"), {}, r.send);
    const s2 = await alertInvalid([], s1, r.send);
    assert.deepEqual(s2, {});
    await alertInvalid(bad("h1"), s2, r.send);
    assert.equal(r.sent.length, 2);
  });
  test("notify failure is not remembered and is retried next run", async () => {
    const r = recorder(1);
    const s1 = await alertInvalid(bad("h1"), {}, r.send);
    assert.deepEqual(s1, {});
    await alertInvalid(bad("h1"), s1, r.send);
    assert.equal(r.sent.length, 1);
  });
});
