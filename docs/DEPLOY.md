# Deploy: watchdog

## Target
Private on agent-vps: a dedicated clone `~/apps/watchdog` (separate from the dev repo `~/projects/watchdog`), run once a
day by the `agent` user's crontab (same mechanism as HAL's jobs). No server, no open ports.

## Environments (staging? production)
- **Staging** = the same clone run with `--dry-run --data-dir ~/apps/watchdog-staging-data`: real sites, no Telegram,
  no production state touched. Every deploy runs this first.
- **Production** = `~/apps/watchdog`, data in `~/apps/watchdog/data/` (gitignored), notify via HAL's `tg_send.sh`.

## How to deploy (exact steps / commands / workflow)
Only after Martin approves the deploy of a specific tag (`v<major>.<minor>.<patch>`, created on the milestone merge commit).
1. First time: `git clone https://github.com/martinsuba/watchdog ~/apps/watchdog`.
2. `cd ~/apps/watchdog && git fetch --tags && git checkout -- watches && git checkout v<x.y.z>`
3. `npm ci --omit=dev && npx playwright install chromium`
4. Staging: `node src/cli.ts run --dry-run --data-dir ~/apps/watchdog-staging-data` → check output (smoke checks below).
5. First time only: test message `echo "watchdog: test message" | ~/HAL/scripts/tg_send.sh` (Martin confirms it arrived).
6. First time only: install the cron line (Lead proposes, Martin confirms):
   `15 8 * * *  WATCHDOG_NOTIFY_CMD=$HOME/HAL/scripts/tg_send.sh $HOME/apps/watchdog/scripts/cron-run.sh`
   (08:15 daily; avoids HAL's 03:00–05:30 sync/restart window and HAL's Monday 08:00 `weekly.sh`).
7. Record the deploy in History below and in docs/STATUS.md.

`scripts/cron-run.sh` (T-014): `git fetch origin`, replace `watches/` with `origin/main`'s copy (D-005), then
`node src/cli.ts run >> data/logs/run-<date>.log 2>&1`; keeps 30 days of logs.

## Smoke checks after deploy
- Dry run exits 0 or lists only expected broken watches (e.g. AliExpress "blocked"); each other watch shows a plausible
  offer count and prices.
- No unexpected messages would be sent (dry-run output reviewed).
- After the first scheduled run: `data/history.csv` has rows for today, `data/logs/` has a log, exit code logged as 0
  (or only known-broken watches).

## Rollback
`cd ~/apps/watchdog && git checkout -- watches && git checkout v<previous> && npm ci --omit=dev`. Data files are
backwards compatible (state.json is rebuilt on change if its version field is unknown: alerts may repeat once).
To stop entirely: comment out the cron line.

## Secrets needed (names only; values set by Martin in GitHub/target)
- None in GitHub or in the repo. Telegram token stays in HAL's existing setup, used only via `~/HAL/scripts/tg_send.sh`.
- Env var `WATCHDOG_NOTIFY_CMD` (not secret), set in the cron line.

## History (date · commit · target · result)
- 2026-10-23 · v1.0.0 (2ff61a5) · agent-vps `~/apps/watchdog`, cron 08:15 daily · OK: staging dry run exit 0 (63 s); local-notify staging run read rose 21+21, canyon-endurance 11, canyon-grail 6 offers, 0 matches, aliexpress-ent broken "blocked" (expected); Telegram test message confirmed by Martin; node/git/flock/timeout on cron's default PATH; first scheduled run 2026-10-23 08:15 (pending check).
