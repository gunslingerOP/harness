# harness

A personal coding-agent harness. **Mechanism only** — every project supplies its policy through
one file, `.claude/harness.config.json`, and editing that file is the decision.

Built on one principle: **a rule an agent has to remember is a rule that gets skipped.** Every
guard here is a hook, a lint or a gate. Nothing here is prose an agent could ignore.

| Guard | Runs at | Fails |
|---|---|---|
| **placement** (`harness lint`) — closed root, no flat dumps, ASCII names, no tool artifacts, docs-with-code | pre-commit | **OFF**, loudly, if the config is missing |
| **safety** — force-push, `reset --hard`, branch deletion, protected deploys, `rm -rf /` | PreToolUse on Bash | **CLOSED** — the floor holds with no config at all |
| **banner** — git truth + the project's own status command | SessionStart | OFF |

Plus the **adversarial reviewer** (six attacks, READY / NOT READY), a reusable ESLint fragment for
design-system apps, and a **retro** loop that turns a plain-text feedback inbox into proposals.

```bash
npm i -D github:gunslingerOP/harness#v0.1.0
npx harness init          # config from a template, hooks wired, inbox created
npx harness test          # every guard: fires · stays silent · fails the right way
npx harness doctor        # is this install healthy
```

Full steps: [docs/porting.md](docs/porting.md). Zero dependencies. Node ≥ 22.

## Maintaining it

- **Every guard names the failure it was born from** (`Born from:` in the file — a test enforces
  it). A guard nobody can judge is one nobody can retire.
- **Every guard has a fire test, a silent test, and a fail-direction test.** `npm test`.
- **It runs on itself.** This repo has its own `.claude/harness.config.json`.
- **CI inits it into a fixture project** and runs the suite there before a tag can exist.
- **The inbox is a file.** `docs/harness-feedback.md`, one line per annoyance. `harness retro`
  assembles it into a prompt; a session proposes at most three changes; a human approves.

Guards invented in advance mostly generate noise. Use it for a week before adding anything.
