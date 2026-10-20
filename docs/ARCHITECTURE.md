# Architecture: watchdog

## Overview (one paragraph + simple diagram in text)
A Node CLI run once a day by cron on agent-vps. For each watch file it opens the pages in headless Chromium, a
site-specific extractor turns the page into typed offers, the rules engine decides which offers match, the alert diff
compares with the last alerted state and, if something improved, one plain-text message per watch is piped into HAL's
`tg_send.sh`. Every check is appended to a local history CSV. No server, no database, no LLM.

```
cron (daily) ─> watchdog run
                  │ load + validate watches/*.yaml
                  │ for each watch:
                  │   browser (Playwright) ─> page ─> extractor[site] ─> offers[]
                  │   rules(match) ─> matching offers
                  │   diff(state.json) ─> alerts / broken / recovered
                  │   history.csv  <─ append rows
                  └─> notify: echo msg | $WATCHDOG_NOTIFY_CMD  (~/HAL/scripts/tg_send.sh -> Telegram)
```

## Stack (language, framework, DB, test tools) and why
- **Node 24 + TypeScript, run natively** (Node's built-in type stripping, no build step). Playwright is Node-native, the
  VPS already has Node 24 and Playwright's Chromium cached. `tsc --noEmit` for typechecking only.
- **playwright** (library) for fetching: Martin decided Playwright for all sites (2026-10-16).
- **yaml** for watch files (easy to edit from a phone on GitHub). Validation with **zod** (clear error messages).
- **No DB**: `data/state.json` (alert state) and `data/history.csv` (append-only, pruned). Tiny data, one writer.
- Tests: **node:test** + `node:assert` (unit and acceptance; zero extra runner). Acceptance tests run the CLI binary
  against a local static HTTP server serving fixture pages, with a fake notify command.
- ESLint + Prettier. CI: GitHub Actions (`npx playwright install --with-deps chromium`).

## Components and responsibilities
- `src/cli.ts`: argument parsing (`run [--dry-run] [--watch <id>] [--data-dir <dir>] [--watches-dir <dir>]`), exit codes.
  Test knobs (defaults in brackets): `--watches-dir` [`watches/`], `WATCHDOG_PAGE_TIMEOUT_MS` [45000],
  `WATCHDOG_PAGE_DELAY_MS` [random 3000–6000]. Acceptance tests use them to stay fast; see docs/TESTS.md.
- `src/watches.ts`: load `watches/*.yaml`, validate (zod), report invalid files without stopping others.
- `src/browser.ts`: one Chromium per run, one page per URL, timeouts (45 s), realistic UA, locale en-GB, 3–6 s delay
  between pages, snapshot (HTML + screenshot) on failure. Read-only: only navigation + extractor-specific actions
  (cookie banner, scroll/"load more").
- `src/extractors/<site>.ts`: `extract(page, watch) -> Offer[]`; throws `ExtractError(reason)` for missing page structure
  or block pages. Sites: `selectors` (generic, config-driven), `rose`, `canyon`, `aliexpress`.
- `src/price.ts`: price string → number + currency.
- `src/rules.ts`: pure function `matches(offer, match) -> {matched, matchingSizes}`.
- `src/diff.ts`: pure function `(prevState, matchingOffers) -> {alerts, nextState}` (new / cheaper / new size; forget
  non-matching).
- `src/message.ts`: render plain-text messages, sanitize + cap text, safe URLs.
- `src/notify.ts`: spawn `$WATCHDOG_NOTIFY_CMD` (via `sh -c`), message on stdin, non-zero = failure.
- `src/state.ts`, `src/history.ts`: atomic JSON write (temp file + rename); CSV append + 180-day prune.
- `watches/*.yaml`: watch definitions (data). `docs/REPAIR.md`: how an agent repairs a broken watch or adds a new one.

## Data model
Watch (YAML):
```yaml
id: rose-gravel                 # [a-z0-9-], unique, = file name
name: Rose Backroad (XS/S)
site: rose                      # selectors | rose | canyon | aliexpress
urls: [https://www.rosebikes.com/sale/bikes?sf=1]
currency: EUR
match:
  nameIncludes: [Backroad]
  nameExcludes: []
  maxPrice: 3000
  minDiscountPct: 15
  sizes: [XS, S, "50", "53"]
note: free text
# site: selectors only:
selectors: {pageMarker, item, name, price, listPrice, sizes, link}
```
Offer: `{id, name, url, price, listPrice?, currency, sizes: [{label, available}], inStock}` (id = stable per site,
e.g. product code or canonical URL).
State (`data/state.json`): `{ [watchId]: { broken: null | {reason, since}, alerted: { [offerId]: {price, sizes[]} } } }`.
History (`data/history.csv`): `ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error`.
All of `data/` is gitignored.

## External services / APIs
(Filled in by spikes T-001/T-002: real page structure, selectors/JSON sources, size labels, cookie banner, block pages,
fixtures under `tests/fixtures/<site>/`.)

### rosebikes.com sale listing (spike T-001, captured 2026-10-20)
Probe: `scripts/spike/probe.ts`, `scripts/spike/rose-sizes.ts`. Fixtures: `tests/fixtures/rose/` (see README there).
About 10 page loads in total, all HTTP 200, no captcha/block page, no cookie banner or consent dialog seen (en-GB,
datacenter IP), no login needed. Page is server-rendered HTML (tiles are custom elements `<catalog-product-tile>`); I
scrolled during capture, so "tiles present without scrolling" is likely but not tested separately.
- **Listing** `https://www.rosebikes.com/sale/bikes?sf=1`: 63 results, 48 tiles per page, plain pagination links
  (`a[data-test="pagination-next-link"]`, `href="/sale/bikes?sf=1&page=2"`; page 2 has the remaining 15). An extractor
  must follow pages until there is no next link (for Backroad/Shave no URL search parameter was verified).
- **Page marker** (structure OK, even when empty): `[data-test="catalog-result"]` with `<strong>N</strong> search results`.
  Real empty listing (`?sf=1&size[]=ZZZ`): marker present with `0`, no tiles, no pagination. Broken if the marker is missing,
  or N > 0 but no tiles, or tiles on a page != min(48, remaining N).
- **Per tile** (DOM, no JSON blob needed): tile `catalog-product-tile[data-test-abstract-sku]`; name
  `[data-test="catalog-product-tile__title"]` text (the `.product-tile-title__brand` span "Rose" is inside it; trim, names
  have trailing blanks, e.g. "Backroad FF GRX RX825 Di2 "); link `a.catalog-product-tile__link[href]` (relative, e.g.
  `/p/rose-backroad-ff-grx-rx825-di2-2709984`, sometimes with `?size=..&product_shape=..`); stable product id = abstract SKU
  (attribute above, = trailing number of the URL slug). `onclick` carries a dataLayer JSON (variant id, category, colour),
  not needed.
- **Prices**: sale price `.product-tile-price__current-value` (text `€4,000.00`, also in `content` attr, en format: `,`
  thousands, `.` decimals, `€` prefix); list price `.product-tile-price__old-value` (preceded by "instead of"); all 48 tiles on
  page 1 had both. Ignore `.product-tile-price__gp30-*` ("Best price in 30 days*: €4,450.00 (-10%)"): that is the EU
  legal 30-day reference price, not the list price. Discount for REQ-002 = (old - current) / old (example: 4500 -> 4000 = 11.1%,
  while the gp30 line says -10%). Currency is always EUR on this domain; check for `€`.
- **Sizes/availability are NOT in the listing** (tiles show only "N colours"). Product page needed, one per candidate
  (filter by name/price/discount from the listing first). Optional prefilter, unreliable: listing accepts `size[]=XS&size[]=S`
  (30 results vs 63) but whether it reflects stock was not verified, and only 12 tiles were rendered in my capture without
  scrolling.
- **Product page** (`/p/<slug>-<abstract sku>`, Vue-rendered, ready ~5 s after load): size labels (radio
  `[data-test="bike-step-value-size-*"] input[name="bike-select-size"]`, `value` = label): `XS S M M/L L XL` for the Backroad FF
  (road bikes are likely cm labels: the sale size filter lists `57cm 59cm 61cm 62cm 64cm` and `17" 19" 21" 23" 25"`; Shave
  not in sale yet, so its labels are unverified; normalise "59cm" -> "59" when matching). Prices on the page:
  `[data-test="price-cross"][data-test-price-value]` (list, in cents: 450000) and `[data-test="price-value-sale"]` (400000);
  JSON-LD `Offer` has price/currency only. **Availability is per (size, colour)** and appears only after a size is chosen:
  click a size radio (UI state only, no cart), wait ~2 s, then each colour
  `[data-test^="bike-step-value-color-"] [data-test="product-availability"]` has
  `data-test-traffic-light-color` = `green` (in stock, delivery in days, `data-test-delivery-time-value="6/day"`), `yellow`
  (orderable, delivery in weeks, "Available in 6 weeks", `N/week`) or `red` (sold out, the colour element is a
  `div[disabled]`, text "Sold out"). Before a size is chosen all colours show a hidden green: do not read it.
  Observed for Backroad FF GRX RX825 Di2: XS only yellow/red, S green x3, M-L green x2 + yellow, XL green x5.
  Recommendation: a size counts as available if any colour is green; yellow only as a note (decision for T-005/Martin).
  Cost: one page load + one click per wanted size (2 s each); sizes labelled XS/S need 2 clicks.
- **Recommended approach**: DOM only (no JSON). Listing pages -> filter by name (include "Backroad", exclude "Backroad AL";
  "Backroad FF" is included by the same word) and price/discount -> product page per remaining candidate, click wanted sizes,
  read traffic lights. `sale-listing.html` / `sale-listing-empty.html` / `product-size-xs|s.html` are the fixtures.
- Shave: not in the sale listing today (neither page; no "Shave" in the HTML), so the watch is a correctly structured empty result.

### canyon.com en-sk category pages (spike T-001, captured 2026-10-20)
Probe: `scripts/spike/probe.ts`. Fixtures: `tests/fixtures/canyon/`. 7 page loads, all HTTP 200, no captcha/block page.
Server-rendered Salesforce Commerce Cloud pages; no JSON blob needed.
- **Cookie banner**: yes, a consent dialog with a button named "Allow all" (Playwright `getByRole("button", {name: "Allow all"})`),
  click it before reading. Locale is part of the URL (`/en-sk/`), prices are EUR incl. 23 % Slovak VAT.
- **Pagination**: counter `.js-productCount` ("11 items" for Endurance, "2 items" for Grail CF SL); grid has `data-page-size="24"`.
  Both pages fit on one page; behaviour above 24 items (load more / next page) was not observed, so the extractor should
  require grid tiles == counter and treat a mismatch as broken (REQ-005).
- **Page marker**: `ul.productGrid__list` plus a numeric `.js-productCount`. Real empty state was NOT observed: a filter with no
  or an unknown value (`prefv1=ZZZ`, or `CF SL` on Endurance) makes Canyon redirect (HTTP 200) to the parent category
  (`/gravel-bikes/race/`, `/road-bikes/`, 7 / 49 items). The extractor must verify the final URL path equals the requested path
  and still contains the `prefv1` value; otherwise broken. `tests/fixtures/canyon/listing-empty.html` is synthetic (counter 0,
  no tiles) and the markup is an assumption.
- **Tiles**: only `div[data-product-tile-context="grid"][data-pid]` inside `ul.productGrid__list` are listings. Exclude
  (a) carousel tiles `data-product-tile-context="slider"` (recently visited/recommended: include other categories, e-bikes and the
  discounted Grizl 6), (b) promo `<li>` without `data-pid` (custom-bike teaser). Fields: name `a.productTileDefault__productName`
  text (= `title`); link `href` (absolute, with default colour `?dwvar_<id>_pv_rahmenfarbe=R139_P01`); model id from the URL
  `/<id>.html` (e.g. 4432; `data-pid` 50043665 is the colour variant, differs per colour); category/price JSON in
  `data-gtm-impression` (`item_category2` = "Endurance"/"Race", `price` is NET, `gross_price` = shown price) - the visible
  text is simpler.
- **Prices**: sale/current `.productTile__priceSale` (text `4.649 €`: `.` thousands, `€` suffix; configurable models show
  `From 9.300 €`, e.g. Endurace CFR); list price only when discounted: `s.productTile__priceOriginal` (`1.849 €`), plus
  `.productTile__priceSave` ("You save 200 €") and a badge `.productBadge--pricing` ("-11%"). No grid tile on the two watched
  pages was discounted on 2026-10-20 (the discounted markup was seen on a carousel tile, kept in the Grail fixture). Ignore
  `.productTile__priceMonthly` ("or from 775 €/Mo."). The product page uses `.productDescription__priceSale` (original-price
  element on the product page unobserved, probably analogous).
- **E-bikes**: the Endurance page contains only road bikes (Endurace:ON lives under `/electric-bikes/`, only mentioned in SEO
  text). Add `nameExcludes: [":ON"]` as a safety net.
- **Sizes/availability are NOT in the listing** (colour swatches only). Product page needed (candidates only): size buttons
  `ul.productConfiguration__optionsList[data-attribute-type="size"] button[data-product-size]`, labels `2XS XS S M L XL 2XL`
  (letters only, no cm). Available = class `productConfiguration__selectVariant--purchasable`; sold out =
  `--unpurchasable` + `js-unpurchasable` + `--notifyMe` (+ icon "notify me"). Careful: "unpurchasable" contains the
  substring "purchasable", match whole class tokens (`classList.contains`). Availability is per colour variant: the page
  loads the colour in the URL (default if absent; swatch `data-pdp-url` in the tile lists the others). Example Endurace CF 7
  default colour: 2XS S L available, XS M XL 2XL sold out; Grail CF 7: all 7 sizes available.
- **Recommended approach**: DOM only. Listing -> filter name/price/discount (list price absent = no discount, so most runs
  need zero product pages) -> product page for candidates (each colour of a candidate if size matters per colour).
  Unexplored: the `data-url` on size buttons (`.../Product-Variation?...&dwvar_<id>_pv_rahmengroesse=<size>`) probably returns
  JSON/HTML per variant and could save page loads.

### aliexpress.com item page (spike T-002, captured 2026-10-20)
Probe: `scripts/spike/aliexpress.ts` (one load per run), trimmer `scripts/spike/aliexpress-trim.ts`. Fixtures:
`tests/fixtures/aliexpress/`. Item 1005006902683405 (EliteWheels ENT 2.0), URL without tracking params. 3 page loads in
total, 30 s apart, desktop Chromium (UA Chrome 131 Linux, viewport 1366x900, locale en-US), no login, no captcha/slider
interaction, no proxy, no stealth plugin.
- **Result: NOT blocked.** All 3 loads: HTTP 200, full product page, price + buy buttons rendered. No block/captcha/punish
  page was seen, so there is no block fixture (not invented). The page loads `baxia` (AliExpress anti-bot SDK,
  `<script id="aplus-baxia">`, `o.alicdn.com/baxia/...`) but it never challenged us. Caveat: 3 loads from one IP
  say little about the long-term rate of challenges; the daily cadence (1 load/day) is far lighter than the spike.
  Likely block markers (NOT observed, from general knowledge, unverified): redirect to a URL containing `/punish` or
  `_____tmd_____`, `x5secdata` param, baxia dialog element. The extractor should treat "no Product JSON-LD and no
  `[class*=price-default--current]`" as broken ("blocked or changed") regardless of the exact block page.
- **Attempts**: (1) no cookie, en-US: redirected to `de.aliexpress.com/item/...?gatewayAdapt=glo2deu`, German UI, EUR,
  price 354.69 (`site=deu`, ship-to DE by IP/geo guess). (2) cookie `aep_usuc_f=site=glo&c_tp=EUR&region=SK&b_locale=en_US`
  (AliExpress's own region/currency cookie, set via `addCookies` on `.aliexpress.com`): stays on
  `www.aliexpress.com/item/1005006902683405.html`, English UI, EUR, ship-to Slovakia flag, price 371.95, shipping EUR 85.40.
  (3) same as (2) 30 s later: identical, 371.95. A cookie banner and a notification-permission popup overlay the page but do
  not block reading the DOM (no need to click them).
- **Currency/locale**: EUR in both cases (datacenter IP is geolocated well enough; the cookie makes it deterministic).
  The price DEPENDS ON REGION: 354.69 (DE) vs 371.95 (SK; the SK page also shows a 30-day-lowest reference price of 397.56 before discount, ignore it). Watch must pin the
  region cookie (SK) so the compared price is stable, and the threshold (330 EUR) must be judged against the SK price.
  Prices are EUR with VAT (`Price includes VAT`), shipping is extra and shown separately.
- **Where the data lives** (server-rendered, but the page is client-side-rendered afterwards; `window._d_c_.DCData` holds
  only i18n and images, no price/SKU blob):
  - Product JSON-LD (`<script type="application/ld+json">`, array; element with `"@type":"Product"`): `name`,
    `offers.price` (string `"371.95"`, dot decimals), `offers.priceCurrency` (`EUR`), `offers.availability`
    (`https://schema.org/InStock`). Cleanest source. It reflects the DEFAULT/selected SKU only.
  - DOM: price `[class*="price-default--current"]` (text `€371.95` with the cookie, `354,69€` with German locale, so
    prefer JSON-LD); title `h1[data-pl="product-title"]`; SKU options `[class*="sku-item--wrap"]` with
    `[data-sku-col]` and `sku-item--selected` for the chosen one. CSS class names carry a build hash suffix
    (`--F8OlYIo`): match by prefix `[class*="..."]`, never the full class.
  - Stock: in the in-stock state only indirect signals were seen: JSON-LD `InStock`, "Buy now"/"Add to cart" buttons
    (`[class*="buy-now--buynow"]`, `[class*="add-to-cart--addtocart"]`), `Max. 3 pcs/shopper`. The sold-out markup was not
    seen (not reproducible on demand).
  - Price is PER VARIANT (6 colour/depth options x bearing x width x hub). Shown/JSON-LD price is that of the default
    selection (50mm depth 28mm, steel bearing, 12x100/12x142, Shimano HG, Center Lock). Other variants need clicks (more
    loads, more risk). For a threshold watch, the default variant price is a reasonable "lowest-ish" proxy, but it can miss a
    cheaper variant; decide with Martin which variant counts.
- **Recommended extractor** (`site: aliexpress`): launch with the SK/EUR `aep_usuc_f` cookie, load
  `https://www.aliexpress.com/item/<id>.html`, wait for DOM content plus ~5-8 s, parse the Product JSON-LD (price,
  currency, availability), fall back to `price-default--current`. Verify `priceCurrency == EUR` and the final URL host/path
  still the item (else broken: redirected/blocked). One load per day, no retries beyond one.
- **Recommendation: implement** the extractor (it works today, JSON-LD is stable and simple), keeping D-006's "broken:
  blocked" path with the structural check above, and accept it may break without notice. Not worth variant clicking in v1.

### Other services
- Telegram: via `~/HAL/scripts/tg_send.sh`, usage `echo "text" | tg_send.sh`, plain text (no parse mode). Token managed
  by HAL, never read by watchdog.

## Security & privacy notes
- Public repo: watches are public by decision; no secrets anywhere in the repo. The only config is `WATCHDOG_NOTIFY_CMD`.
- Page content is untrusted: never evaluated, never fed to an LLM by the runner, only typed fields extracted, text
  sanitized/capped, link domains checked (REQ-008). Snapshots under `data/broken/` are for repair agents, who must treat
  them as untrusted data (stated in docs/REPAIR.md).
- No logins, forms or purchases. Polite: one run/day, sequential, delays.
- Fixtures committed to the public repo are trimmed to the structure needed (no full page dumps).

## Decisions
### D-001: Node + TypeScript without a build step
Context: Playwright is central; Martin is fine with Node or Python. · Options: Node/TS, Node/JS, Python+Playwright. ·
Decision: Node 24 TS via native type stripping. · Consequences: types and typecheck without bundler/tsc output; only
erasable TS syntax (no enums/namespaces) allowed.

### D-002: Per-site extractor code + generic rules engine
Context: shop pages differ a lot (listing vs product page, JSON vs DOM, size pickers). · Options: purely config-driven
selectors; per-site code; LLM extraction per run. · Decision: small extractor module per site, plus a `selectors`
extractor for simple shops; conditions are generic. · Consequences: a new shop is one small module (an AI setup task);
repairs are local to one file; no per-run LLM cost.

### D-003: Files instead of a database
Context: a few watches, one daily writer. · Decision: state.json + history.csv in gitignored `data/`. ·
Consequences: trivial backup and inspection; trend analysis later can read the CSV.

### D-004: Notify through a command (HAL's tg_send.sh)
Context: Martin agreed to reuse HAL's Telegram bot. · Decision: `WATCHDOG_NOTIFY_CMD`, message on stdin. ·
Consequences: watchdog never touches the token; tests use a fake command; channel can change without code changes.

### D-005: Production code pinned by deploy, watch files follow main
Context: Martin wants to edit watches from other devices (GitHub web → PR → merge), but code on main includes task PRs
the Lead merged, and every production deploy needs Martin's approval. · Options: production follows main (auto-deploy);
everything pinned to a release tag; code pinned + watches follow main. · Decision: production clone `~/apps/watchdog`
is checked out at a release tag (deploy skill); before each run the cron wrapper updates only `watches/` from
`origin/main` (`git fetch`, then replace `watches/` with `git archive origin/main watches`, so deleted watches
disappear too). · Consequences: watch changes go live next morning
after merge, code changes only after an approved deploy. A watch using a site/field the deployed code doesn't know is
reported as invalid (REQ-001), not crashing the run.

### D-006: AliExpress best effort, no paid workarounds
Context: heavy anti-bot, datacenter IP. Martin: try, nothing paid. · Decision: implement after the spike shows what is
reachable; block pages → "broken: blocked". · Consequences: this watch may stay broken; one alert only.
