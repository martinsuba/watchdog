# Status: watchdog
Phase: build   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: – (M1 complete)
Open PRs: milestone PR M1 (chore/milestone-M1)
Blockers: –
Next step: Martin reviews + merges the M1 milestone PR and answers the open questions below; then plan v3 PR if answers change PRD/PLAN; then "go M2"

Done in M1: T-001 … T-010 (all; PLAN.md ticked in the milestone PR)

## Follow-ups from reviews / milestone review (for M2)
- M2 needs a site dispatcher: run.ts calls the selectors extractor directly (extractors/<site> registry with T-011).
- Offer ids from links keep query strings: a shop adding per-visit params would make every offer "new" daily. Site extractors use stable ids (Rose SKU, Canyon model id from URL); selectors extractor should strip query/tracking params or allow an id selector.
- No overall run time budget (G1 < 5 min): Rose product-page visits per candidate add up; measure in T-011 staging dry run.
- Mutation testing (framework: Stryker report on milestone PRs) not set up: no mutation.yml in the harness. Adding it touches .github/workflows (needs Martin's label).
- sanitize stripMarkup lowercases for index search (U+0130 length shift); harmless (final pass removes all < >), cosmetic.

## Open questions for Martin (needed before M2, ask at M1 end)
- Rose availability: count yellow traffic light (orderable, delivery in weeks) as available, or only green (in stock)? Spike recommends green only, yellow as a note.
- Canyon: a non-matching filter silently redirects (HTTP 200) to the parent category. Proposal: Grail watch loads the Grail category and filters "CF SL" by name client-side, instead of relying on the URL filter.
- Canyon cookie banner: extractor clicks "Allow all" (spike did). Alternative: reject/necessary-only if the banner offers it. Lead proposes necessary-only when available.
- AliExpress: only the default variant is read (v1). Is the SK region (ship-to Slovakia, EUR) the right price to compare with 330 EUR? Today SK 371.95, DE 354.69.
- Size flapping: a size that disappears and comes back re-alerts as "new size" each time (REQ-004 as built in T-006). OK, or require it to stay away N days first?

## Decisions log
- 2026-10-16: project created
- 2026-10-15/16 (via HAL, ~/HAL/ai-assistant/notes/watchdog/decisions.md): daily price watcher, Telegram, Playwright for
  all sites, own solution (no changedetection.io), public repo, history local + gitignored, 180-day retention.
- 2026-10-18: discount threshold 15%; re-alert when a matching offer gets cheaper or gains a matching size; reuse HAL's
  Telegram bot via tg_send.sh; AliExpress best effort, nothing paid; no history viewer (just save data); stack left to
  the Lead → Node 24 + TS (native type stripping) + Playwright.
- 2026-10-18: production code pinned by release tag, watch files follow origin/main (ARCHITECTURE D-005).
- 2026-10-19: Plan v1 merged (PR #1). Endurance:ON excluded, Backroad AL excluded, D-005 and "recovered" message confirmed.
- 2026-10-19: Martin stays on one model in the Lead session; Sonnet-role work runs as subagents with model set explicitly.
- 2026-10-19: Plan v2 merged (PR #2). Harness PR #3: reviewer round 1 → tests tightened (REQ-003/008), 46 acceptance tests todo-marked.
- 2026-10-19: CI on PR #3 blocked by GitHub Actions incident; waiting (Martin: "we can wait"). Polling stopped; Martin checks back later.
- 2026-10-19: Harness merged (PR #3); branch protection on main set and verified (ci + acceptance-guard, no force-push/deletion).
- 2026-10-20: Martin: "go M1".
- 2026-10-20: T-001 merged (PR #4): Rose and Canyon readable from the VPS, no anti-bot; sizes need product pages on both sites.
- 2026-10-20: T-002 merged (PR #5): AliExpress NOT blocked from the VPS (3/3 loads), price via Product JSON-LD; SK/EUR cookie pins region. Recommendation: implement extractor in T-013.
- 2026-10-20: Seeded-bug check: PR #6 removed the REQ-003 'Bike Over' assertion; test-reviewer said CHANGES NEEDED (test-review=failure). Closed unmerged, branch kept. Check passed.
- 2026-10-20: T-003 merged (PR #7): `watchdog run` works end to end for selectors watches; 8 acceptance tests pass.
- 2026-10-20: T-004 merged (PR #8, 1 fix round): invalid watch files alert once per file content (hash in state.json `invalidFiles`), not every run.
- 2026-10-20: T-005 merged (PR #9): all REQ-003 conditions; currency mismatch never matches (flag for T-007).
- 2026-10-20: T-006 merged (PR #10): cheaper vs last alerted price, new size, forget on stop-matching, one message per watch with reasons.
- 2026-10-20: T-007 merged (PR #11): broken/recovered alerts, HTTP status check, snapshots (every failing run, newest 5 kept), corrupt state.json renamed + empty state (alerts may repeat once). Exit 0 for an alerted broken watch; non-zero only for invalid files, notify failures, crashes.
- 2026-10-20: T-008 merged (PR #12): history prune (180 d, atomic), broken rows, RFC 4180 + formula-injection guard; corrupt-state backups capped at 3.
- 2026-10-20: T-009 merged (PR #13): --dry-run has no side effects (byte-identical data dir), --watch <id> (unknown/invalid id exits 2; disabled watch runs when named).
- 2026-10-20: T-010 merged (PR #14, 1 fix round: quadratic regex in sanitizer replaced by linear scanner): text sanitizing, own-domain link rule, 3500-char cap; all 46 acceptance tests pass. M1 complete.
