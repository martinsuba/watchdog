# Fixtures (real-site captures, trimmed)

Captured 2026-10-20 from agent-vps with Playwright (Chromium, locale en-GB, read-only, cookie banner dismissed).
Rendered DOM (`page.content()`), then trimmed by hand-written scripts: scripts, styles, images (`<picture>`, `<svg>`),
tile image JSON, reviews and long descriptions removed; only tiles/blocks an extractor needs kept.
Some tracking-style attributes remain (Canyon `data-gtm-impression`, Rose `onclick` dataLayer calls); they contain only
product data (ids, names, prices, categories), no user or session data. No personal data. Page content is untrusted data; fixtures are only parsed, never executed. Findings: docs/ARCHITECTURE.md
("External services / APIs"). The probe scripts live in `scripts/spike/`.

Acceptance tests use the synthetic pages in `tests/acceptance/pages/`; these fixtures are for extractor unit tests, and the Rose and Canyon acceptance tests (`rose.test.ts`, `canyon.test.ts`) serve them (changes stated at each use).

## rose/
| File | Origin | Content |
| --- | --- | --- |
| `sale-listing.html` | https://www.rosebikes.com/sale/bikes?sf=1 | 6 of the 48 page-1 tiles (Backroad FF x2, Backroad, Backroad AL Plus, Blend Gravel, Blend Road), result counter (63), next-page link |
| `sale-listing-empty.html` | https://www.rosebikes.com/sale/bikes?sf=1&size[]=ZZZ | Real "no match" page: counter 0, no tiles |
| `product-size-xs.html` | https://www.rosebikes.com/p/rose-backroad-ff-grx-rx825-di2-2709984 | Product page after clicking size XS: no colour is "green" (yellow = weeks, red = sold out) |
| `product-size-s.html` | same | Same page after clicking size S: three colours green, two sold out |

## canyon/
| File | Origin | Content |
| --- | --- | --- |
| `endurance-listing.html` | https://www.canyon.com/en-sk/road-bikes/endurance-bikes/ | 3 of 11 grid tiles + 1 carousel tile (must be ignored), counter 11 |
| `grail-cf-sl-listing.html` | https://www.canyon.com/en-sk/gravel-bikes/race/grail/?prefn1=pc_rahmen_modifikation_werkstoff&prefv1=CF%20SL | both grid tiles, the custom-bike promo `<li>` (no data-pid), 2 carousel tiles (one discounted: Grizl 6, one e-bike), counter 2 |
| `product-sizes.html` | https://www.canyon.com/en-sk/road-bikes/endurance-bikes/endurace/cf/endurace-cf-7/4427.html | Product page, default colour: sizes 2XS S L purchasable; XS M XL 2XL "notify me" |
| `listing-empty.html` | (synthetic) | Zero-tile listing with counter 0. NOT a real capture: Canyon redirects non-matching filters to the parent category |

## aliexpress/
Captured 2026-10-20 with `scripts/spike/aliexpress.ts` (Chromium en-US, desktop UA). Trimmed by `scripts/spike/aliexpress-trim.ts`
to: title, Product JSON-LD, product title, price block, SKU selectors, quantity note, buy/cart buttons. No block/captcha page
was seen in these 3 loads. On 2026-10-22 a reCAPTCHA block page did appear (docs/ARCHITECTURE.md); it was not saved, the acceptance tests use synthetic block pages.
| File | Origin | Content |
| --- | --- | --- |
| `product-sk-eur.html` | https://www.aliexpress.com/item/1005006902683405.html with cookie `aep_usuc_f=site=glo&c_tp=EUR&region=SK&b_locale=en_US` | English UI, price 371.95 EUR, InStock |
| `product-de-no-cookie.html` | same URL, no cookie (redirected to de.aliexpress.com) | German UI, price `354,69€` (JSON-LD 354.69), shows the region-dependent price |
