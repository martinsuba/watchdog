# Retrospective: watchdog
Written 2026-10-23 by the Project Lead after v1.0.0 was deployed and M4 merged. Sources: docs/LOG.md, the STATUS.md
decisions log, `gh pr list --state all` (#1–#29), PR review comments, `gh run list --status failure`, git log (41 commits).

## Timeline and numbers
| phase | dates | PRs | notes |
|---|---|---|---|
| plan | 10-18 → 10-19 | #1, #2 | brief from HAL notes; 10 scoping/assumption answers from Martin |
| harness | 10-19 | #3 | 46 acceptance tests todo-marked; CI delayed by a GitHub Actions incident |
| M1 engine + spikes | 10-20 (≈ 2.5 h of task loop) | #4–#14, #15 | 10 tasks, seeded-bug PR #6 rejected as it should be |
| M2 real sites | 10-22 | #16–#19, #20 | 4 tasks; the Lead wrongly stopped at T-011 |
| M3 mutation report | 10-22 | #21, #22, #23 | plan v3 added it before deploy (Martin's call) |
| deploy v1.0.0 | 10-23 | #24, #25 | staging dry run 63 s; first scheduled run 08:15 OK (71 s, exit 0) |
| M4 mutation gaps | 10-23 (≈ 1.5 h) | #26–#28, #29 | 2 test-only tasks; no release needed |

- 17 tasks (T-001…T-017) in 4 milestones; 29 PRs: 4 plan, 1 harness, 17 task, 4 milestone, 2 deploy records, 1 seeded-bug
  (closed). Elapsed: 10-18 → 10-23; most waiting was on Martin's gates (M1 PR open 2 days, M3 PR open overnight).
- Fix rounds: T-004 1, T-010 1 (quadratic regex in the sanitizer), T-017 1 (":ON" exclusion not isolated); all others 0.
  Never more than 1; no escalation for rounds.
- Models: Lead on Opus (on Sonnet for parts of M1/M2 before Martin's 10-22 decision); builder, reviewer, test-reviewer on
  Sonnet. Subagent tokens are visible only for M4: builders 32–43 k, reviewers 15–31 k per run.
- CI failures: only `acceptance-guard` before the test-review status existed (harness ×2, T-004, T-010, seeded bug).
  No red `ci` on main ever. CI duration outliers: PR #18 13 min, main after #28 7 m 54 s (normal ≈ 2.5 min).

## Martin's inputs (from docs/LOG.md): by gate, could an agent have done it?
30 log lines. **19 "n" by design** (merges, go-M<n>, deploy approval, label, product decisions, Telegram confirmation).
**9 "y"**, i.e. avoidable:

| input | why Martin was needed | fix |
|---|---|---|
| Pointed the Lead to HAL notes (10-18) | Lead asked for a brief that already existed | plan skill: search ~/HAL/ai-assistant/notes/<project>/ first (now in memory) |
| "No model switching" (10-19) | framework tells the Lead to suggest `/model` | framework change (P2) |
| "It is taking too long" (10-19) | Lead waited on a GitHub incident without saying | next-task: check githubstatus when a check is pending > 10 min (P5) |
| Re-verify CI delay, cancel, save status (10-19) | same | same |
| "Merge it and avoid these later" (10-22) | **Lead mistake**: stopped on builder-listed known limitations although all checks were green | next-task condition e (P1) |
| **Correction**: don't ask to switch models (10-22) | **Lead mistake**: suggested `/model opus` at M2 end despite the 10-19 decision | P2 |
| Asked what the mutation workflow is (10-22) | plan v3 PR did not explain the tool in plain words | plan skill (P4) |
| Repo setup and branch protection (10-19) | done by the agent; logged for completeness | – |

Also needed from Martin but by design: two deploy-record merges (#24, #25) for docs-only changes (P7).

## What the gates caught / what slipped through
- **Reviewer:** quadratic regex (ReDoS risk) in the sanitizer (T-010); invalid watch files alerting every run (T-004);
  in M4, an untested ":ON" exclusion that it marked "non-blocking" although the task text required it. The Lead turned
  that into a fix round; the reviewer alone would have let it through (P6).
- **Test-reviewer / seeded-bug check:** rejected a weakened REQ-003 assertion (PR #6). It worked as intended.
- **Opus milestone reviews:** live dry runs before deploy (M2: 73 s; AliExpress blocked from the VPS, so broken
  "blocked" was accepted best effort). Also caught that mutation testing was missing from the harness (raised at M1 and
  M2, only planned at M3).
- **Mutation report (M3):** 79.1 %. No code bugs, but real test gaps, e.g. `nameExcludes some→every`: a Grail CFR would
  have alerted without any test failing. M4 closed them (83.7 %).
- **Slipped through:** the missing `mutation.yml` from the harness until M3. The Grail "CF SL" name assumption was found
  only when building T-012 (names never contain "CF SL"), not in the T-001 spike. No production incident so far.

## Process failures (agents' side)
- **Lead stopped without cause** at T-011 (above) and **suggested model switches** after being told not to.
- **Harness omitted the mutation workflow** from the framework template; fixing it later cost a plan PR, a task PR and a
  label gate (#21, #22).
- **Reviewer under-weighted a task-text gap** as non-blocking (T-017).
- **Builder pushed before its full `npm test` run finished** (T-017; it was green, but by luck).
- **One new test can hang instead of failing** under a mutation (T-016 "fit exactly" loop): a weak spot in test design.
- **STATUS.md on main lags** after deploys, because the record goes through a PR that Martin merges.
- No shared-checkout or scope-creep problems. Specs were clear enough that 14 of 17 tasks needed no fix round.

## Test quality (unit, acceptance, screenshots, mutation, spike/staging)
| after | unit | acceptance | mutation score |
|---|---|---|---|
| harness | – | 46 (todo) | – |
| M1 | 157 | 46 | not set up |
| M2 | 240 | 73 | not set up |
| M3 | 240 | 73 | 79.1 % (812 mutants) |
| M4 | 290 | 73 | **83.7 %** (rules 97.8, message 87.2, state 84.0, watches 70.2, diff 100, sanitize 82.9, price 81.1, history 80.4) |

- **Remaining survivors** mostly change message or log wording: the equivalent "first alert" branch in message.ts, the
  error-line truncation in watches.ts:57, and the corrupt-state backup pruning in state.ts:81/85. None of them can cause
  a wrong or missing alert.
- **Screenshots:** none; the project is CLI and Telegram only.
- **Spikes:** T-001 found that Rose and Canyon can be read and need product pages for sizes. T-002 found AliExpress
  readable on 10-20, but it was blocked by 10-22. A spike result for a site with anti-bot protection is a snapshot, not
  a guarantee.
- **Staging and production:**
  - The staging dry run took 63 s and the first production run 71 s, against the 5-minute budget (G1).
  - Offer counts were identical in both: 21+21 / 11 / 6.

## Cost and model fit
- **Sonnet was enough** for every builder and reviewer run. No task needed a stronger model; the hardest ones were the
  T-011…T-013 extractors and the T-015 Stryker setup.
- **Opus paid off** in the plan, the milestone reviews (live checks, the mutation follow-ups) and the M4 call to send
  T-017 back for a fix round.
- **Could be cheaper:**
  - The deploy-record PRs (#24, #25) and STATUS edits are mechanical; a Haiku-level agent could do them.
  - Re-reviews after a one-line fix could be a quick scoped check.

## Proposals for the framework (ranked, with file to change; mark permission needs)
Ranked by Martin-minutes saved against risk. The Lead does not edit ~/.claude or ~/HAL: take these to the ops session.

1. **Known limitations don't block a merge** when CI, the reviewer and the test-reviewer are green. They go to the
   follow-ups in STATUS instead. Change merge condition e in `~/.claude/skills/next-task/SKILL.md` to "builder reported
   nothing unfinished; known limitations → follow-ups". Saves an unnecessary stop per milestone. Low risk. No permission
   change.
2. **The Lead stays on one model.** Remove "suggest `/model opus|sonnet`" from these files:
   - `~/.claude/FRAMEWORK.md`
   - `~/.claude/skills/plan/SKILL.md` (preamble and step 7)
   - `~/.claude/skills/next-task/SKILL.md` (end of milestone)

   Say instead "Lead on Opus; pass `model` explicitly on every subagent". Saves a correction and repeated prompts. No
   risk.
3. **The harness must include the mutation workflow.** In `~/.claude/skills/harness/SKILL.md` and
   `~/.claude/agents/test-architect.md`, add `mutation.yml` (from templates/, with `workflow_dispatch`), `test:mutation`
   and Stryker as a pinned devDependency to the harness definition of done. Saves a plan PR, a task and a label gate
   per project. Low risk, because it is report only.
4. **Plain-language explanations in plan PRs.** In `~/.claude/skills/plan/SKILL.md` step 6, the PR body explains every
   new tool, workflow or gate in 2–3 plain sentences: what it does and what Martin will see. Saves a question per new
   tool. No risk.
5. **Check GitHub status when CI is slow.** In `~/.claude/skills/next-task/SKILL.md` steps 5 and 6: when a check has
   been pending for more than 10 min, look at githubstatus.com and earlier run durations, then tell Martin the cause
   proactively. Saves the 10-19 back-and-forth. Low risk.
6. **The reviewer checks the task text item by item.** In `~/.claude/agents/reviewer.md`, any task item the tests don't
   actually exercise is CHANGES NEEDED, never "non-blocking". The reviewer confirms with a hand mutation, as in M4.
   Prevents gaps like the one in T-017. Low risk.
7. **One record PR per deploy.** In `~/.claude/skills/deploy/SKILL.md`, wait for the first scheduled run (with a wakeup
   timed after the cron) and open a single PR with the deploy and the first-run result. Saves one merge per deploy.
   Optionally, let the Lead auto-merge docs-only `chore/*` PRs that touch only STATUS, LOG and DEPLOY history; that
   needs **Martin's permission and a change to the merge exception in `~/.claude/CLAUDE.md`**, at medium risk because it
   widens the merge exception.
8. **The builder never pushes before the full local test run has finished.** Add this to `~/.claude/agents/builder.md`.
   No risk.
9. **The plan skill reads the HAL notes first.** In `~/.claude/skills/plan/SKILL.md` step 1, read
   `~/HAL/ai-assistant/notes/<project>/` before asking anything. This is already a project memory; making it a framework
   rule helps future projects. No risk.
10. **Tests must fail, not hang.** In `~/.claude/framework/templates/TESTS.md` (or the builder agent): loops in tests
    must be bounded, and node:test needs a per-test timeout. Low risk.
