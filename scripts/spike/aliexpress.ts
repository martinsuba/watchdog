// Spike probe (T-002): ONE read-only AliExpress page load per run. No captcha solving, no proxies, no login.
// Usage: node scripts/spike/aliexpress.ts <outPrefix> [--region] [--url <url>]
// --region sets AliExpress's own region/currency cookie (aep_usuc_f: ship-to SK, EUR, en_US).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args[0];
if (!out) throw new Error("usage: aliexpress.ts <outPrefix> [--region] [--url <url>]");
const ui = args.indexOf("--url");
const url = ui >= 0 ? args[ui + 1]! : "https://www.aliexpress.com/item/1005006902683405.html";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  locale: "en-US",
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
if (args.includes("--region")) {
  await ctx.addCookies([
    {
      name: "aep_usuc_f",
      value: "site=glo&c_tp=EUR&region=SK&b_locale=en_US",
      domain: ".aliexpress.com",
      path: "/",
    },
  ]);
}
const page = await ctx.newPage();
const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
console.log("status", resp?.status(), "final", page.url());
await page.waitForTimeout(8000);
writeFileSync(`${out}.html`, await page.content());
await page.screenshot({ path: `${out}.png` });
console.log("title", await page.title());
await browser.close();
