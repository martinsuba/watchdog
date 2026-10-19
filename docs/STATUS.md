# Status: watchdog
Phase: harness review   <!-- planning | plan review | harness | harness review | build | deploy | paused -->
Current task: –
Open PRs: #3 Harness (label acceptance-change added; waiting for GitHub Actions, degraded on 2026-10-19)
Blockers: GitHub Actions incident (githubstatus.com: "Degraded availability for GitHub Actions", since ~15:40 UTC 2026-10-19). Runs on PR #3 stay queued; cancel/force-cancel refused by GitHub (409). Not our config: same workflows ran and passed earlier today (ci success on 1d102e0 and 21c07b4).
Next step: when Actions recovers, check `gh pr checks 3`; if runs are still stuck, `gh run rerun <id>` on the latest head SHA. Martin merges #3 when ci + acceptance-guard are green → Lead sets branch protection → M1 task list → "go M1".

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
