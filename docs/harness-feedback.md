# Harness feedback

One line whenever the harness annoys you or lets something through. Date it. `npx harness retro`
reads this and proposes at most three changes with evidence; a human approves; fixes land as
machinery, never prose.

- 2026-09-06 · born. Guards: placement (lint), safety (PreToolUse), banner (SessionStart). First consumer: domybest.
- 2026-09-07 · 0.2.0 · the register is live: collector + file exporter + reader, proven with one real OTLP request end to end. Found and fixed: the file exporter refuses `append` alongside `rotation` — the rotator appends on its own. The probe event was deleted from the real register afterwards; a fake row in a real register would be the one thing this whole system exists to refuse.
