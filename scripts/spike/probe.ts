// Throwaway spike probe (T-001): loads one page read-only and dumps rendered HTML + a screenshot.
// Usage: node scripts/spike/probe.ts <url> <outPrefix> [--scroll]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [url, out, flag] = process.argv.slice(2);
if (!url || !out) throw new Error("usage: probe.ts <url> <outPrefix> [--scroll]");
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "en-GB", viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
console.log("status", resp?.status(), "final", page.url());
await page.waitForTimeout(5000);
for (const label of ["Accept all", "Accept All", "Accept", "Alle akzeptieren", "Allow all"]) {
  const b = page.getByRole("button", { name: label }).first();
  if (await b.isVisible().catch(() => false)) {
    console.log("cookie button:", label);
    await b.click().catch(() => {});
    break;
  }
}
if (flag === "--scroll") {
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
  }
}
await page.waitForTimeout(2000);
writeFileSync(`${out}.html`, await page.content());
await page.screenshot({ path: `${out}.png`, fullPage: false });
console.log("title", await page.title());
await browser.close();
