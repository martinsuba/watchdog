# Martin inputs log
One line per input Martin had to give. Used for retrospectives (what can be automated?).

date | gate/phase | what Martin did | could an agent do it? (y/n + why)
--- | --- | --- | ---
2026-10-18 | plan | Pointed Lead to HAL's watchdog notes instead of repeating the brief | y – Lead should search ~/HAL/ai-assistant/notes/<project>/ before asking
2026-10-18 | plan | Answered 6 scoping questions (discount 15%, re-alerts, Telegram reuse, AliExpress best effort, no history viewer, stack to Lead) | n – product decisions
2026-10-19 | plan review | Answered 4 plan assumptions in chat (Endurance:ON out, Backroad AL out, D-005 ok, recovered msg ok) | n – product decisions
2026-10-19 | plan gate | Merged Plan v1 PR #1 | n – gate by design
2026-10-19 | harness | Said no model switching in the Lead session; subagents get the model set explicitly | y – framework could say this by default
2026-10-19 | harness | Repo setup: Actions enabled, label acceptance-change created, auto-merge enabled | y – done by agent
2026-10-19 | plan gate | Merged Plan v2 PR #2 | n – gate by design
2026-10-19 | harness | Said "it is taking too long" about CI (GitHub Actions incident) | y – Lead should check githubstatus and report proactively when a check is pending > 10 min
2026-10-19 | harness | Approved `acceptance-change` label on harness PR #3 ("label it") | n – gate by design
2026-10-19 | harness | Asked Lead to re-verify the CI delay was GitHub-side, cancel the check and save status | y – Lead should verify cause (status page + earlier green runs) before waiting
2026-10-19 | harness gate | Merged harness PR #3 | n – gate by design
2026-10-19 | harness | Branch protection on main set via gh api | y – done by agent
2026-10-20 | build | "go M1" | n – gate by design
2026-10-20 | build | – (seeded-bug check PR #6: test-reviewer correctly rejected the weakened assertion; closed by Lead) | y – done by agent
2026-10-20 | build | – (M1: 10 task PRs merged by Lead, 2 fix rounds total, 0 escalations) | y – done by agent
2026-10-22 | M1 review | Answered 5 open questions ("yes to everything") | n – product decisions
2026-10-22 | build | Merged M1 PR #15, "go M2" | n – gate by design
2026-10-22 | build | "merge it and avoid these later" (T-011 builder limitations) | y – Lead should not have stopped; rule relaxed
2026-10-22 | M2 end | Switched Lead to Opus for milestone review (/model opus) | n – Lead cannot switch its own model
2026-10-22 | M2 gate | Merged milestone PR #20 | n – gate by design
2026-10-22 | deploy/plan | "deploy, mutation before" → plan v3 (M3: T-015 mutation report), deploy after M3 | n – Martin's priority call
2026-10-22 | framework | Correction: don't ask to switch models mid-session, it is not effective; Lead stays on Opus, lighter tasks to subagents on a lower model | y – Lead should have followed the 2026-10-19 decision (one model in the Lead session) instead of suggesting /model switches
2026-10-22 | plan gate | Merged plan v3 PR #21, "go M3" | n – gate by design
2026-10-22 | build | Asked what the mutation workflow is; then "label 22" (acceptance-change on T-015) | n – label is Martin's gate by design; explanation could have been in the plan PR
2026-10-23 | M3 gate | Merged milestone PR #23 | n – gate by design
2026-10-23 | deploy gate | "deploy v1.0.0" | n – production deploy approval by design
2026-10-23 | deploy | Confirmed Telegram test message arrived + cron line at 08:15 | n – only Martin can see his Telegram; cron change is his call
