import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { dismissCookieBanner } from "../../src/extractors/consent.ts";

/** Synthetic banners (not Canyon's real markup, which is only known to offer an "Allow all" button). */
const SCRIPT = `<script>
window.clicked = [];
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { window.clicked.push(b.textContent.trim()); b.closest('.banner')?.remove(); }
});
</script>`;
const banner = (...labels: string[]) =>
  `<div class="banner" role="dialog">${labels.map((l) => `<button>${l}</button>`).join("")}</div>`;

describe("dismissCookieBanner", () => {
  let browser: Browser;
  let page: Page;
  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  after(async () => {
    await browser.close();
  });
  const clicked = () => page.evaluate(() => (window as unknown as { clicked: string[] }).clicked);

  test("clicks the necessary-only button when the banner offers one, nothing else", async () => {
    await page.setContent(banner("Settings", "Allow all", "Necessary only", "Buy now") + SCRIPT);
    assert.equal(await dismissCookieBanner(page, 500), "rejected");
    assert.deepEqual(await clicked(), ["Necessary only"]);
  });

  test("recognises a Reject button too", async () => {
    await page.setContent(banner("Accept all", "Reject all") + SCRIPT);
    assert.equal(await dismissCookieBanner(page, 500), "rejected");
    assert.deepEqual(await clicked(), ["Reject all"]);
  });

  test("clicks Allow all when there is no necessary-only choice, and never Settings or other buttons", async () => {
    await page.setContent(banner("Cookie settings", "Allow all", "Add to cart") + SCRIPT);
    assert.equal(await dismissCookieBanner(page, 500), "accepted");
    assert.deepEqual(await clicked(), ["Allow all"]);
  });

  test("finds a banner inside an open shadow root", async () => {
    await page.setContent(
      `<div id="host"></div><script>
      window.clicked = [];
      const root = document.getElementById('host').attachShadow({ mode: 'open' });
      root.innerHTML = '<div class="banner"><button>Allow all</button><button>Deny</button></div>';
      root.addEventListener('click', (e) => { window.clicked.push(e.target.textContent.trim()); root.innerHTML = ''; });
      </script>`,
    );
    assert.equal(await dismissCookieBanner(page, 500), "rejected");
    assert.deepEqual(await clicked(), ["Deny"]);
  });

  test("waits for a banner that shows up late", async () => {
    await page.setContent(
      `<script>window.clicked = [];
      setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<button onclick="window.clicked.push(1); this.remove()">Allow all</button>'); }, 300);
      </script>`,
    );
    assert.equal(await dismissCookieBanner(page, 3000), "accepted");
    assert.deepEqual(await clicked(), [1]);
  });

  test("does nothing and says so when there is no banner", async () => {
    await page.setContent(
      `<button onclick="window.clicked.push('x')">Add to cart</button><script>window.clicked=[]</script>`,
    );
    assert.equal(await dismissCookieBanner(page, 100), "none");
    assert.deepEqual(await clicked(), []);
  });

  test("a hidden button is not clicked", async () => {
    await page.setContent(`<button hidden>Allow all</button><script>window.clicked=[]</script>`);
    assert.equal(await dismissCookieBanner(page, 100), "none");
  });
});
