# harness

A personal coding-agent harness. **Mechanism only** — every project supplies its policy through
one file, `.claude/harness.config.json`, and editing that file is the decision.

Two principles. **A rule an agent has to remember is a rule that gets skipped** — every guard here
is a hook, a lint or a gate. And **every claim must be checkable against something the claimant
did not write** — so every session is recorded, and a reviewer that does not trust the builder
ships with it.

| Guard | Runs at | Fails |
|---|---|---|
| **placement** (`harness lint`) — closed root, no flat dumps, ASCII names, no tool artifacts, docs-with-code | pre-commit | **OFF**, loudly, if the config is missing |
| **safety** — force-push, `reset --hard`, branch deletion, protected deploys, `rm -rf /` | PreToolUse on Bash | **CLOSED** — the floor holds with no config |
| **push-guard** — deleting or force-pushing a protected branch | git pre-push, **globally, in every repo on the machine** | **CLOSED** — floor is `main`/`master` |
| **banner** — identity, git truth, the project's own status command | SessionStart | OFF |

**The register.** One OpenTelemetry Collector on the machine, one rotated JSONL file. Claude Code
and Codex CLI both speak OTLP natively, so every session's tool calls, failures, guard denials,
cost and tokens land in `~/.harness/register/` with zero custom code. `harness register` reads
it; `harness retro` folds it into proposals — including **retirements** for guards that fired at
nothing. Details: [docs/register.md](docs/register.md).

**Incidents and feedback are GitHub Issues on this repo**, filed from any project with
`harness incident "…"` / `harness feedback "…"` — the union across every consumer, queryable,
free. `harness init` registers each project as a consumer the same way.

```bash
npm i -g github:gunslingerOP/harness#v0.2.0 && harness install --global   # once per machine
npm i -D github:gunslingerOP/harness#v0.2.0 && npx harness init             # once per project
npx harness doctor                                                          # whenever in doubt
```

Full steps: [docs/porting.md](docs/porting.md). Zero dependencies. Node ≥ 22.

## Maintaining it

- **A bloat budget, enforced.** `test/budget.json` caps guards, lines per guard, CLI size, config
  keys, and dependencies at zero. Growing past a ceiling means editing the budget in the same PR.
- **Every guard names the failure it was born from** and **declares the config keys it reads** —
  both enforced by tests. A guard nobody can judge, or whose inputs nobody can see, is one nobody
  can retire.
- **Every guard has a fire test, a silent test and a fail-direction test.** `npm test`.
- **It runs on itself.** This repo has its own `.claude/harness.config.json`.
- **CI inits it into a fixture project** and runs the suite there before a tag can exist.
- **The loop is a session, not a cron.** `harness retro` assembles register + issues + inbox +
  commits into a prompt; a session proposes at most three changes; a human approves; fixes land as
  machinery. Running that on a schedule in CI would cost API tokens — a local session is free.

Guards invented in advance mostly generate noise. Use it for a week before adding anything.
