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

From Claude Code alone: `user_prompt`, `tool_result` (name, success, duration), `tool_decision`
(**every guard denial arrives here as `source=hook`**), `api_request` (cost, tokens), `api_error`,
`permission_mode_changed`, session counts, lines of code, commits, PRs. Prompt and response text
are redacted by default and stay that way — `OTEL_LOG_TOOL_DETAILS=1` records tool names and
commands, which is what a retro needs, and nothing more.

## Reading it

```
npx harness register            # last 14 days: sessions, failures, guard fires, cost
npx harness register --days=30 --json
jq 'select(.resourceLogs)' ~/.harness/register/otel.jsonl | ...   # it is just JSON
```

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
