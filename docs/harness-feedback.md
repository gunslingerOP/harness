# Harness feedback

One line whenever the harness annoys you or lets something through. Date it. `npx harness retro`
reads this and proposes at most three changes with evidence; a human approves; fixes land as
machinery, never prose.

- 2026-09-06 · born. Guards: placement (lint), safety (PreToolUse), banner (SessionStart). First consumer: domybest.
- 2026-09-07 · 0.2.0 · the register is live: collector + file exporter + reader, proven with one real OTLP request end to end. Found and fixed: the file exporter refuses `append` alongside `rotation` — the rotator appends on its own. The probe event was deleted from the real register afterwards; a fake row in a real register would be the one thing this whole system exists to refuse.
- 2026-09-07 · INCIDENT · 0.2.0's global git hooks resolved the repo's local hook with `git rev-parse --git-path hooks`, which honours core.hooksPath and therefore returned the chain script ITSELF — it exec'd itself forever and every `git commit` on the machine hung until the processes were killed. Found because the harness's own suite commits in temp repos. Fixed in 0.2.1 with `--git-common-dir` plus an `-ef "$0"` self-exec guard, and a regression test that commits under a hooksPath with a 10 s bound. Lesson for the budget: a machine-level install needs a machine-level test before it ships, not after.
