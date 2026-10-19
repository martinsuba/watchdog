# Status: watchdog
Phase: harness review   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: –
Open PRs: #3 Harness (label acceptance-change added; waiting for GitHub Actions, degraded on 2026-10-19)
Blockers: –
Next step: Martin merges #3 when CI is green → Lead sets branch protection → M1 task list → Martin says "go M1"

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
