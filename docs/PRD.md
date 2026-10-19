# PRD: watchdog
Status: draft (plan PR, v1) · Last update: 2026-10-18

## Problem & why
Martin wants to buy specific bikes and wheels when they hit a good price. Checking several shop pages by hand every day
is tedious and deals get missed. watchdog checks the pages once a day and sends a Telegram message only when something
worth acting on appears. It is a generic mechanism: each "watch" is a small file (pages, what to extract, condition),
so new use cases are cheap to add.

Cheap by design: a normal run is a plain script (no LLM). AI (HAL or a builder) is only used to set up a new watch or
repair a broken extractor.

## Users
- Martin (only recipient of alerts, owner of the watch list).
- HAL / Claude sessions (add watches, repair extractors via PRs).

## Goals (measurable where possible)
- G1: All watches are checked once a day without manual work; a run takes < 5 minutes.
- G2: Martin gets a Telegram message within one daily run after a matching offer appears or improves. No message when
  nothing changed (no daily spam).
- G3: A broken page/extractor produces exactly one "broken" alert, with enough saved context (HTML snapshot, reason)
  for an agent to repair it.
- G4: Every check is recorded locally (history CSV, max 180 days) for later trend analysis.
- G5: Zero running cost (no paid services, no proxies, no LLM per run).

