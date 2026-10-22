import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractorFor, EXTRACTORS } from "../../src/extractors/index.ts";
import { KNOWN_SITES } from "../../src/watches.ts";

describe("extractor registry", () => {
  test("has exactly one extractor per site a watch file may name", () => {
    assert.deepEqual(Object.keys(EXTRACTORS).sort(), [...KNOWN_SITES].sort());
  });
  test("rose and selectors are registered", () => {
    assert.equal(typeof extractorFor("rose"), "function");
    assert.equal(typeof extractorFor("selectors"), "function");
  });
  test("an unknown site is an error, not a silent fallback to the generic extractor", () => {
    assert.throws(() => extractorFor("nope"), /no extractor for site "nope"/);
  });
});
