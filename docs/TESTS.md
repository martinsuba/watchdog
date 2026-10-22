# Tests: watchdog

## How to run
Node 24 is required. All commands run from the repo root.

- Install: `npm ci` (then once per machine/CI: `npx playwright install --with-deps chromium`)
- Lint: `npm run lint`
- Format check: `npm run format:check` (fix with `npm run format`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Unit: `npm run test:unit` (node:test over `tests/unit/**/*.test.ts`)
- Acceptance: `npm run test:acceptance` (node:test over `tests/acceptance/*.test.ts`, 2 files in parallel)
- Everything tested: `npm test` (unit, then acceptance)
- One acceptance file: `node --test tests/acceptance/req-004-alert-diff.test.ts`
- One case: `node --test --test-name-pattern="REQ-004: .*cheaper" tests/acceptance/req-004-alert-diff.test.ts`

CI (`.github/workflows/ci.yml`, job `ci`, required check) runs: `npm ci`, Playwright Chromium install, lint,
format check, typecheck, unit, acceptance. `acceptance-guard.yml` blocks PRs that touch `tests/acceptance/` or
`.github/workflows/` without the `acceptance-change` label or a successful `test-review` status.

## Mutation testing
Report only, never a gate (ARCHITECTURE D-007). Stryker (`@stryker-mutator/core`, pinned devDependency) with the
`command` test runner; config in `stryker.config.json`.

- Run all: `npm run mutation` (about 800 mutants, estimated 20-25 min on 2 vCPUs; heavy, prefer CI).
- Run a small subset locally: `npx stryker run --mutate src/price.ts` (about 2.5 min).
- Mutated: `src/rules.ts`, `diff.ts`, `price.ts`, `sanitize.ts`, `state.ts`, `history.ts`, `message.ts`, `watches.ts`.
  Not mutated: browser/CLI glue and extractors (covered by the acceptance tests).
- Each mutant runs `npm run test:mutation`: a browser-free unit subset (no Playwright, no temp git repos):
  `tests/unit/{rules,diff,price,sanitize,state,history,message,watches}.test.ts`. A mutant survives when all pass.
- CI: `.github/workflows/mutation.yml` runs on `chore/milestone-*` PRs and `workflow_dispatch`, timeout 45 min, not a
  required check. Artifact `mutation-report`: `mutation.json`, `mutation.html` (open in a browser; shows survivors per
  line); the clear-text table with survivors is in the job log. Locally the files are in `reports/mutation/`.
- Reading it: "Survived" mutants in alert/data code (rules, diff, state, history, message) point at missing assertions;
  survivors in error message strings are usually noise. `thresholds.break` is null: the score never fails the job.

## Acceptance test design
Acceptance tests drive the real CLI as a subprocess: `node src/cli.ts run --watches-dir <tmp> --data-dir <tmp> [flags]`.
No imports of feature code, except the REQ-009 price parser case (`parsePrice` from `src/price.ts`).

Support code in `tests/acceptance/support/`:
- `server.ts`: static HTTP server (`127.0.0.1`, random port). `/<file>.html` serves `tests/acceptance/pages/<file>.html`;
  `server.set(path, html)` overrides a page in memory (tests change pages between runs); `/status/<code>` answers with
  that HTTP status; `/slow` never answers (timeout); `server.requests` lists requested paths.
- `fake-notify.ts`: the notify command. Appends stdin + a separator to the file in `WATCHDOG_TEST_NOTIFY_FILE`;
  with `WATCHDOG_TEST_NOTIFY_FAIL=1` records nothing and exits 1.
- `harness.ts`: `makeEnv()` (server + temp watches/data dirs), `writeWatch()` (YAML with `site: selectors` pointing at
  the local server), `runCli()`, `messages()` (what notify received), `readHistory()` (parsed `history.csv`), `hasPrice()`.
- `pages.ts`: `listingHtml(products)` builds a synthetic listing page. Static pages are in `tests/acceptance/pages/`.

### Contract the tests assume (read before implementing)
Harness-added CLI option and env vars (not in ARCHITECTURE.md originally; the engine must support them):
- `--watches-dir <dir>`: directory with the watch YAML files (default: `watches/` of the repo).
- `WATCHDOG_PAGE_TIMEOUT_MS`: per-page navigation timeout (default 45000). Tests use 8000, or 1500 for the timeout case.
- `WATCHDOG_PAGE_DELAY_MS`: delay between pages (default 3000 to 6000 random). Tests set 0.
- `--data-dir <dir>`: already in ARCHITECTURE.md.

Selectors-extractor conventions (watch field `selectors`, all CSS): `pageMarker` (must exist, else broken), `item`
(per offer), `name`, `price`, `listPrice` (optional), `sizes` (one element per size, text = label; a size is
unavailable when the element has class `unavailable`), `link` (an `a` element, `href`, resolved against the page URL).
An offer is out of stock when its `item` element has class `out-of-stock` (works for offers without sizes), or when it has size elements and none is available; otherwise it is in stock. Offer id derives from the link.
`history.csv` header: `ts,watch,offer_id,name,price,list_price,currency,sizes_available,matched,error`; `ts` ISO 8601;
`price`/`list_price` plain numbers (`2999` or `2999.00`), `list_price` empty when absent; `matched` is `yes`/`no`;
`sizes_available` lists the available labels; `error` holds the reason for a broken check.
Message wording the tests look for (case-insensitive): "new", "cheaper", "new size", "broken: <reason>", "recovered",
"invalid watch", reasons containing "timeout", "unexpected currency" (and an HTTP status or "http" for HTTP errors).
Snapshots: `<data-dir>/broken/<watch-id>/` contains at least one `.html` and one `.png` file.

### Fixture rules
Synthetic pages only. The harness contains no real shop HTML. Real-site fixtures (trimmed) come with the M2 tasks under
`tests/fixtures/<site>/`; their acceptance tests (REQ-010 to REQ-012) are added by those tasks.

## The todo rule
Features are not implemented when the harness lands, so every acceptance test is marked
`test(name, todo("T-00x"), fn)` (`todo()` from `support/harness.ts`, i.e. node:test `{ todo: "T-00x" }`). node:test
still runs these tests and reports them as TODO, but a failure does not fail the run, so CI stays green while the
tests are written ahead of the code.
- The marker names the PLAN task that implements the behaviour.
- The builder of that task removes the marker for the tests the task lists under "Acceptance tests to make pass" in the
  same PR (this edit to `tests/acceptance/` is part of the approved task; the PR then needs test-review). From then on
  the test must pass, and a failure fails CI.
- Nobody weakens an assertion to get green. A test that seems wrong is reported to the Project Lead.
- Check: `grep -rn 'todo("' tests/acceptance` lists what is still outstanding.

## REQ → tests
Status: `todo` until the task in the "Un-todo task" column removes the markers; that task also updates this column.

| REQ | Acceptance test(s) (file `tests/acceptance/...`) | Un-todo task | Status |
|---|---|---|---|
| REQ-001 | `req-001-watch-definitions.test.ts`: two valid files both checked; missing field reported once + others run + non-zero exit; unknown site, same; `enabled: false` skipped | T-004 | done |
| REQ-002 | `req-002-daily-run.test.ts`: 3 products give 3 offers with name/price/list price/sizes; 2 URLs combined into one watch result | T-003 | done |
| REQ-003 | `req-003-conditions.test.ts`: maxPrice 2999/3001; minDiscountPct 15 vs 14.9; sizes no-match; sizes match lists only matching sizes; nameIncludes/nameExcludes; case-insensitive include; out of stock (all sizes unavailable, and `out-of-stock` class without sizes) | T-005 | done |
| REQ-004 | `req-004-alert-diff.test.ts`: new offer alerts once (T-003); cheaper; price rise and sizes shrink silent; new size; disappear and reappear; stops matching then forgotten; two offers one message; message content (all T-006) | T-003, T-006 | done |
| REQ-005 | `req-005-broken-detection.test.ts`: missing structure alerts once + snapshot; repeat silent; recovered; alert state kept; zero products not broken; timeout with other watches running; HTTP 500; unexpected currency | T-007 | done |
| REQ-006 | `req-006-history.test.ts`: 3 rows with columns; 180-day prune; broken check row | T-008 | done |
| REQ-007 | `req-007-notification.test.ts`: stdin recorded; failing notify retried next run; unset var refuses to start (all T-003); unset var allowed with `--dry-run` (T-009) | T-003, T-009 | done |
| REQ-008 | `req-008-untrusted-pages.test.ts`: hostile name stripped and capped at 120; foreign/`javascript:` link replaced by watch URL per offer; 3500-char message cap | T-010 | done |
| REQ-009 | `req-009-selectors-extractor.test.ts`: offers extracted as configured (alternate markup); `parsePrice` formats | T-003 | done |
| REQ-013 | `req-013-dry-run-single-watch.test.ts`: dry run prints, no notify/state/history writes (fresh and existing state); `--watch <id>` fetches only that watch | T-009 | done |
| REQ-010 | `rose.test.ts` (fixtures `tests/fixtures/rose/`, served by the fake shop): offers/prices/list prices/sizes across 2 listing pages; yellow is not available (note only); real `rose-gravel` (AL excluded) and `rose-road` (no Shave: silent); empty result not broken; missing structure broken | T-011 | done |
| REQ-011 | `canyon.test.ts` (fixtures `tests/fixtures/canyon/`, served by the fake shop; its own tiny server for redirects): endurance offers/prices/list prices/sizes via the colour pages of the one candidate; e-bike (`:ON`) never alerts; sold-out L/XL silent; real `canyon-grail` (category page, name filter, carousel tiles ignored); no discount: silent; empty result not broken; missing marker, counter != tiles, redirect to the parent category, product page redirect / without size list: broken; cookie banner (shadow root) answered with the necessary-only button | T-012 | done |
| REQ-012 | `aliexpress.test.ts` (fixtures `tests/fixtures/aliexpress/`, served by the fake shop; own tiny servers for redirects; the block pages are SYNTHETIC, marked in the test): real watch file (maxPrice 329.99, item URL); SK fixture 371.95 EUR in stock: row with item id, no alert; <= 329.99 in stock: one alert, silent on the second run; 330.00 and out of stock: silent; block page (slider element/title), challenge element on a page with product data, redirect to `/_____tmd_____/punish`: broken "blocked", no retry; no Product data: broken; redirect to another origin (DE): broken "redirected"; USD: broken; markup in the name sanitized. Unit tests `tests/unit/aliexpress-extractor.test.ts` (parsing, block markers incl. the real robot-check text, cookie plumbing) | T-013 | done |
| REQ-012 | not in the harness; added by T-013 with trimmed real fixtures | T-013 | n/a |

Unit tests: `tests/unit/` (builders add per task). Currently one smoke test.
