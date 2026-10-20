# Status: watchdog
Phase: build   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: T-002 (in progress)
Open PRs: –
Blockers: –
Next step: M1 task loop (T-001 … T-010), then milestone PR for Martin

Done in M1 (PLAN.md ticks go into the milestone PR; task PRs must not touch PLAN.md): T-001

## Open questions for Martin (needed before M2, ask at M1 end)
- Rose availability: count yellow traffic light (orderable, delivery in weeks) as available, or only green (in stock)? Spike recommends green only, yellow as a note.
- Canyon: a non-matching filter silently redirects (HTTP 200) to the parent category. Proposal: Grail watch loads the Grail category and filters "CF SL" by name client-side, instead of relying on the URL filter.
- Canyon cookie banner: extractor clicks "Allow all" (spike did). Alternative: reject/necessary-only if the banner offers it. Lead proposes necessary-only when available.

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
