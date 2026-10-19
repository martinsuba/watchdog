# watchdog
Follows Martin's framework: ~/.claude/FRAMEWORK.md (skills: plan, harness, next-task, deploy).
State: docs/STATUS.md (read it first). Plan: docs/PRD.md, docs/ARCHITECTURE.md, docs/PLAN.md. Tests: docs/TESTS.md.

## Stack
Node 24 + TypeScript (native type stripping, no build step; erasable syntax only), Playwright (Chromium), yaml + zod,
node:test. No DB: gitignored `data/` (state.json, history.csv, broken/ snapshots, logs). Runs daily via cron on agent-vps.
Watch definitions: `watches/*.yaml` (public). Repair/new watch guide: docs/REPAIR.md (from T-014).

## Commands
- Install:
- Run:
- Lint / typecheck:
- Unit tests:
- Acceptance tests:

## Conventions
(filled in during planning/harness)
