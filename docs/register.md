# The register — everything that happens, recorded, free, local

One OpenTelemetry Collector on this machine, one JSONL file. Every agent that speaks OTLP points
at it: Claude Code natively (env in `settings.json`), Codex CLI natively (`~/.codex/config.toml`
`[otel]`). No custom schema, no service, no dashboard.

```
agent session ──OTLP http/json──▶ 127.0.0.1:4318 ──▶ ~/.harness/register/otel.jsonl (rotated)
```

`harness install --global` downloads the collector, writes its config, registers it with launchd
(`dev.gunslinger.harness.otelcol`, restarts on crash and login), and puts the telemetry env in
`~/.claude/settings.json` so every Claude Code session on this machine emits. `harness init` adds
`OTEL_RESOURCE_ATTRIBUTES=project=<name>` per project so the register knows which repo a session
belonged to.

## What is in it

From Claude Code: `user_prompt` **with the prompt text**, `assistant_response` **with the response
text**, `tool_result` (name, success, duration, the command), `tool_decision` (**every guard
denial arrives here as `source=hook`**), `api_request` (cost, tokens, **attributed per agent** —
`agent.name` on subagent requests), `api_error`, `subagent_completed`, hook executions, MCP
connections, session counts, lines of code, commits, PRs. With tracing on, `claude_code.tool`
spans carry **tool input and output** (truncated at 60 KB).

That is the index. **The full record is the transcript Claude Code already writes** to
`~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` — every message, tool call, result and subagent
turn, keyed by the same session id. `harness session <id|last>` joins the two.

## Attribution — which project a session belongs to

`OTEL_RESOURCE_ATTRIBUTES=project=<name>` only tags sessions that started after `harness init` ran
in that exact directory. Everything older, and anything run in a repo the harness was only
`install --global`-ed into, has no `project` resource attribute — and `by project:` used to just
call all of it `(unknown)`.

`harness register` now resolves a project in this order, for every event:

1. **The OTel resource attribute** `harness init` writes — always wins when present.
2. **A literal `project` log attribute**, if some other emitter sets one that way.
3. **Transcript-derived** — `lib/session.js` maps the session id to its transcript under
   `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` and turns the slug back into a label (home
   directory prefix stripped, a nested `.claude/worktrees/*` segment collapsed onto its parent, so
   every worktree of one project rolls up together). Slugification replaces every non-alphanumeric
   character with `-`, one for one — which makes it **lossy**: a literal `-` inside a real
   directory name is indistinguishable from a path separator. This label is good enough to GROUP
   sessions by project; treat it as a label, not a reconstructed path.
4. **`(unknown)`** — only when neither of the above resolves anything (no resource tag, and no
   transcript on this machine for that session id).

`--project <name>` scopes register's entire output to one project — not just the session count,
every number (tools, cost, failures, rework) — using the same precedence.

### Privacy — read this once

The env is machine-wide, so **sessions in client repos record their prompt and response text
too**, in the same local file. It never leaves this machine, is never deleted by age, and nothing
reads it but you. If a client's terms make even local recording a problem, remove
`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES` and `OTEL_LOG_TOOL_CONTENT` from
`~/.claude/settings.json` `env` for the duration — the transcripts Claude Code writes on its own
are unaffected either way.

## Reading it

```
npx harness register                        # last 14 days: sessions, cost, rework, per project
npx harness register --days 30 --json
npx harness register --project myapp        # the whole output, scoped to one project
npx harness session last        # one session in full: prompts, responses, tool calls, results, cost
npx harness session 1c23e6 --full
jq 'select(.resourceLogs)' ~/.harness/register/otel.jsonl | ...   # it is just JSON
```

Reviewing agentic performance is `harness session`: what was asked, what the agent said, what it
ran, what came back, what it cost — and which subagent spent what.

`harness retro` folds it in beside the inbox and the incident issues, and — because the register
knows which guards fired — proposes **retirements** as well as additions.

## Rework signal

Below the summary, `harness register` prints one more line:

```
rework         sessions with >=2 review rounds: 3   review spawns per executor spawn: 1.4
```

**What it measures:** Agent-tool spawns in the window, grouped by session, classified by NAME
PATTERN — not a hardcoded list, since agent names are a project's policy and the harness is
mechanism. "review" matches any spawned agent type containing "review" (the harness's own shipped
agent is `adversarial-reviewer`); "executor" matches any type containing "executor" (a common
convention, not a requirement — see `lib/rework.js`). A session with two or more review-like
spawns counts toward `sessions with >=2 review rounds`.

**What it cannot measure:** whether those review spawns were rounds on the SAME piece of work, or
several unrelated reviews in one session — both look identical to this signal. It is a workload
ratio ("how much review relative to how much execution"), not a rounds-per-ticket count.

**Investigated, not wired:** some workflows (the Workflow tool, not the Agent tool) label their own
journal entries with a round number per subject — a real rounds-per-ticket signal where it applies,
found in `<sessionId>/subagents/workflows/*/journal.jsonl`. It is one skill's labeling convention,
not a contract every workflow honours, so the generic harness does not depend on it; a project that
wants it can read its own journals with `lib/session.js#transcripts`.

`harness retro` folds the same numbers into its prompt, so a retro proposing a fix for "too much
back-and-forth" has a number to point at.

## Failure mode

Telemetry fails OFF. If the collector is down, Claude Code logs `[3P telemetry]` under `--debug`
and the session runs normally. `harness doctor` reports collector liveness and register freshness.

## Retention

**Nothing is deleted.** Files roll at 50 MB so each stays readable; there is no age limit and no
backup count. The register is the memory — pruning it is a decision to make on purpose, later,
not a default that makes it for you. Disk math: a heavy day is a few MB.

## Not local?

Add a second exporter to `~/.harness/otel/collector.yaml` — Grafana Cloud's free tier takes OTLP
directly (10k series, 50 GB logs, 50 GB traces, 14-day retention, no card). Nothing else changes.
