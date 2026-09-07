'use strict';
// ONE SESSION, IN FULL. Claude Code already writes every message, tool call, tool result and
// subagent turn to ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl — the complete agentic record.
// OTel is the index (cost, failures, denials, per agent); the transcript is the text. This joins
// them by session id so "how did the agent actually do" is one command, not archaeology.
//
// Born from: "OTel has no prompt text — how am I supposed to review agentic performance?"
const fs = require('node:fs');
const path = require('node:path');

const PROJECTS = path.join(process.env.HOME ?? '', '.claude', 'projects');

/** Every transcript on the machine, newest first. `root` is injectable for tests. */
function transcripts(root = PROJECTS) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const proj of fs.readdirSync(root)) {
    const dir = path.join(root, proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      out.push({ id: f.replace('.jsonl', ''), project: proj, path: p, mtime: fs.statSync(p).mtimeMs, bytes: fs.statSync(p).size });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function find(idOrLast, root = PROJECTS) {
  const all = transcripts(root);
  if (idOrLast === 'last') return all[0] ?? null;
  return all.find((t) => t.id === idOrLast || t.id.startsWith(idOrLast)) ?? null;
}

/** The turns that matter, in order: prompts, responses, tool calls, tool results. */
function turns(file, { maxChars = 400 } = {}) {
  const out = [];
  const clip = (s) => (s.length > maxChars ? `${s.slice(0, maxChars)}…` : s);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const content = d.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) out.push({ kind: d.type === 'user' ? 'prompt' : 'response', text: clip(b.text.trim()), ts: d.timestamp });
      else if (b.type === 'tool_use') out.push({ kind: 'tool', name: b.name, input: clip(JSON.stringify(b.input ?? {})), ts: d.timestamp });
      else if (b.type === 'tool_result') {
        const txt = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join('');
        out.push({ kind: 'result', error: Boolean(b.is_error), text: clip(String(txt).trim()), ts: d.timestamp });
      }
    }
  }
  return out;
}

function render(t, list, summary) {
  const head = [`SESSION ${t.id}`, `  transcript  ${t.path} (${(t.bytes / 1048576).toFixed(1)} MB)`, `  project     ${t.project}`];
  if (summary) head.push(`  cost        $${summary.api.cost} · ${summary.api.requests} requests · ${summary.tools.total} tool calls, ${summary.tools.failed} failed · ${summary.guard.denied} denials`, `  by agent    ${Object.entries(summary.byAgent).map(([k, v]) => `${k} $${v.cost}`).join(' · ') || '—'}`);
  const body = list.map((x) => {
    if (x.kind === 'prompt') return `\n▶ PROMPT   ${x.text}`;
    if (x.kind === 'response') return `◀ RESPONSE ${x.text}`;
    if (x.kind === 'tool') return `  ⚙ ${x.name}  ${x.input}`;
    return `  ${x.error ? '✗' : '↳'} ${x.text}`;
  });
  return [...head, ...body].join('\n');
}

module.exports = { PROJECTS, transcripts, find, turns, render };
