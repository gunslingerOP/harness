<!-- harness:begin — placed by `harness init`; regenerated on upgrade, do not edit inside the markers -->
## Working in this repo — the harness

This project runs `@gunslinger/harness`. The rules below are **enforced by machinery**, not by
your memory; this section exists so you know what will happen, not to ask you to remember.

- **Policy is `.claude/harness.config.json`.** The repo root is closed and directories in
  `layout.organized_dirs` may not go flat. A new top-level dir or root file needs a config edit in
  the same commit — that edit is the decision. Pre-commit refuses otherwise.
- **Destructive git and protected deploys are denied** on every Bash call (force push, hard reset,
  branch deletion, protected stages). If you need one, say so; do not work around the guard.
- **Style is lint-enforced** where `style` is configured: raw colours and literal font sizes are
  errors outside the tokens file; pure modules cannot import what they are forbidden.
- **Every session is recorded.** Tool calls, failures, guard denials, cost and tokens go to a local
  register via OpenTelemetry. `npx harness register` summarises it. Nothing you do is invisible,
  and that is the point: "verified" must be checkable against something you did not write.
- **Work you verified yourself is not reviewed.** Before calling something done, run the six
  attacks: `npx harness review`. READY or NOT READY, with evidence.
- **When the harness gets in your way, record it:** `npx harness feedback "…"` (one line). When
  something breaks that a guard should have caught: `npx harness incident "…"`. Do not add a guard
  yourself; the retro proposes, a human approves.

Commands: `npx harness doctor` · `test` · `lint` · `register` · `review` · `retro`.
<!-- harness:end -->