## Non-goals (explicitly out of scope)
- Viewing/analysing history (no command, chart or dashboard). Data is only saved; a viewer can be planned later.
- Automatic self-repair of broken extractors. Repair = agent fixes via a normal `fix/*` PR, guided by docs/REPAIR.md.
- Paid anti-bot workarounds (residential proxies, captcha solvers). Blocked sites just raise a "broken" alert.
- Logins, forms, carts, purchases, or any write action on shop sites.
- Multiple users or recipients; notification channels other than the configured command (Telegram via HAL's script).
- Off-the-shelf tools (changedetection.io etc.): Martin wants his own solution (decided 2026-10-16).
- Running more often than daily; real-time alerts.

## Requirements

### REQ-001: Watch definitions
Each watch is one YAML file in `watches/` (committed, public). Fields: `id`, `name`, `site` (extractor), `urls`,
`match` (conditions, see REQ-003), optional `currency` (default EUR), optional `note`, optional `enabled` (default true).
Acceptance criteria:
- Given two valid watch files, When `watchdog run` executes, Then both watches are checked.
- Given a watch file with a missing/invalid field or an unknown `site`, When `watchdog run` executes, Then the other
  watches still run, the invalid file is reported in the log and as one "invalid watch" alert, and the exit code is non-zero.
- Given a watch with `enabled: false`, When `watchdog run` executes, Then it is skipped.
Priority: must

### REQ-002: Daily run with a real browser
`watchdog run` opens each URL of each enabled watch in headless Chromium (Playwright), passes the page to the watch's
extractor and gets a list of offers: `{id, name, url, price, listPrice?, currency, sizes[{label, available}], inStock}`.
Pages are fetched sequentially with a polite delay.
Acceptance criteria:
- Given a watch pointing at a local test page listing 3 products, When `watchdog run` executes, Then 3 offers with
  correct name, price, list price and sizes are extracted (visible in the history CSV).
- Given a watch with 2 URLs, When run, Then offers from both pages are combined into one watch result.
Priority: must

### REQ-003: Conditions
An offer matches a watch when ALL configured conditions hold:
`nameIncludes` (any of, case-insensitive), `nameExcludes` (none of), `maxPrice` (price <= X),
`minDiscountPct` ((listPrice - price) / listPrice * 100 >= N; an offer without listPrice fails), `sizes`
(at least one of these size labels is available; labels compared case-insensitively), and availability (offer in stock /
at least one size available; always required). Offers whose currency differs from the watch currency never match and
make the watch broken (REQ-005, reason "unexpected currency").
Acceptance criteria:
- Given maxPrice 3000 and offers at 2999 and 3001, When run, Then only the 2999 offer matches.
- Given minDiscountPct 15 and offers discounted 15% and 14.9%, When run, Then only the 15% offer matches.
- Given sizes [XS, S] and an offer with only M/L available, When run, Then it does not match; with S available it matches
  and the message lists only the matching available sizes.
- Given nameIncludes [Backroad] and nameExcludes [AL], When run, Then "Backroad FF" matches and "Backroad AL" does not.
- Given an offer that is out of stock, When run, Then it does not match.
Priority: must

### REQ-004: Alerts only on change for the better
Per watch, watchdog remembers the matching offers it last alerted about (offer id → price, matching sizes).
An alert is sent when: (a) an offer starts matching, (b) a matching offer's price is lower than when last alerted,
(c) a matching offer gets a new matching size available. No alert when nothing improved (same or higher price, fewer
sizes). An offer that stops matching is forgotten, so matching again later alerts again. All alert-worthy offers of a
watch in one run go into one message: watch name, and per offer: name, price, list price + discount %, matching sizes,
URL, and why (new / cheaper / new size).
Acceptance criteria:
- Given a newly matching offer, When run twice with the same page, Then exactly one alert is sent (first run).
- Given an alerted offer whose price drops from 2800 to 2700, When run, Then one "cheaper" alert is sent.
- Given an alerted offer whose price rises, or whose sizes shrink, When run, Then no alert is sent.
- Given an alerted offer that gains a new matching size, When run, Then one "new size" alert is sent.
- Given an alerted offer that disappears, then reappears matching, When run, Then a "new" alert is sent again.
- Given 2 newly matching offers in one watch, When run, Then one message containing both is sent.
Priority: must

### REQ-005: Broken watch detection
A watch is broken when a page cannot be loaded (timeout, HTTP error), shows an anti-bot/captcha page, the extractor
cannot find the page structure it expects, or currency is unexpected. An empty product list on a correctly structured
page (e.g. a model not on sale yet) is NOT broken. On the first broken run watchdog sends one "watch X is broken:
<reason>" alert and saves an HTML snapshot + screenshot under `data/broken/<watch-id>/`. While broken, no further broken
alerts. On the first successful run after that, one "watch X recovered" message. A broken watch keeps its alert state
(REQ-004) unchanged.
Acceptance criteria:
- Given a test page missing the expected product-list structure, When run, Then one broken alert with reason is sent and a
  snapshot file exists.
- Given the same broken page on the next run, When run, Then no alert is sent.
- Given the page is fixed, When run, Then one "recovered" message is sent (plus normal offer alerts if any).
- Given a correctly structured page with zero products, When run, Then no broken alert is sent.
- Given a page that times out, When run, Then the watch is reported broken with reason "timeout" and other watches still run.
Priority: must

### REQ-006: History
Every run appends one row per extracted offer to `data/history.csv` (gitignored): timestamp, watch id, offer id, name,
price, list price, currency, available sizes, matched (yes/no). Broken checks append one row with the reason. Rows older
than 180 days are pruned at the start of each run.
Acceptance criteria:
- Given a run extracting 3 offers, When it finishes, Then history.csv has 3 new rows with the listed columns.
- Given rows older than 180 days, When run, Then they are removed and newer rows are kept.
Priority: must

### REQ-007: Notification via command
Messages are sent by running the command in `WATCHDOG_NOTIFY_CMD` with the message text on stdin (production:
`~/HAL/scripts/tg_send.sh`, plain text). If the command fails, the watch's alert state is not advanced (so the alert is
retried next run) and the exit code is non-zero. If the variable is unset, `run` refuses to start (except `--dry-run`).
Acceptance criteria:
- Given a notify command that records stdin to a file, When an alert is due, Then the file contains the message.
- Given a notify command that exits 1, When an alert is due, Then the next run sends the same alert again.
- Given WATCHDOG_NOTIFY_CMD is unset, When `watchdog run` executes, Then it exits non-zero with a clear error.
Priority: must

