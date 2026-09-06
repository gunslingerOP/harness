'use strict';
// THE REGISTER READER. Everything the collector wrote — OTLP JSON, one request per line — turned
// into the few numbers a retro needs: sessions, cost, tool failures, guard fires, API errors.
// HYGIENE: fails OFF — no register means an empty summary and a hint, never a crash.
//
// Born from: a harness whose only memory was a hand-written inbox. A guard nobody can see firing
// is a guard nobody can retire, and "the agent verified it" cannot be checked against nothing.
//
// reads: telemetry.register_dir
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(process.env.HOME ?? '', '.harness', 'register');

/** OTLP attribute lists are [{key, value:{stringValue|intValue|doubleValue|boolValue}}]. */
function attrs(list) {
  const out = {};
  for (const a of list ?? []) {
    const v = a.value ?? {};
    out[a.key] = v.stringValue ?? (v.intValue !== undefined ? Number(v.intValue) : undefined) ?? v.doubleValue ?? v.boolValue ?? null;
  }
  return out;
}

/** Walks one OTLP JSON request and yields flat events: { name, ts, attrs, resource }. */
function* events(obj) {
  for (const rl of obj.resourceLogs ?? []) {
    const resource = attrs(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        const a = attrs(rec.attributes);
        const name = a['event.name'] ?? rec.body?.stringValue ?? rec.eventName ?? '';
        const ts = Number(rec.timeUnixNano ?? rec.observedTimeUnixNano ?? 0) / 1e6;
        yield { name, ts, attrs: a, resource };
      }
    }
  }
}

function readFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('otel') && f.includes('.jsonl'))
    .map((f) => path.join(dir, f));
}

/** Summarise the register since `days` ago. Pure over the parsed events, so tests can feed it. */
function summarise(evs, { days = 14, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const s = {
    days,
    sessions: new Set(),
    byProject: {},
    tools: { total: 0, failed: 0, byName: {}, failedByName: {}, durations: [] },
    guard: { denied: 0, byTool: {} },
    api: { requests: 0, errors: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
    prompts: 0,
  };
  for (const e of evs) {
    if (e.ts && e.ts < since) continue;
    const a = e.attrs;
    const project = e.resource.project ?? a['project'] ?? '(unknown)';
    if (a['session.id']) {
      s.sessions.add(a['session.id']);
      s.byProject[project] = s.byProject[project] ?? new Set();
      s.byProject[project].add(a['session.id']);
    }
    switch (e.name) {
      case 'claude_code.tool_result': {
        s.tools.total += 1;
        const t = a.tool_name ?? '?';
        s.tools.byName[t] = (s.tools.byName[t] ?? 0) + 1;
        if (String(a.success) === 'false') {
          s.tools.failed += 1;
          s.tools.failedByName[t] = (s.tools.failedByName[t] ?? 0) + 1;
        }
        if (a.duration_ms) s.tools.durations.push(Number(a.duration_ms));
        break;
      }
      case 'claude_code.tool_decision':
        if (a.decision === 'reject' && a.source === 'hook') {
          s.guard.denied += 1;
          const t = a.tool_name ?? '?';
          s.guard.byTool[t] = (s.guard.byTool[t] ?? 0) + 1;
        }
        break;
      case 'claude_code.api_request':
        s.api.requests += 1;
        s.api.cost += Number(a.cost_usd ?? 0);
        s.api.tokens.input += Number(a.input_tokens ?? 0);
        s.api.tokens.output += Number(a.output_tokens ?? 0);
        s.api.tokens.cacheRead += Number(a.cache_read_tokens ?? 0);
        s.api.tokens.cacheCreation += Number(a.cache_creation_tokens ?? 0);
        break;
      case 'claude_code.api_error':
        s.api.errors += 1;
        break;
      case 'claude_code.user_prompt':
        s.prompts += 1;
        break;
      default:
    }
  }
  const d = s.tools.durations.sort((x, y) => x - y);
  return {
    days,
    sessions: s.sessions.size,
    byProject: Object.fromEntries(Object.entries(s.byProject).map(([k, v]) => [k, v.size])),
    prompts: s.prompts,
    tools: {
      total: s.tools.total,
      failed: s.tools.failed,
      medianMs: d.length ? d[Math.floor(d.length / 2)] : 0,
      byName: s.tools.byName,
      failedByName: s.tools.failedByName,
    },
    guard: s.guard,
    api: { ...s.api, cost: Number(s.api.cost.toFixed(2)) },
  };
}

function load(dir = DEFAULT_DIR) {
  const out = [];
  for (const f of readFiles(dir)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(...events(JSON.parse(line)));
      } catch {
        /* a torn line at rotation time is not a finding */
      }
    }
  }
  return out;
}

function render(sum) {
  const top = (o, n = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
  return [
    `REGISTER — last ${sum.days} days`,
    `  sessions       ${sum.sessions}   by project: ${top(sum.byProject)}`,
    `  prompts        ${sum.prompts}`,
    `  tool calls     ${sum.tools.total}   failed ${sum.tools.failed}   median ${sum.tools.medianMs}ms`,
    `  failures by    ${top(sum.tools.failedByName)}`,
    `  guard denials  ${sum.guard.denied}   ${top(sum.guard.byTool)}`,
    `  api            ${sum.api.requests} requests · ${sum.api.errors} errors · $${sum.api.cost}`,
    `  tokens         in ${sum.api.tokens.input} · out ${sum.api.tokens.output} · cache ${sum.api.tokens.cacheRead}`,
  ].join('\n');
}

function main() {
  const dir = process.env.HARNESS_REGISTER_DIR ?? DEFAULT_DIR;
  const days = Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 14);
  const evs = load(dir);
  if (!evs.length) {
    console.log(`register: nothing in ${dir} — is the collector running? (\`harness doctor\`)`);
    return;
  }
  const sum = summarise(evs, { days });
  console.log(process.argv.includes('--json') ? JSON.stringify(sum, null, 2) : render(sum));
}

module.exports = { attrs, events, summarise, load, render, DEFAULT_DIR };
if (require.main === module) main();
