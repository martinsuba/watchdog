import type { Locator, Page } from "playwright";

/*
 * Cookie banners. Only buttons whose whole accessible name is one of the fixed phrases below are ever clicked: the
 * minimal choice if the banner offers it, otherwise "Allow all". Settings, "customise", links and every other button are
 * left alone. Role locators see through open shadow roots, so banners rendered in a shadow DOM are found too.
 * Button text is page content (untrusted), but it is only matched against these patterns, never used otherwise.
 */
const MINIMAL =
  /^(reject( all)?( cookies)?|deny( all)?|decline( all)?|refuse( all)?|(use |accept |allow )?(only )?(strictly )?(necessary|essential)( cookies)?( only)?)$/i;
const ALLOW_ALL = /^allow all( cookies)?$/i;

export type ConsentResult = "rejected" | "accepted" | "none";

const CLICK_TIMEOUT_MS = 2000;

async function click(button: Locator): Promise<boolean> {
  try {
    await button.click({ timeout: CLICK_TIMEOUT_MS });
  } catch {
    return false; // covered or already gone: the page is read anyway
  }
  await button.waitFor({ state: "hidden", timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
  return true;
}

/**
 * Dismisses the cookie banner if there is one. Waits up to `waitMs` for a banner to appear (use 0 for pages visited
 * after the consent was already given in the same browser context). Never throws for a missing or stubborn banner.
 */
export async function dismissCookieBanner(page: Page, waitMs: number): Promise<ConsentResult> {
  const minimal = page.getByRole("button", { name: MINIMAL });
  const allowAll = page.getByRole("button", { name: ALLOW_ALL });
  const either = minimal.or(allowAll).first();
  try {
    if (waitMs > 0) await either.waitFor({ state: "visible", timeout: waitMs });
    else if ((await either.count()) === 0) return "none";
  } catch {
    return "none";
  }
  if ((await minimal.count()) > 0) return (await click(minimal.first())) ? "rejected" : "none";
  if ((await allowAll.count()) > 0) return (await click(allowAll.first())) ? "accepted" : "none";
  return "none";
}
