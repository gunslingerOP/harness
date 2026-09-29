'use strict';
// GROUND — a deterministic check that a plan is grounded in the code, not in memory. A planner
// cites a file, an optional line, and an exact quote for every claim it makes; this verifies each
// quote is really there before an executor spends a turn (or a reviewer spends a pass) on it.
//
// Born from: plans written from memory instead of from the code, sent back by reviewers once or
// twice each — human review caught it, but nothing MACHINE-CHECKABLE did, so it cost a round trip
// every time instead of failing before the executor started. See docs/ground.md for the intended
// wiring: the executor's first action is `harness ground plan.json`, before any code is written.
const fs = require('node:fs');
const path = require('node:path');

const TRUNCATE = 80;
const clip = (s) => (s.length > TRUNCATE ? `${s.slice(0, TRUNCATE)}…` : s);

/** Accepts `{ claims: [{ claim, evidence: [{file, line?, quote}] }] }`, or the simple-plan shape
 *  `{ evidence: [{file, line?, quote}] }` with no claims wrapper — each entry becomes its own
 *  claim so the summary still counts something meaningful. */
function normalize(plan) {
  if (Array.isArray(plan?.claims)) return plan.claims;
  if (Array.isArray(plan?.evidence)) return plan.evidence.map((ev, i) => ({ claim: `evidence[${i}]`, evidence: [ev] }));
  return [];
}

/** Every line index (1-based) where `quote` starts in `content`, verbatim, in order. Both are
 *  newline-normalised first (\r\n -> \n): a multi-line quote joins its lines with a bare \n, so a
 *  CRLF file — the \r surviving between what indexOf treats as two separate characters — would
 *  otherwise never match even though the text is genuinely present. */
function matchLines(content, quote) {
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  const c = normalize(content);
  const q = normalize(quote);
  const lines = [];
  for (let from = 0; ; ) {
    const idx = c.indexOf(q, from);
    if (idx === -1) return lines;
    lines.push(c.slice(0, idx).split('\n').length);
    from = idx + Math.max(q.length, 1);
  }
}

/** One evidence entry: `{ ok }` or `{ ok: false, reason }`. */
function checkEvidence(ev, root) {
  if (!ev?.file) return { ok: false, reason: 'evidence entry has no "file"' };
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, ev.file);
  // CONTAINMENT: path.resolve happily walks a "../" outside root, or — for an absolute ev.file
  // like "/etc/passwd" — ignores root entirely. Either used to ground with exit 0. A plan may only
  // cite evidence that actually lives under the root it was told to ground against.
  if (file !== resolvedRoot && !file.startsWith(resolvedRoot + path.sep)) {
    return { ok: false, reason: `evidence file escapes --root ${resolvedRoot}: ${ev.file}` };
  }
  if (!fs.existsSync(file)) return { ok: false, reason: `file not found: ${ev.file}` };
  if (fs.statSync(file).isDirectory()) return { ok: false, reason: `${ev.file} is a directory, not a file` };
  const quote = String(ev.quote ?? '').trim();
  if (!quote) return { ok: false, reason: `empty quote for ${ev.file}` };
  const lines = matchLines(fs.readFileSync(file, 'utf8'), quote);
  if (!lines.length) return { ok: false, reason: `quote not found in ${ev.file}: "${clip(quote)}"` };
  if (ev.line != null && !lines.some((l) => Math.abs(l - ev.line) <= 3)) {
    return { ok: false, reason: `quote found in ${ev.file} at line ${lines.join(',')} but not within 3 of claimed line ${ev.line}: "${clip(quote)}"` };
  }
  return { ok: true };
}

/** Pure: `{ failures: string[], grounded, failed, total, summary }`. The CLI and the tests share
 *  this — `--root` resolves relative `evidence[].file` paths (default: cwd). */
function ground(plan, { root = process.cwd() } = {}) {
  const claims = normalize(plan);
  const failures = [];
  let grounded = 0;
  // An empty plan — {"claims": []}, or no claims[] and no evidence[] at all — is not a grounded
  // plan with nothing to check; it is indistinguishable from a planner that emitted nothing. Fail
  // it explicitly rather than let a 0/0 tally read as a clean pass.
  if (!claims.length) failures.push('ground: FAIL — no claims');
  for (const c of claims) {
    const evidence = c.evidence ?? [];
    if (!evidence.length) {
      failures.push(`ground: FAIL — "${c.claim}" — no evidence`);
      continue;
    }
    const bad = evidence.map((ev) => ({ ev, ...checkEvidence(ev, root) })).filter((r) => !r.ok);
    if (bad.length) for (const b of bad) failures.push(`ground: FAIL — "${c.claim}" — ${b.reason}`);
    else grounded += 1;
  }
  const failed = claims.length - grounded;
  return { failures, grounded, failed, total: claims.length, summary: `ground: ${claims.length} claims, ${grounded} grounded, ${failed} failed` };
}

function main() {
  const argv = process.argv.slice(2);
  const planPath = argv.find((a) => !a.startsWith('--'));
  if (!planPath) {
    console.error('usage: harness ground <plan.json> [--root <dir>]');
    process.exit(1);
  }
  const ri = argv.indexOf('--root');
  const root = ri !== -1 && argv[ri + 1] ? path.resolve(argv[ri + 1]) : process.cwd();
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (e) {
    console.error(`harness ground: cannot read/parse ${planPath}: ${e.message}`);
    process.exit(1);
  }
  const { failures, summary } = ground(plan, { root });
  for (const f of failures) console.log(f);
  console.log(summary);
  process.exit(failures.length ? 1 : 0);
}

module.exports = { normalize, matchLines, checkEvidence, ground };
if (require.main === module) main();
