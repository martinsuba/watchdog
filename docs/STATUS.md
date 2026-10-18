# Status: watchdog
Phase: plan review   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: –
Open PRs: #1 Plan v1 (plan/1)
Blockers: –
Next step: Martin reviews and merges the Plan v1 PR; then `harness` skill (on Sonnet)

## Decisions log
- 2026-10-16: project created
- 2026-10-15/16 (via HAL, ~/HAL/ai-assistant/notes/watchdog/decisions.md): daily price watcher, Telegram, Playwright for
  all sites, own solution (no changedetection.io), public repo, history local + gitignored, 180-day retention.
- 2026-10-18: discount threshold 15%; re-alert when a matching offer gets cheaper or gains a matching size; reuse HAL's
  Telegram bot via tg_send.sh; AliExpress best effort, nothing paid; no history viewer (just save data); stack left to
  the Lead → Node 24 + TS (native type stripping) + Playwright.
- 2026-10-18: production code pinned by release tag, watch files follow origin/main (ARCHITECTURE D-005).
