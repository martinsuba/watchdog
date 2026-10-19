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
- rosebikes.com sale listing: TBD (T-001)
- canyon.com en-sk category pages: TBD (T-001)
- aliexpress.com item page: TBD (T-002)
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
