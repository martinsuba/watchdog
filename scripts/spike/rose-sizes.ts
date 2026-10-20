// Throwaway spike (T-001): on a Rose product page, click each frame size (UI state only, no cart) and print the
// per-colour availability traffic light that the page shows afterwards.
// Usage: node scripts/spike/rose-sizes.ts <product-url> [outPrefix]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [url, out] = process.argv.slice(2);
if (!url) throw new Error("usage: rose-sizes.ts <product-url> [outPrefix]");
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: "en-GB", viewport: { width: 1366, height: 1400 } })).newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);
const sizes = await page
  .locator("[data-test^='bike-step-value-size-'] input")
  .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
console.log("sizes", sizes);
for (const size of sizes) {
  await page.locator(`[data-test^='bike-step-value-size-'] input[value='${size}']`).locator("..").click();
  await page.waitForTimeout(2000);
  const colours = await page.evaluate(() =>
    [...document.querySelectorAll("[data-test^='bike-step-value-color-']")].map((el) => {
      const a = el.querySelector("[data-test='product-availability']");
      return `${el.getAttribute("data-test")?.replace("bike-step-value-color-", "")}=${a?.getAttribute("data-test-traffic-light-color")}/${a?.getAttribute("data-test-delivery-time-value")}`;
    }),
  );
  console.log(size, colours.join(" "));
  if (out) writeFileSync(`${out}-${size.replace(/\W/g, "_")}.html`, await page.content());
}
await browser.close();