### REQ-008: Safe handling of untrusted pages
Fetching is read-only: navigation and, where a site needs it, dismissing a cookie banner or scrolling/"load more". No
logins, forms, carts. Page content is untrusted: only typed fields are extracted; text fields are stripped of control
characters and markup, and capped (name 120 chars, message 3500 chars). URLs in messages must be http(s) on the watch's
own domain, otherwise replaced by the watch URL.
Acceptance criteria:
- Given a product name containing HTML tags, control characters and 500 characters, When an alert is sent, Then the
  message contains plain text capped at 120 characters for that name.
- Given a product link pointing to another domain or `javascript:`, When an alert is sent, Then the watch URL is used instead.
Priority: must

### REQ-009: Generic selectors extractor
`site: selectors` lets a watch define CSS selectors (item, name, price, listPrice, sizes, link, plus a `pageMarker` that
must exist) so simple shops need no code. Prices are parsed from common formats ("2 999,00 €", "€2,999.00", "2.999 €").
Acceptance criteria:
- Given a local test page and a selectors watch, When run, Then offers are extracted as configured.
- Given price strings in the formats above, When parsed, Then the numeric values are correct.
Priority: must (also the vehicle for engine acceptance tests)

### REQ-010: Rose Bikes extractor
Extracts sale offers from rosebikes.com sale listing pages incl. list price and available sizes. Watches:
`rose-gravel` (Backroad, Backroad FF: <= 3000 EUR, >= 15% off, sizes XS/S (50/53)) and `rose-road` (Shave: <= 4500 EUR,
>= 15% off, sizes L/XL (58/59); appears when it enters the sale).
Acceptance criteria:
- Given the recorded Rose fixtures (from the spike), When run, Then the expected offers, prices and sizes are extracted.
- Given a Rose fixture without any Shave, When `rose-road` runs, Then no alert and no broken alert.
Priority: must

### REQ-011: Canyon extractor
Extracts offers from canyon.com en-sk category pages incl. sale price, original price, available sizes. Watches:
`canyon-endurance` (<= 4500 EUR, >= 15% off, L/XL; e-bikes excluded) and `canyon-grail` (Grail CF SL page: <= 3000 EUR,
>= 15% off, XS/S).
Acceptance criteria:
- Given the recorded Canyon fixtures, When run, Then the expected offers, prices and sizes are extracted.
Priority: must

### REQ-012: AliExpress extractor (best effort)
Extracts price and availability for one product page (item 1005006902683405, EliteWheels ENT 2.0, tracking params
dropped). Watch `aliexpress-ent`: price < 330 EUR. No paid workarounds: if AliExpress serves a captcha/slider page, the
extractor reports "blocked" and the watch is broken (REQ-005).
Acceptance criteria:
- Given the recorded product fixture, When run, Then price, currency and availability are extracted.
- Given the recorded captcha/block fixture, When run, Then the watch is broken with reason "blocked".
Priority: should

### REQ-013: Dry run and single watch
`watchdog run --dry-run` prints the messages it would send and changes no state (no notify, no state/history writes);
`--watch <id>` runs only that watch. Used for staging checks and repairs.
Acceptance criteria:
- Given a due alert, When `run --dry-run` executes, Then the message is printed, the notify command is not called and state
  is unchanged.
- Given 3 watches, When `run --watch <id>` executes, Then only that watch is fetched.
Priority: must

## Constraints (budget, privacy, data, platforms)
- No running cost: no paid APIs, proxies or services; no LLM per run.
- Runs privately on agent-vps (2 vCPU, 3.8 GB RAM), once a day. One headless Chromium at a time.
- Public repo: code and watch files are public; nothing secret in them. History/state/snapshots stay local (gitignored).
- Telegram bot token lives only in HAL's existing setup; watchdog never reads it, it just calls `tg_send.sh`.
- Test fixtures are trimmed, minimal copies of shop page structure (no full saved pages, no personal data).

## Open questions
- Exact size labels per site (letters vs frame sizes 50/53/58/59): decided by the spikes (T-001/T-002); watches list both.
- Canyon Endurance: exclude e-bikes (Endurance:ON) by default. Martin to confirm in the PR.
- Rose Backroad: aluminium "Backroad AL" (if listed) is included unless Martin says otherwise.
- AliExpress from a datacenter IP: likely blocked; spike T-002 shows whether it works at all.
