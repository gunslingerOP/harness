# Porting the harness

## Once per machine — `harness install --global`

```bash
npm i -g github:gunslingerOP/harness#v0.2.0
harness install --global
```

Downloads the OpenTelemetry Collector to `~/.harness/bin`, writes and validates its config,
registers it with launchd so it survives crashes and logins, puts the telemetry env and the
banner/safety hooks in `~/.claude/settings.json` (every Claude Code session on this machine now
emits and is guarded), copies the adversarial reviewer and the concise output style into
`~/.claude`, and sets `git config --global core.hooksPath` to a directory whose hooks run the
push guard **and then chain to each repo's own hooks** — simple-git-hooks, husky and lint-staged
keep working, and repos you do not own get the safety floor with zero footprint in their tree.

## Once per project — `harness init`

```bash
npm i -D github:gunslingerOP/harness#v0.2.0
npx harness init --stack expo     # or next | node; omit to auto-detect
```

Writes `.claude/harness.config.json` from the stack template (kept if present), wires the hooks
and the telemetry env — with `OTEL_RESOURCE_ATTRIBUTES=project=<name>` so the register knows
whose session it was — places the harness section in `AGENTS.md` between markers (created if
absent; `CLAUDE.md` gets an `@AGENTS.md` import), creates the feedback inbox, and files a
`consumer:` issue upstream so the harness knows you exist.

Then, in order:

1. **Edit the config.** `layout.top_dirs` and `layout.root_files` are your closed root. Adding one
   later is a config edit in the same PR, and that edit is the decision.
2. **`npx harness test`** — passes, never failures. Every guard: fires, stays silent, fails the
   right direction.
3. **Wire `npx harness lint` into pre-commit** (after lint-staged, so formatting cannot hide a
   placement error). `init` cannot do this safely because pre-commit setups differ.
4. **Optional, design-system apps:** `...require('@gunslinger/harness/eslint')()` in
   `eslint.config.js` turns the `style` section into lint errors.
5. **`npx harness doctor`** — config, hooks, telemetry, collector liveness, register freshness,
   AGENTS.md section, and whether a newer harness is out.

## Client repos

`install --global` is all you need. The push guard, the safety hook, the banner and the reviewer
travel with you; the placement and style guards are your own repos' opinions and stay there.

## Upgrading

Bump the tag in `package.json` (and `npm i -g …` for the global tools). `harness doctor` tells you
when a newer release exists. The harness's own CI inits itself into a fixture project on every
push, so a release that breaks `init` cannot be tagged.
