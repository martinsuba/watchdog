import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

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

/** One Chromium per run; pages are opened one at a time with a delay between them. Navigation only, read-only. */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private opened = 0;
  private readonly options: BrowserOptions;

  constructor(options: BrowserOptions) {
    this.options = options;
  }

  async withPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T> {
    if (this.context === null) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({ userAgent: USER_AGENT, locale: "en-GB" });
    }
    if (this.opened++ > 0) await new Promise((r) => setTimeout(r, this.options.delayMs()));
    const page = await this.context.newPage();
    try {
      page.setDefaultTimeout(this.options.timeoutMs);
      await page.goto(url, { timeout: this.options.timeoutMs, waitUntil: "load" });
      return await fn(page);
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
