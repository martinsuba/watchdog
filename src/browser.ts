import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExtractError } from "./errors.ts";
import { pruneSnapshots, snapshotStem } from "./snapshot.ts";

const KEEP_SNAPSHOTS = 5;
const SNAPSHOT_STEP_MS = 5_000;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type BrowserOptions = { timeoutMs: number; delayMs: () => number };

/** Defaults: 45 s per page, random 3-6 s between pages; overridable for tests via env (see cli.ts). */
export function browserOptionsFromEnv(env: NodeJS.ProcessEnv): BrowserOptions {
  const num = (v: string | undefined) =>
    v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  const timeoutMs = num(env.WATCHDOG_PAGE_TIMEOUT_MS) ?? 45_000;
  const fixedDelay = num(env.WATCHDOG_PAGE_DELAY_MS);
  return { timeoutMs, delayMs: () => fixedDelay ?? 3000 + Math.random() * 3000 };
}

/** Short single-line reason for a failed navigation (REQ-005). The message may contain page-derived text: capped. */
export function describeNavError(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return "timeout";
  const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
  return `load failed: ${msg.replace(/\s+/g, " ").trim()}`.slice(0, 120);
}

/** Rejects after `ms`; the timer is cleared as soon as the step settles so it cannot keep the process alive. */
const within = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("snapshot step timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

/** Best effort: HTML + screenshot of whatever the page shows. Content is untrusted data and is never executed. */
async function saveSnapshot(page: Page, dir: string): Promise<void> {
  try {
    mkdirSync(dir, { recursive: true });
    const stem = join(dir, snapshotStem(new Date()));
    await within(page.content(), SNAPSHOT_STEP_MS)
      .then((html) => writeFileSync(`${stem}.html`, html))
      .catch((e) => console.error(`snapshot html failed: ${e instanceof Error ? e.message : String(e)}`));
    await within(page.screenshot({ path: `${stem}.png`, timeout: SNAPSHOT_STEP_MS }), SNAPSHOT_STEP_MS).catch((e) =>
      console.error(`snapshot screenshot failed: ${e instanceof Error ? e.message : String(e)}`),
    );
    pruneSnapshots(dir, KEEP_SNAPSHOTS);
  } catch (e) {
    console.error(`snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** One Chromium per run; pages are opened one at a time with a delay between them. Navigation only, read-only. */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private opened = 0;
  private readonly options: BrowserOptions;

  constructor(options: BrowserOptions) {
    this.options = options;
  }

  /**
   * Opens `url` and runs `fn`. A load failure (timeout, HTTP >= 400, network) throws ExtractError with a short reason.
   * When anything fails and `snapshotDir` is given, HTML + screenshot are saved there (pruned to the last few).
   */
  async withPage<T>(url: string, fn: (page: Page) => Promise<T>, snapshotDir?: string): Promise<T> {
    if (this.context === null) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({ userAgent: USER_AGENT, locale: "en-GB" });
    }
    if (this.opened++ > 0) await new Promise((r) => setTimeout(r, this.options.delayMs()));
    const page = await this.context.newPage();
    try {
      page.setDefaultTimeout(this.options.timeoutMs);
      try {
        const response = await page.goto(url, { timeout: this.options.timeoutMs, waitUntil: "load" });
        if (response !== null && response.status() >= 400) throw new ExtractError(`HTTP ${response.status()}`);
      } catch (e) {
        throw e instanceof ExtractError ? e : new ExtractError(describeNavError(e));
      }
      return await fn(page);
    } catch (e) {
      if (snapshotDir !== undefined) await saveSnapshot(page, snapshotDir);
      throw e;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
  }
}
