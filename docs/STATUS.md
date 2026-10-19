# Status: watchdog
Phase: harness   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: –
Open PRs: plan/2 (v2 clarifications)
Blockers: –
Next step: harness skill → test-architect subagent (Sonnet) builds skeleton, CI, acceptance tests; harness PR needs Martin's `acceptance-change` label

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
