// Spike (T-002): trims a saved AliExpress product page (from aliexpress.ts) into a small fixture.
// Usage: node scripts/spike/aliexpress-trim.ts <in.html> <out.html>
// Keeps: <title>, the Product JSON-LD, title, price block, SKU selectors, buy/cart buttons. Drops scripts, images, rest.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [inp, outp] = process.argv.slice(2);
if (!inp || !outp) throw new Error("usage: aliexpress-trim.ts <in.html> <out.html>");
const browser = await chromium.launch();
const ctx = await browser.newContext({ javaScriptEnabled: false });
const page = await ctx.newPage();
await page.setContent(readFileSync(inp, "utf8"));
const html = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => s.textContent ?? "")
    .find((t) => t.includes('"Product"'));
  const clean = (el: Element | null) => {
    if (!el) return "";
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll("script,style,svg,img,picture,video,noscript,iframe").forEach((n) => n.remove());
    c.querySelectorAll("*").forEach((n) => {
      for (const a of [...n.attributes])
        if (!["class", "data-pl", "data-sku-col", "data-sku-id", "aria-label", "title", "href"].includes(a.name))
          n.removeAttribute(a.name);
    });
    return c.outerHTML;
  };
  const parts = [
    clean(q('[data-pl="product-title"]')),
    clean(q('[class*="price-default--wrap"]')),
    clean(q('[class*="sku-item--wrap"]')?.parentElement ?? null),
    clean(q('[class*="quantity--info"]')),
    clean(q('[class*="buy-now--buynow"]')),
    clean(q('[class*="add-to-cart--addtocart"]')),
  ];
  return `<!doctype html><html><head><title>${document.title.replace(/</g, "")}</title>
<script type="application/ld+json">${ld ?? ""}</script></head><body>\n${parts.join("\n")}\n</body></html>\n`;
});
writeFileSync(outp, html);
console.log(outp, html.length, "bytes");
await browser.close();
