# Status: watchdog
Phase: build   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: – (M4 done: T-016, T-017 merged; milestone review)
Open PRs: Milestone M4 (chore/milestone-m4)
Blockers: –
Next step: mutation workflow on the M4 PR → before/after scores into the PR body; Martin merges M4; retro.

Done in M1: T-001 … T-010 (all; merged as PR #15)
Done in M2: T-011, T-012, T-013, T-014
Done in M4: T-016 (PR #27), T-017 (PR #28)
Done in M3: T-015 (milestone PR #23 merged 2026-10-23; mutation score 79.1%, no code bugs, test gaps → T-016)
T-011 also covers (from M1 follow-ups): extractor registry/dispatcher in run.ts, stable offer ids (strip query/tracking params in selectors extractor).

## Follow-ups from reviews / milestone review (for M2)
- M2 needs a site dispatcher: run.ts calls the selectors extractor directly (extractors/<site> registry with T-011).
- Offer ids from links keep query strings: a shop adding per-visit params would make every offer "new" daily. Site extractors use stable ids (Rose SKU, Canyon model id from URL); selectors extractor should strip query/tracking params or allow an id selector.
- No overall run time budget (G1 < 5 min): Rose product-page visits per candidate add up; measure in T-011 staging dry run.
- Mutation testing (framework: Stryker report on milestone PRs) not set up: no mutation.yml in the harness. Adding it touches .github/workflows (needs Martin's label).
- sanitize stripMarkup lowercases for index search (U+0130 length shift); harmless (final pass removes all < >), cosmetic.

## Answers from Martin (2026-10-22, "yes to everything" = Lead's proposals) – for M2 tasks
- Rose availability: only green (in stock) counts as available; yellow (orderable, delivery in weeks) only as a note.
- Canyon filter: Grail watch loads the Grail category and filters "CF SL" by name client-side, not via the URL filter.
- Canyon cookie banner: click necessary-only when the banner offers it, otherwise "Allow all".
- AliExpress: default variant only, SK region (EUR) price compared with 329.99.
- Size flapping: keep as built (re-alert as "new size" each time).
- Mutation testing (Stryker, report only) added as an M2 task; touches .github/workflows, so that PR needs Martin's `acceptance-change` label.

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
- 2026-10-22: Martin answered the 5 M1 questions with the Lead's proposals (see "Answers"); approved mutation testing as an M2 task.
- 2026-10-22: Martin merged M1 (PR #15), "go M2". Dispatcher + stable ids folded into T-011 (no PLAN change).
- 2026-10-22: T-011 PR #16 ready, not merged by Lead: builder listed "questionable" items (merge condition e). Follow-ups: shadow-root consent dialog acceptance test; fixed 2 s settle per size; id params by name only; listing completeness only structural.
- 2026-10-22: T-011 merged (PR #16, 0 fix rounds). Martin: "merge it and avoid these later" = builder-listed known limitations no longer block the Lead's merge when CI + reviewer + test-reviewer are green; limitations go to follow-ups.
- 2026-10-22: T-012 merged (PR #17, 0 fix rounds). Grail watch uses nameIncludes "Grail CF" (site "CF SL" filter lists "Grail CF 7"; names never contain "CF SL"); reviewers agreed with PRD intent. Follow-ups: model rename silently matches nothing; no test for CFR/SLX exclusion, maxPrice boundaries, XS-only; redirect check accepts any of a watch's URLs (single-URL watches today).
- 2026-10-22: T-013 merged (PR #18, 0 fix rounds). AliExpress was BLOCKED (reCAPTCHA) from the VPS on 2026-10-22; extractor reports "blocked" as broken (~10 s). aliexpress-ent may be broken on many days (accepted best effort). Follow-ups: no real block-page fixture; successful live SK price read not seen since T-002; block-text regexes could over-flag (fails safe); redirect to non-item page waits 12 s. CI on PR #18 took 13 min (vs ~2.3 min), worth watching.
- 2026-10-22: T-014 merged (PR #19, 0 fix rounds). M2 tasks all merged; waiting for Opus milestone review + milestone PR. Follow-ups: cron-run.sh lock fd inherited by children, exit 75 on overlap shows as cron failure, trap RETURN cosmetic. Mutation testing still not in PLAN.
- 2026-10-22: Opus M2 review done: meets REQ-010/011/012 (best effort) and T-014; live dry run of all 5 watches 73 s, exit 0, Rose/Canyon healthy, AliExpress broken "blocked". Milestone PR opened.
- 2026-10-22: Martin merged M2 (PR #20). Decided: deploy, but mutation testing first (plan v3: M3 = T-015).
- 2026-10-22: Martin: the Lead session stays on Opus; do not ask him to switch models in this session (switching mid-session is not effective). Lighter work goes to subagents with an explicitly lower model (builder/reviewer/test-reviewer: sonnet). This overrides the framework's "Opus only for planning/milestone reviews" for this project.
- 2026-10-22: Plan v3 merged (PR #21); Martin: "go M3".
- 2026-10-22: Martin: "label 22" → Lead added acceptance-change; T-015 merged (PR #22, 0 fix rounds).
- 2026-10-23: Martin merged M3 (PR #23), "deploy v1.0.0". Tag v1.0.0 on 2ff61a5 pushed. Staging (real sites): dry run exit 0, 63 s; local-notify run: rose 21+21, canyon-endurance 11, canyon-grail 6 offers, 0 matches, aliexpress broken "blocked". Telegram test message sent.
- 2026-10-23: Martin confirmed the Telegram test message and the cron line at 08:15 (not 08:00: HAL weekly.sh runs Mondays 08:00). Cron installed (only this line added). v1.0.0 deployed to ~/apps/watchdog.
- 2026-10-23: First scheduled run 08:15 OK: exit 0, 71 s, watches/ updated from origin/main (2ff61a5); history.csv 60 rows (rose 21+21, canyon-endurance 11, canyon-grail 6, aliexpress-ent 1 broken); 0 matches; only aliexpress-ent broken "blocked" (snapshot saved). Deploy record PR #24 merged by Martin.
- 2026-10-23: Martin confirmed "yes" to plan v4 (M4: T-016 unit tests for mutation survivors; T-017 Canyon filter tests from M2 follow-ups). Tests only, no release.
- 2026-10-23: T-016 merged (PR #27, 0 fix rounds): unit tests for M3 survivors; reviewer killed 10/11 hand mutations, the 11th (message.ts "first alert always shown" guard) is equivalent (single alert ≤ ~1.4k chars). Follow-ups: bound the "fit exactly" loop in message.test.ts (hangs instead of failing under one mutation); rename/comment the equivalent-branch test.
- 2026-10-23: T-017 merged (PR #28, 1 fix round: ":ON" exclude was not isolated → added "Grail CF:ON 8"). Canyon watch tests use real loader, rules and fixture parser. Main CI took 7m54s (vs ~2.5 min): watch.
