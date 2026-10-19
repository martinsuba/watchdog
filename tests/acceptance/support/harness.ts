import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { startServer } from "./server.ts";
import type { TestServer } from "./server.ts";
import { SEPARATOR } from "./constants.ts";

export const ROOT = new URL("../../../", import.meta.url).pathname;
const FAKE_NOTIFY = new URL("./fake-notify.ts", import.meta.url).pathname;

/** Selectors matching the markup produced by pages.ts and the static pages in ../pages/. */
export const DEFAULT_SELECTORS = {
  pageMarker: "#product-list",
  item: "article.item",
  name: ".name",
  price: ".price",
  listPrice: ".list-price",
  sizes: ".size", // a size is unavailable when it has class "unavailable"
  link: "a.link",
};

export type WatchSpec = {
  id: string;
  name?: string;
  site?: string;
  urls: string[];
  currency?: string;
  match?: Record<string, unknown>;
  enabled?: boolean;
  selectors?: Record<string, string>;
  /** extra/override raw fields (use undefined to drop a field, e.g. to make the watch invalid) */
  extra?: Record<string, unknown>;
};

export type Env = {
  server: TestServer;
  dir: string;
  watchesDir: string;
  dataDir: string;
  notifyFile: string;
  cleanup(): Promise<void>;
};

export async function makeEnv(): Promise<Env> {
  const server = await startServer();
  const dir = mkdtempSync(join(tmpdir(), "watchdog-acc-"));
  const watchesDir = join(dir, "watches");
  const dataDir = join(dir, "data");
  mkdirSync(watchesDir);
  return {
    server,
    dir,
    watchesDir,
    dataDir,
    notifyFile: join(dir, "notify.out"),
    cleanup: async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Write watches/<id>.yaml using the generic `selectors` extractor (REQ-009) unless site is overridden. */
export function writeWatch(env: Env, spec: WatchSpec): void {
  const doc: Record<string, unknown> = {
    id: spec.id,
    name: spec.name ?? `Watch ${spec.id}`,
    site: spec.site ?? "selectors",
    urls: spec.urls,
    currency: spec.currency ?? "EUR",
    match: spec.match ?? {},
    selectors: spec.selectors ?? DEFAULT_SELECTORS,
    ...spec.extra,
  };
  if (spec.enabled !== undefined) doc.enabled = spec.enabled;
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  writeFileSync(join(env.watchesDir, `${spec.id}.yaml`), stringify(doc));
}

export type RunResult = { code: number | null; stdout: string; stderr: string };

export type RunOptions = {
  args?: string[];
  /** env overrides; a key set to undefined is removed */
  env?: Record<string, string | undefined>;
  /** do not set WATCHDOG_NOTIFY_CMD at all */
  noNotify?: boolean;
  timeoutMs?: number;
};

/** Run the real CLI: node src/cli.ts run --watches-dir <..> --data-dir <..> [args]. */
export function runCli(env: Env, opts: RunOptions = {}): Promise<RunResult> {
  const childEnv: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    WATCHDOG_PAGE_DELAY_MS: "0", // harness-added: no polite delay in tests
    WATCHDOG_PAGE_TIMEOUT_MS: "8000", // harness-added: per-page timeout
    WATCHDOG_TEST_NOTIFY_FILE: env.notifyFile,
    ...(opts.noNotify ? {} : { WATCHDOG_NOTIFY_CMD: `node '${FAKE_NOTIFY}'` }),
    ...opts.env,
  };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const args = ["src/cli.ts", "run", "--watches-dir", env.watchesDir, "--data-dir", env.dataDir, ...(opts.args ?? [])];
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: ROOT, env: childEnv as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 90_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Messages the fake notify command received, in order. */
export function messages(env: Env): string[] {
  if (!existsSync(env.notifyFile)) return [];
  return readFileSync(env.notifyFile, "utf8")
    .split(SEPARATOR)
    .filter((m) => m.length > 0);
}

export type HistoryRow = Record<string, string>;

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export const HISTORY_HEADER = "ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error";

export function historyPath(env: Env): string {
  return join(env.dataDir, "history.csv");
}

/** history.csv rows keyed by header; [] if the file does not exist. */
export function readHistory(env: Env): HistoryRow[] {
  const path = historyPath(env);
  if (!existsSync(path)) return [];
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function listDir(path: string): string[] {
  return existsSync(path) ? readdirSync(path) : [];
}

/** True if text contains the amount in any common formatting ("2700", "2 700,00", "2.700", "2,700.00"). */
export function hasPrice(text: string, amount: number): boolean {
  const digits = String(amount).split("").join("[\\s.,\\u00a0\\u202f]?");
  return new RegExp(`(^|[^\\d])${digits}([.,]00)?([^\\d]|$)`).test(text);
}

/** Pre-create history.csv (REQ-006 prune test). */
export function seedHistory(env: Env, lines: string[]): void {
  mkdirSync(env.dataDir, { recursive: true });
  writeFileSync(historyPath(env), [HISTORY_HEADER, ...lines].join("\n") + "\n");
}

/**
 * Marks an acceptance test as not yet implemented: node:test runs it, shows it as TODO and does not fail the run on
 * failure. The builder of the named PLAN task removes the marker (see docs/TESTS.md).
 */
export function todo(task: string): { todo: string } {
  return { todo: task };
}
