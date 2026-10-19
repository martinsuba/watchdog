import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("harness: package is an ESM project on Node >= 24", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=24");
  assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
});
