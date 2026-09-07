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

### Privacy — read this once

The env is machine-wide, so **sessions in client repos record their prompt and response text
too**, in the same local file. It never leaves this machine, rotates after 30 days, and nothing
reads it but you. If a client's terms make even local recording a problem, remove
`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES` and `OTEL_LOG_TOOL_CONTENT` from
`~/.claude/settings.json` `env` for the duration — the transcripts Claude Code writes on its own
are unaffected either way.

## Reading it

```
npx harness register            # last 14 days: sessions, failures, guard fires, cost, per agent
npx harness register --days=30 --json
npx harness session last        # one session in full: prompts, responses, tool calls, results, cost
npx harness session 1c23e6 --full
jq 'select(.resourceLogs)' ~/.harness/register/otel.jsonl | ...   # it is just JSON
```

Reviewing agentic performance is `harness session`: what was asked, what the agent said, what it
ran, what came back, what it cost — and which subagent spent what.

`harness retro` folds it in beside the inbox and the incident issues, and — because the register
knows which guards fired — proposes **retirements** as well as additions.

## Failure mode

Telemetry fails OFF. If the collector is down, Claude Code logs `[3P telemetry]` under `--debug`
and the session runs normally. `harness doctor` reports collector liveness and register freshness.

## Retention

50 MB per file, 12 backups, 30 days. Old data is deleted, not archived — the retro has already
read it, and what was worth keeping became a guard, an issue or a LEDGER row.

## Not local?

Add a second exporter to `~/.harness/otel/collector.yaml` — Grafana Cloud's free tier takes OTLP
directly (10k series, 50 GB logs, 50 GB traces, 14-day retention, no card). Nothing else changes.
