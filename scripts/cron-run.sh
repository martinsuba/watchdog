#!/usr/bin/env bash
# Daily production run (docs/DEPLOY.md, D-005): only watches/ follows origin/main, code stays at the deployed tag.
# Env: WATCHDOG_NOTIFY_CMD (read by the CLI, never printed here). Exit code = exit code of the run
# (75 if another run is still active). Logs: data/logs/run-<date>.log, 30 days kept.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p data/logs
LOG="data/logs/run-$(date +%F).log"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

# One run at a time (the lock is released when this process exits).
exec 9>data/cron.lock
if ! flock -n 9; then
  log "skipped: another run is already running"
  exit 75
fi

find data/logs -name 'run-*.log' -mtime +30 -delete

log "start"

# Update watches/ only. Any failure (offline, no such branch) keeps the local copy untouched.
update_watches() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  timeout 60 git fetch --quiet origin main >>"$LOG" 2>&1 || { log "git fetch failed, keeping local watches/"; return 0; }
  git archive origin/main watches 2>>"$LOG" | tar -x -C "$tmp" 2>>"$LOG" || { log "git archive failed, keeping local watches/"; return 0; }
  [ -d "$tmp/watches" ] || { log "origin/main has no watches/, keeping local watches/"; return 0; }
  rm -rf watches.old
  mv watches watches.old 2>/dev/null || true
  if mv "$tmp/watches" watches; then
    rm -rf watches.old
    log "watches/ updated from origin/main ($(git rev-parse --short origin/main))"
  else
    mv watches.old watches
    log "could not replace watches/, kept local copy"
  fi
}
update_watches

set +e
node src/cli.ts run >>"$LOG" 2>&1
code=$?
set -e
log "exit code $code"
exit "$code"
