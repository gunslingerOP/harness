'use strict';
// REWORK SIGNAL — how many times work bounced between an executor and a reviewer before it
// landed. Pure over the SAME parsed event list guards/register.js already builds, so `harness
// register` and `harness retro` both feed it for free.
//
// Born from: plans written from memory instead of from the code getting sent back by reviewers,
// sometimes twice, with nothing in the register counting the rounds — a retro proposing "stop
// planning from memory" had no number to point at.
//
// What this measures: Agent-tool spawns, classified by NAME PATTERN (not a hardcoded list — the
// harness is mechanism, agent names are policy), grouped by session. "review" matches any spawned
// agent whose type/name contains "review" (the harness's own shipped agent is
// "adversarial-reviewer"; a project's is typically "<something>-review" or "reviewer"). "executor"
// matches any type containing "executor" (a common convention, not a requirement).
//
// What this CANNOT measure: whether N reviewer spawns in one session were N rounds on the SAME
// deliverable, or N unrelated reviews. A session that spawns a reviewer twice for two different
// files looks identical here to one bounced twice on the same plan. Treat this as a workload
// signal ("review is happening a lot relative to execution"), not a rounds-per-ticket count.
// investigated-but-not-wired: some workflows (the Workflow tool, not the Agent tool) label their
// own journal entries with a round number per subject (e.g. "verify1:conventions:1" through
// "…:6") — a true rounds-per-ticket signal, but it is one skill's labeling convention, not a
// stable mechanism-level contract every project or workflow honours. Wiring the generic harness to
// one skill's label grammar would be encoding policy where only mechanism belongs, so it stays
// out; a project that wants it can read its own journals with `lib/session.js`.
const REVIEW_RE = /review/i;
const EXECUTOR_RE = /executor/i;

/** The subagent type/name of an Agent-tool spawn, from whichever attribute carries it on the
 *  wire: `agent.name` on the api_request events an agent makes, or `tool_parameters.subagent_type`
 *  on the parent's `tool_result` for the Agent tool call itself. Shared with guards/register.js so
 *  "who got spawned" is parsed in exactly one place. */
function agentType(attrs) {
  if (attrs['agent.name']) return attrs['agent.name'];
  try {
    return JSON.parse(attrs.tool_parameters ?? '{}').subagent_type ?? null;
  } catch {
    return null;
  }
}

/** { review, executor }: independent tags, not exclusive categories — "executor-bugfix" is
 *  executor-like and not review-like; a name can in principle be neither or (rarely) both. */
function classify(name) {
  return { review: Boolean(name) && REVIEW_RE.test(name), executor: Boolean(name) && EXECUTOR_RE.test(name) };
}

/** Pure over the parsed event list: one row per session that spawned at least one Agent. */
function compute(evs, { days = 14, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const bySession = new Map();
  for (const e of evs) {
    if (e.ts && e.ts < since) continue;
    if (e.name !== 'tool_result' || e.attrs.tool_name !== 'Agent') continue;
    const sid = e.attrs['session.id'];
    if (!sid) continue;
    const c = classify(agentType(e.attrs));
    const row = bySession.get(sid) ?? { total: 0, review: 0, executor: 0 };
    row.total += 1;
    if (c.review) row.review += 1;
    if (c.executor) row.executor += 1;
    bySession.set(sid, row);
  }
  const rows = [...bySession.values()];
  const reviewSpawns = rows.reduce((n, r) => n + r.review, 0);
  const executorSpawns = rows.reduce((n, r) => n + r.executor, 0);
  return {
    days,
    sessionsWithSpawns: rows.length,
    sessionsWithMultiReview: rows.filter((r) => r.review >= 2).length,
    reviewSpawns,
    executorSpawns,
    reviewPerExecutor: executorSpawns ? Number((reviewSpawns / executorSpawns).toFixed(2)) : null,
  };
}

function render(r) {
  if (!r.sessionsWithSpawns) return 'rework         no Agent-tool spawns in the window — nothing to measure';
  const ratio = r.reviewPerExecutor === null ? 'n/a (no executor-like spawns)' : r.reviewPerExecutor;
  return `rework         sessions with >=2 review rounds: ${r.sessionsWithMultiReview}   review spawns per executor spawn: ${ratio}`;
}

module.exports = { REVIEW_RE, EXECUTOR_RE, agentType, classify, compute, render };
