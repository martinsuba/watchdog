import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run } from "../../src/run.ts";
import type { RunConfig } from "../../src/run.ts";
import { startServer } from "../acceptance/support/server.ts";
import type { TestServer } from "../acceptance/support/server.ts";
import { listingHtml } from "../acceptance/support/pages.ts";
import { DEFAULT_SELECTORS } from "../acceptance/support/harness.ts";

/** Every path under dir with its content (files) or a marker (dirs): equal snapshots = byte-identical directories. */
function snapshot(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const p = join(rel, name);
    if (statSync(join(dir, p)).isDirectory()) {
      out[`${p}/`] = "dir";
      Object.assign(out, snapshot(dir, p));
    } else out[p] = readFileSync(join(dir, p), "utf8");
  }
  return out;
}

describe("run in dry-run mode and with --watch", () => {
  let server: TestServer;
  let root: string;
  let watchesDir: string;
  let dataDir: string;
  let marker: string;
  let out: string[];

  const watch = (id: string, url: string, extra: Record<string, unknown> = {}) =>
    writeFileSync(
      join(watchesDir, `${id}.yaml`),
      stringify({
        id,
        name: `Watch ${id}`,
        site: "selectors",
        urls: [url],
        currency: "EUR",
        match: { maxPrice: 3000 },
        selectors: DEFAULT_SELECTORS,
        ...extra,
      }),
    );
  const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
    watchesDir,
    dataDir,
    notifyCmd: `touch '${marker}'`,
    browser: { timeoutMs: 8000, delayMs: () => 0 },
    out: (s) => out.push(s),
    ...over,
  });

  beforeEach(async () => {
    server = await startServer();
    root = mkdtempSync(join(tmpdir(), "wd-dry-"));
    watchesDir = join(root, "watches");
    dataDir = join(root, "data");
    marker = join(root, "notified");
    mkdirSync(watchesDir);
    mkdirSync(dataDir);
    out = [];
    server.set("/ok.html", listingHtml([{ name: "Bike Dry", price: 2000, sizes: ["S"] }]));
  });
  afterEach(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("dry run leaves the data dir byte-identical (corrupt state, old history, broken page, invalid watch)", async () => {
    watch("ok", server.url("/ok.html"));
    watch("down", server.url("/status/500"));
    writeFileSync(join(watchesDir, "bad.yaml"), "id: bad\n");
    writeFileSync(join(dataDir, "state.json"), "{ not json");
    for (let i = 1; i <= 5; i++) writeFileSync(join(dataDir, `state.json.corrupt-2026-01-0${i}T00-00-00.000Z`), "x");
    writeFileSync(
      join(dataDir, "history.csv"),
      "ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error\n2020-01-01T00:00:00.000Z,old,a,b,1,,EUR,,yes,\n",
    );
    const before = snapshot(dataDir);
    const code = await run(cfg({ dryRun: true, notifyCmd: undefined }));
    assert.deepEqual(snapshot(dataDir), before);
    assert.ok(!existsSync(marker), "notify not called");
    assert.equal(code, 1, "invalid and broken watches still make the exit code non-zero");
    const text = out.join("\n");
    assert.match(text, /would send/);
    assert.match(text, /Bike Dry/); // match message
    assert.match(text, /Watch down.*broken/s); // broken alert
    assert.match(text, /bad\.yaml/); // invalid-watch alert
  });

  test("dry run does not even create the data dir", async () => {
    rmSync(dataDir, { recursive: true });
    watch("ok", server.url("/ok.html"));
    assert.equal(await run(cfg({ dryRun: true })), 0);
    assert.ok(!existsSync(dataDir));
  });

  test("--watch runs only the selected watch", async () => {
    watch("one", server.url("/ok.html"));
    watch("two", server.url("/ok.html?two"));
    assert.equal(await run(cfg({ watchId: "two", dryRun: true })), 0);
    assert.equal(server.requests.length, 1);
    assert.match(out.join("\n"), /Watch two/);
    assert.doesNotMatch(out.join("\n"), /Watch one/);
  });

  test("--watch with an unknown id is an error and fetches nothing", async () => {
    watch("one", server.url("/ok.html"));
    assert.equal(await run(cfg({ watchId: "nope" })), 2);
    assert.deepEqual(server.requests, []);
    assert.ok(!existsSync(marker));
  });

  test("--watch naming an invalid watch is an error and fetches nothing", async () => {
    watch("one", server.url("/ok.html"));
    writeFileSync(join(watchesDir, "bad.yaml"), "id: bad\n");
    assert.equal(await run(cfg({ watchId: "bad" })), 2);
    assert.deepEqual(server.requests, []);
  });

  test("--watch does not alert about other invalid files (logged only) and keeps their stored state", async () => {
    watch("one", server.url("/ok.html"));
    writeFileSync(join(watchesDir, "bad.yaml"), "id: bad\n");
    assert.equal(await run(cfg({ watchId: "one" })), 0);
    assert.ok(existsSync(marker), "the selected watch's match was sent");
    const state = JSON.parse(readFileSync(join(dataDir, "state.json"), "utf8"));
    assert.equal(state.invalidFiles, undefined, "invalid file not recorded as alerted");
  });

  test("--watch runs a disabled watch when named explicitly", async () => {
    watch("off", server.url("/ok.html"), { enabled: false });
    assert.equal(await run(cfg({ watchId: "off", dryRun: true })), 0);
    assert.equal(server.requests.length, 1);
  });
});
