'use strict';
// THE PROOF. Every guard: fires on a violation, stays silent on a clean case, and fails in the
// right DIRECTION when its config is gone. A guard without all three does not exist.
//
// Real temp git repos, real staged files, real config on disk. No mocks — the guard that ships is
// the guard under test, called the way the hook calls it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const HERE = path.resolve(__dirname, '..');
const { lint, stagedFiles } = require('../guards/repo-lint');
const { check } = require('../guards/safety');
const { validate, load, HarnessConfigMissing } = require('../lib/config');
const { gitLine } = require('../guards/banner');

const CONFIG = {
  harness: { version: '0.1.0', stack: 'node' },
  repo: { main_branch: 'main', protected_branches: ['main', 'release'] },
  layout: {
    top_dirs: ['src', 'docs', '.claude'],
    root_files: ['package.json', 'README.md', '.gitignore'],
    organized_dirs: [{ dir: 'src', max_files: 3, exempt: ['src/app'] }],
    source_extensions: ['.ts', '.js'],
    test_markers: ['.test.'],
  },
  docs: { required_for_code: false, doc_dirs: ['docs/'], skip_marker: '.claude/.skip-docs' },
  safety: { deny_patterns: ['\\bnpm\\s+publish\\b'] },
  deploy: { protected_stages: ['production'] },
  session: {},
};

/** A real repo in a temp dir, with the config written and an initial commit. */
function repo(config = CONFIG) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const write = (rel, content = '') => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return rel;
  };
  const stage = (...rels) => git('add', '-f', ...rels);
  if (config) write('.claude/harness.config.json', JSON.stringify(config));
  write('README.md', '# t');
  stage('README.md');
  git('commit', '-q', '-m', 'init');
  return { root, git, write, stage, rm: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const runGuard = (script, { cwd, stdin = '' }) =>
  spawnSync(process.execPath, [path.join(HERE, 'guards', script)], { cwd, input: stdin, encoding: 'utf8' });

// ───────────────────────── placement guard (hygiene) ─────────────────────────

test('lint FIRES: a file at the root that is not listed', () => {
  const r = repo();
  r.stage(r.write('notes.txt', 'x'));
  const { errors } = lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) });
  assert.ok(errors.some((e) => e.includes('closed root') && e.includes('notes.txt')), errors.join('\n'));
  r.rm();
});

test('lint FIRES: a new top-level directory that is not listed', () => {
  const r = repo();
  r.stage(r.write('lib/x.ts', ''));
  const { errors } = lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) });
  assert.ok(errors.some((e) => e.includes('"lib/"')), errors.join('\n'));
  r.rm();
});

test('lint FIRES: a flat dump in an organized directory', () => {
  const r = repo();
  for (const n of [1, 2, 3, 4]) r.write(`src/a${n}.ts`, '');
  r.stage(r.write('src/a5.ts', ''));
  const { errors } = lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) });
  assert.ok(errors.some((e) => e.includes('flat dump') && e.includes('src/')), errors.join('\n'));
  r.rm();
});

test('lint stays SILENT: tests do not count toward the flat-dump limit, and exempt dirs are exempt', () => {
  const r = repo();
  for (const n of [1, 2, 3]) r.write(`src/a${n}.ts`, '');
  for (const n of [1, 2, 3, 4, 5]) r.write(`src/a${n}.test.ts`, '');
  for (const n of [1, 2, 3, 4, 5, 6]) r.write(`src/app/r${n}.ts`, '');
  r.stage('src');
  const { errors } = lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) });
  assert.deepEqual(errors, []);
  r.rm();
});

test('lint FIRES: a tool artifact and a non-ASCII filename', () => {
  const r = repo();
  r.stage(r.write('src/.DS_Store', ''), r.write('src/café.ts', ''));
  const { errors } = lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) });
  assert.ok(errors.some((e) => e.includes('tool artifact')));
  assert.ok(errors.some((e) => e.includes('non-ASCII')));
  r.rm();
});

test('lint FIRES: docs required and code changed without docs; SILENT with the skip marker', () => {
  const cfg = { ...CONFIG, docs: { ...CONFIG.docs, required_for_code: true } };
  const r = repo(cfg);
  r.stage(r.write('src/x.ts', ''));
  assert.ok(lint({ root: r.root, config: cfg, staged: stagedFiles(r.root) }).errors.some((e) => e.includes('without docs')));
  r.write('.claude/.skip-docs', '');
  assert.deepEqual(lint({ root: r.root, config: cfg, staged: stagedFiles(r.root) }).errors, []);
  r.rm();
});

test('lint stays SILENT: a clean, listed, well-placed commit', () => {
  const r = repo();
  r.stage(r.write('src/feature/thing.ts', ''), r.write('docs/thing.md', ''));
  assert.deepEqual(lint({ root: r.root, config: CONFIG, staged: stagedFiles(r.root) }).errors, []);
  r.rm();
});

test('FAIL DIRECTION — hygiene fails OFF: no config → lint exits 0 and says so loudly', () => {
  const r = repo(null);
  r.stage(r.write('anything-goes.txt', 'x'));
  const res = runGuard('repo-lint.js', { cwd: r.root });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /HYGIENE GUARD OFF/);
  r.rm();
});

test('lint as the hook runs it: exit 1 on a violation, exit 0 clean', () => {
  const r = repo();
  r.stage(r.write('stray.txt', ''));
  assert.equal(runGuard('repo-lint.js', { cwd: r.root }).status, 1);
  r.git('reset', '-q');
  r.stage(r.write('src/ok.ts', ''));
  assert.equal(runGuard('repo-lint.js', { cwd: r.root }).status, 0);
  r.rm();
});

// ───────────────────────── safety guard (fails closed) ─────────────────────────

const DENIED = [
  'git push --force origin main',
  'git push -f',
  'git reset --hard HEAD~3',
  'git clean -fd',
  'git push origin --delete feature',
  'git push origin :feature',
  'git branch -D main',
  'git checkout -- .',
  'rm -rf /',
  'rm -rf ~',
  'rm -rf ~/',
];
const ALLOWED = ['git push', 'git push -u origin main', 'git push --force-with-lease', 'git reset --soft HEAD~1', 'git branch -d merged-feature', 'rm -rf node_modules', 'rm -rf ./dist', 'npm test', 'git checkout -- src/x.ts'];

test('safety FIRES on the floor, with or without config', () => {
  for (const c of DENIED) {
    assert.ok(check(c, CONFIG).deny, `should deny (config): ${c}`);
    assert.ok(check(c, null).deny, `should deny (NO config): ${c}`);
  }
});

test('safety stays SILENT on ordinary commands', () => {
  for (const c of ALLOWED) assert.equal(check(c, CONFIG).deny, false, `should allow: ${c}`);
});

test('safety FIRES on config policy: protected branches, deny patterns, protected deploy stages', () => {
  assert.ok(check('git branch -d release', CONFIG).deny, 'protected branch, even -d');
  assert.ok(check('git push origin :release', CONFIG).deny);
  assert.ok(check('npm publish', CONFIG).deny, 'deny_patterns');
  assert.ok(check('eas update --channel production', CONFIG).deny, 'protected stage');
  assert.equal(check('eas update --channel preview', CONFIG).deny, false);
  assert.equal(check('git branch -d old-thing', CONFIG).deny, false);
});

test('FAIL DIRECTION — safety fails CLOSED: no config → force push still exits 2', () => {
  const r = repo(null);
  const res = runGuard('safety.js', { cwd: r.root, stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force' } }) });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /DENIED/);
  r.rm();
});

test('FAIL DIRECTION — safety on an INVALID config still holds the floor', () => {
  const r = repo(null);
  r.write('.claude/harness.config.json', '{ not json');
  const res = runGuard('safety.js', { cwd: r.root, stdin: JSON.stringify({ tool_input: { command: 'git reset --hard' } }) });
  assert.equal(res.status, 2);
  r.rm();
});

test('safety as the hook runs it: exit 0 lets an ordinary command through', () => {
  const r = repo();
  const res = runGuard('safety.js', { cwd: r.root, stdin: JSON.stringify({ tool_input: { command: 'git status' } }) });
  assert.equal(res.status, 0, res.stderr);
  r.rm();
});

// ───────────────────────── banner + config ─────────────────────────

test('banner prints git truth, and runs the configured status command', () => {
  const r = repo({ ...CONFIG, session: { banner_command: 'echo STATUS-RAN' } });
  const res = runGuard('banner.js', { cwd: r.root });
  assert.match(res.stdout, /⎇ main/);
  assert.match(res.stdout, /STATUS-RAN/);
  assert.match(gitLine(r.root), /1 dirty|0 dirty/);
  r.rm();
});

test('banner fails OFF: no config → git line plus a hint, exit 0', () => {
  const r = repo(null);
  const res = runGuard('banner.js', { cwd: r.root });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /⎇ main/);
  assert.match(res.stdout, /harness init/);
  r.rm();
});

test('config: missing required keys are named, not defaulted', () => {
  const errs = validate({ repo: {}, layout: {}, safety: {} });
  assert.ok(errs.some((e) => e.includes('repo.main_branch')));
  assert.ok(errs.some((e) => e.includes('layout.organized_dirs')));
  assert.ok(errs.some((e) => e.includes('safety.deny_patterns')));
  assert.deepEqual(validate(CONFIG), []);
});

test('config: load throws a typed error when absent, a plain error when invalid', () => {
  const r = repo(null);
  assert.throws(() => load({ root: r.root }), HarnessConfigMissing);
  r.write('.claude/harness.config.json', JSON.stringify({ repo: {} }));
  assert.throws(() => load({ root: r.root }), /invalid/);
  r.rm();
});

// ───────────────────────── every guard names its origin ─────────────────────────

test('every guard file states the failure it was born from', () => {
  for (const f of fs.readdirSync(path.join(HERE, 'guards'))) {
    const src = fs.readFileSync(path.join(HERE, 'guards', f), 'utf8');
    assert.match(src, /Born from:/, `${f} must say what failure justified it — a guard nobody can judge is one nobody can retire`);
  }
});

// ───────────────────────── bloat budget · dead guards · register · identity (v0.2.0) ─────────────────────────

const BUDGET = require('./budget.json');
const guardFiles = () => fs.readdirSync(path.join(HERE, 'guards')).filter((f) => f.endsWith('.js'));
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').length;

test('BUDGET: the harness cannot grow past its ceilings without editing budget.json', () => {
  assert.ok(guardFiles().length <= BUDGET.guards_max, `${guardFiles().length} guards > budget ${BUDGET.guards_max}`);
  for (const f of guardFiles()) {
    const n = lines(path.join(HERE, 'guards', f));
    assert.ok(n <= BUDGET.guard_max_lines, `${f} is ${n} lines > budget ${BUDGET.guard_max_lines}`);
  }
  const cli = lines(path.join(HERE, 'bin', 'harness.js'));
  assert.ok(cli <= BUDGET.cli_max_lines, `bin/harness.js is ${cli} lines > budget ${BUDGET.cli_max_lines}`);
  for (const t of fs.readdirSync(path.join(HERE, 'templates'))) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, 'templates', t), 'utf8'))).length;
    assert.ok(keys <= BUDGET.config_top_level_keys_max, `${t} has ${keys} top-level keys > budget`);
  }
  const deps = Object.keys(require('../package.json').dependencies ?? {}).length;
  assert.equal(deps, BUDGET.dependencies_max, 'zero runtime dependencies is a budget line, not a preference');
});

test('DEAD GUARDS: every guard declares the config keys it reads, and every template has them', () => {
  const templates = fs.readdirSync(path.join(HERE, 'templates')).map((t) => [t, JSON.parse(fs.readFileSync(path.join(HERE, 'templates', t), 'utf8'))]);
  const getPath = (o, k) => k.split('.').reduce((x, p) => (x && typeof x === 'object' ? x[p] : undefined), o);
  for (const f of guardFiles()) {
    const src = fs.readFileSync(path.join(HERE, 'guards', f), 'utf8');
    const m = /^\/\/ reads: (.+)$/m.exec(src);
    assert.ok(m, `${f} must declare "// reads: <dotted keys>" (or "none") — a guard whose inputs nobody can see is one nobody can retire`);
    if (m[1].trim() === 'none') continue;
    for (const key of m[1].split(',').map((k) => k.trim())) {
      for (const [t, cfg] of templates) assert.notEqual(getPath(cfg, key), undefined, `${f} reads ${key} but templates/${t} does not define it — dead guard or missing policy`);
    }
  }
});

test('REGISTER: parses the collector file-exporter shape and summarises what a retro needs', () => {
  const reg = require('../guards/register');
  // THE REAL WIRE SHAPE, captured from a live session on 2026-09-07: `event.name` is UNPREFIXED
  // (`user_prompt`), `body` carries the prefixed form. The first fixture mirrored the docs instead
  // and the reader silently counted nothing — a test that agrees with its author proves nothing.
  const line = (name, extra) => ({
    resourceLogs: [{ resource: { attributes: [{ key: 'project', value: { stringValue: 'domybest' } }] }, scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now() * 1e6), body: { stringValue: `claude_code.${name}` }, attributes: [{ key: 'event.name', value: { stringValue: name } }, { key: 'session.id', value: { stringValue: 's1' } }, ...Object.entries(extra).map(([k, v]) => ({ key: k, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: String(v) } }))] }] }] }],
  });
  const evs = [
    ...reg.events(line('tool_result', { tool_name: 'Bash', success: 'true', duration_ms: 120 })),
    ...reg.events(line('tool_result', { tool_name: 'Bash', success: 'false', duration_ms: 40 })),
    ...reg.events(line('tool_decision', { tool_name: 'Bash', decision: 'reject', source: 'hook' })),
    ...reg.events(line('api_request', { cost_usd: '0.5', input_tokens: 1000, output_tokens: 200 })),
    ...reg.events(line('api_error', { status_code: 529 })),
  ];
  const s = reg.summarise(evs, { days: 14 });
  assert.equal(s.sessions, 1);
  assert.deepEqual(s.byProject, { domybest: 1 });
  assert.equal(s.tools.total, 2);
  assert.equal(s.tools.failed, 1);
  assert.equal(s.tools.failedByName.Bash, 1);
  assert.equal(s.guard.denied, 1, 'a hook denial is the guard firing — it must be countable');
  assert.equal(s.api.cost, 0.5);
  assert.equal(s.api.errors, 1);
  assert.match(reg.render(s), /guard denials\s+1/);
});

test('REGISTER: an old event is outside the window; a torn line is skipped, not fatal', () => {
  const reg = require('../guards/register');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reg-'));
  const old = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: String((Date.now() - 40 * 86400000) * 1e6), attributes: [{ key: 'event.name', value: { stringValue: 'user_prompt' } }, { key: 'session.id', value: { stringValue: 'old' } }] }] }] }] };
  fs.writeFileSync(path.join(dir, 'otel.jsonl'), `${JSON.stringify(old)}\n{ torn line\n`);
  const s = reg.summarise(reg.load(dir), { days: 14 });
  assert.equal(s.sessions, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('BANNER: identity first — harness version and project, then git truth', () => {
  const r = repo({ ...CONFIG, harness: { version: '0.2.0', stack: 'node', project: 'fixture-app' } });
  const res = runGuard('banner.js', { cwd: r.root });
  // The version comes from package.json, never a literal: 0.2.1 shipped with this asserting
  // 0.2.0 because the suite ran before the bump — a test that encodes today's number rots on the
  // next release.
  const v = require('../package.json').version.replace(/\./g, '\\.');
  assert.match(res.stdout.split('\n')[0], new RegExp(`harness ${v} · fixture-app · node`), res.stdout);
  assert.match(res.stdout, /⎇ main/);
  r.rm();
});

test('PUSH GUARD: fails CLOSED on the floor — deleting or force-pushing main is refused with no config', () => {
  const { check } = require('../guards/push-guard');
  const Z = '0'.repeat(40);
  assert.ok(check([{ localRef: '(delete)', localSha: Z, remoteRef: 'refs/heads/main', remoteSha: 'abc' }], null).length, 'delete main');
  assert.equal(check([{ localRef: 'refs/heads/feat', localSha: Z, remoteRef: 'refs/heads/feat', remoteSha: 'abc' }], null).length, 0, 'deleting a feature branch is fine');
  assert.ok(check([{ localRef: 'refs/heads/release', localSha: Z, remoteRef: 'refs/heads/release', remoteSha: 'abc' }], CONFIG).length, 'config-protected branch');
});

// ───────────────────────── global git hook chain ─────────────────────────

test('GLOBAL HOOKS: with core.hooksPath set, the chain runs the repo\'s own hook and RETURNS', () => {
  const { NAMES, hookBody } = require('../lib/git-hooks');
  const hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hooks-'));
  for (const n of NAMES) {
    fs.writeFileSync(path.join(hooksDir, n), hookBody(n, path.join(HERE, 'guards', 'push-guard.js')));
    fs.chmodSync(path.join(hooksDir, n), 0o755);
  }
  const r = repo();
  r.git('config', 'core.hooksPath', hooksDir);
  const marker = path.join(r.root, 'LOCAL-HOOK-RAN');
  const local = path.join(r.root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(local, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
  fs.chmodSync(local, 0o755);
  r.stage(r.write('src/x.ts', ''));
  // The first version of this chain hung forever here. Bound it: a commit must return in 10s.
  const res = spawnSync('git', ['commit', '-q', '-m', 'chained'], { cwd: r.root, encoding: 'utf8', timeout: 10000 });
  assert.equal(res.status, 0, `commit did not return cleanly: ${res.stderr} ${res.error ?? ''}`);
  assert.ok(fs.existsSync(marker), 'the repo\'s own pre-commit hook must still run under the global hooksPath');
  fs.rmSync(hooksDir, { recursive: true, force: true });
  r.rm();
});

test('GLOBAL HOOKS: the chain never execs itself, even if git resolves the local hook to the chain', () => {
  const { hookBody } = require('../lib/git-hooks');
  const body = hookBody('pre-commit', '/x/push-guard.js');
  assert.match(body, /--git-common-dir/, 'must resolve the repo\'s own hooks dir, not core.hooksPath');
  assert.match(body, /-ef "\$0"/, 'must refuse to exec itself');
});

// ───────────────────────── text, spans, agents, sessions (v0.2.3) ─────────────────────────

test('REGISTER: a span line parses as an event, so tool input/output on traces is readable', () => {
  const reg = require('../guards/register');
  const line = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ spans: [{ name: 'claude_code.tool', startTimeUnixNano: String(Date.now() * 1e6), attributes: [{ key: 'tool_name', value: { stringValue: 'Bash' } }, { key: 'tool_input', value: { stringValue: '{"command":"ls"}' } }] }] }] }] };
  const evs = [...reg.events(line)];
  assert.equal(evs.length, 1);
  assert.equal(evs[0].name, 'span:tool');
  assert.equal(evs[0].attrs.tool_input, '{"command":"ls"}');
});

test('REGISTER: cost and spawns are attributed BY AGENT from what is actually on the wire', () => {
  const reg = require('../guards/register');
  const rec = (name, extra) => ({ resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now() * 1e6), attributes: [{ key: 'event.name', value: { stringValue: name } }, { key: 'session.id', value: { stringValue: 's' } }, ...Object.entries(extra).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } }))] }] }] }] });
  const evs = [
    ...reg.events(rec('api_request', { cost_usd: '0.40', input_tokens: '100', output_tokens: '50' })),
    ...reg.events(rec('api_request', { cost_usd: '0.10', input_tokens: '10', output_tokens: '5', 'agent.name': 'general-purpose' })),
    ...reg.events(rec('tool_result', { tool_name: 'Agent', success: 'true', tool_parameters: '{"subagent_type":"general-purpose"}' })),
  ];
  const s = reg.summarise(evs, { days: 1 });
  assert.equal(s.api.cost, 0.5, 'total is still the total');
  assert.deepEqual(s.byAgent['general-purpose'], { requests: 1, cost: 0.1, tokens: 15, spawned: 1 });
  assert.match(reg.render(s), /general-purpose: 1 req \$0\.1 \(spawned 1\)/);
});

test('SESSION: finds a transcript by id or "last" and reads its turns in order', () => {
  const ses = require('../lib/session');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-projects-'));
  const dir = path.join(root, '-Users-x-app');
  fs.mkdirSync(dir);
  const lines = [
    { type: 'user', timestamp: 't1', message: { role: 'user', content: 'build the thing' } },
    { type: 'assistant', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: 't3', message: { role: 'user', content: [{ type: 'tool_result', is_error: false, content: [{ type: 'text', text: '# pass 3' }] }] } },
    { type: 'attachment', anything: true },
    { type: 'assistant', timestamp: 't4', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: 3 pass.' }] } },
  ];
  fs.writeFileSync(path.join(dir, 'abc-123.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  const t = ses.find('last', root);
  assert.equal(t.id, 'abc-123');
  assert.equal(ses.find('abc', root).id, 'abc-123', 'prefix match');
  assert.equal(ses.find('nope', root), null);
  const turns = ses.turns(t.path);
  assert.deepEqual(turns.map((x) => x.kind), ['prompt', 'response', 'tool', 'result', 'response']);
  assert.equal(turns[2].name, 'Bash');
  assert.match(ses.render(t, turns, null), /▶ PROMPT\s+build the thing/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ───────────────────────── attribution, rework, ground (v0.2.5) ─────────────────────────

test('SESSION: projectFromSlug derives a best-effort label — home-prefix stripped, worktrees rolled up, never empty', () => {
  const ses = require('../lib/session');
  assert.equal(ses.projectFromSlug('-Users-x-app', '/Users/x'), 'app');
  assert.equal(ses.projectFromSlug('-Users-x-work-widgets', '/Users/x'), 'work-widgets', 'a literal "-" in a path segment cannot be told apart from a separator — this is a label, not a path');
  assert.equal(ses.projectFromSlug('-Users-x-app--claude-worktrees-fix-1', '/Users/x'), 'app', 'a .claude/worktrees/* session rolls up to its parent project');
  assert.equal(ses.projectFromSlug('-Users-x', '/Users/x'), '(home)', 'a session run in $HOME itself gets a stable placeholder, never empty');
});

test('SESSION: projectFromSlug folds a dot-directory session directly under $HOME (~/.claude, ~/.config, …) into the (home) placeholder, not a fake project named after the dot-dir', () => {
  const ses = require('../lib/session');
  assert.equal(ses.projectFromSlug('-Users-dev--claude', '/Users/dev'), '(home)', '~/.claude itself — the "/" then "." both slugify to "-", giving "-claude", not a project');
  assert.equal(ses.projectFromSlug('-Users-dev--config', '/Users/dev'), '(home)', 'any dot-directory directly under $HOME, not just .claude specifically');
  assert.equal(ses.projectFromSlug('-Users-dev-widgets', '/Users/dev'), 'widgets', 'a normal project one level under $HOME is unaffected');
});

test('SESSION: projectFromSlug folds a Claude Code scratchpad cwd (/private/tmp/claude-<uid>/… or /tmp/claude-<uid>/…) into the embedded project, not the scratchpad\'s own machine-specific prefix', () => {
  const ses = require('../lib/session');
  assert.equal(ses.projectFromSlug('-private-tmp-claude-777--Users-dev-widgets', '/Users/dev'), 'widgets', 'the embedded, already-slugified project path is what matters, not the scratchpad root');
  assert.equal(ses.projectFromSlug('-tmp-claude-1000--Users-dev-widgets', '/Users/dev'), 'widgets', 'both the uid and the "private/" segment are generic — not hard-coded to one machine\'s 502');
  assert.equal(ses.projectFromSlug('-private-tmp-claude-777--Users-dev-work-sub-project', '/Users/dev'), 'work-sub-project', 'a nested project path folds the same way');
});

test('SESSION: projectIndex maps every transcript id under root to its derived project label', () => {
  const ses = require('../lib/session');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-projects-'));
  fs.mkdirSync(path.join(root, '-Users-x-app'));
  fs.writeFileSync(path.join(root, '-Users-x-app', 'id1.jsonl'), '');
  fs.mkdirSync(path.join(root, '-Users-x-app--claude-worktrees-fix-1'));
  fs.writeFileSync(path.join(root, '-Users-x-app--claude-worktrees-fix-1', 'id2.jsonl'), '');
  const idx = ses.projectIndex(root, '/Users/x');
  assert.equal(idx.get('id1'), 'app');
  assert.equal(idx.get('id2'), 'app', 'the worktree session rolls up to the same label as its parent');
  assert.equal(idx.get('missing'), undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('REGISTER: attribution PRECEDENCE — resource attribute wins, transcript-derived second, (unknown) only when neither exists', () => {
  const reg = require('../guards/register');
  const rec = (sid, resourceProject) => ({
    resourceLogs: [{
      resource: { attributes: resourceProject ? [{ key: 'project', value: { stringValue: resourceProject } }] : [] },
      scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now() * 1e6), attributes: [{ key: 'event.name', value: { stringValue: 'user_prompt' } }, { key: 'session.id', value: { stringValue: sid } }] }] }],
    }],
  });
  const evs = [...reg.events(rec('s1', 'tagged-proj')), ...reg.events(rec('s2')), ...reg.events(rec('s3'))];
  const sessionProjects = new Map([['s2', 'derived-proj']]); // s3 has no transcript either way
  const s = reg.summarise(evs, { days: 14, sessionProjects });
  assert.deepEqual(s.byProject, { 'tagged-proj': 1, 'derived-proj': 1, '(unknown)': 1 });
});

test('REGISTER: filterByProject shares projectOf\'s precedence, so --project scopes the WHOLE output, not just the session tally', () => {
  const reg = require('../guards/register');
  const rec = (sid, tool) => ({
    resourceLogs: [{
      resource: { attributes: [] },
      scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now() * 1e6), attributes: [{ key: 'event.name', value: { stringValue: 'tool_result' } }, { key: 'session.id', value: { stringValue: sid } }, { key: 'tool_name', value: { stringValue: tool } }, { key: 'success', value: { stringValue: 'true' } }] }] }],
    }],
  });
  const evs = [...reg.events(rec('s1', 'Bash')), ...reg.events(rec('s2', 'Bash'))];
  const sessionProjects = new Map([['s1', 'alpha'], ['s2', 'beta']]);
  const scoped = reg.filterByProject(evs, 'alpha', sessionProjects);
  assert.equal(scoped.length, 1);
  assert.equal(reg.summarise(scoped, { days: 14, sessionProjects }).tools.total, 1, 'a project filter scopes tool counts, not only the session count');
  assert.deepEqual(reg.filterByProject(evs, null, sessionProjects), evs, 'no filter is a no-op');
});

test('REGISTER: parseArgs reads --days and --project in both "--k=v" and "--k v" form', () => {
  const reg = require('../guards/register');
  assert.deepEqual(reg.parseArgs(['--days=30']), { days: 30, project: undefined, json: false });
  assert.deepEqual(reg.parseArgs(['--days', '7', '--project', 'myapp']), { days: 7, project: 'myapp', json: false });
  assert.deepEqual(reg.parseArgs([]), { days: 14, project: undefined, json: false });
  assert.equal(reg.parseArgs(['--json']).json, true);
});

test('REGISTER: render never truncates "by project:" — with more than five projects, the lowest-count one still shows', () => {
  const reg = require('../guards/register');
  const rec = (sid, project) => ({
    resourceLogs: [{
      resource: { attributes: [{ key: 'project', value: { stringValue: project } }] },
      scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now() * 1e6), attributes: [{ key: 'event.name', value: { stringValue: 'user_prompt' } }, { key: 'session.id', value: { stringValue: sid } }] }] }],
    }],
  });
  // Seven projects with two sessions each outrank an eighth with one — exactly the shape that
  // squeezed a correctly-attributed, low-volume project off a top-5 line.
  const heavy = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];
  const evs = [];
  let n = 0;
  for (const p of heavy) { evs.push(...reg.events(rec(`s${n++}`, p))); evs.push(...reg.events(rec(`s${n++}`, p))); }
  evs.push(...reg.events(rec(`s${n++}`, 'myapp')));
  const s = reg.summarise(evs, { days: 14 });
  assert.equal(Object.keys(s.byProject).length, 8, 'sanity: eight distinct projects in this window');
  const out = reg.render(s);
  assert.match(out, /myapp 1/, 'the 8th, lowest-count project must not be truncated off the by-project line');
  for (const p of heavy) assert.match(out, new RegExp(`\\b${p} 2\\b`));
});

test('REGISTER: render always shows the --project-scoped row, even when that project has zero sessions in the window', () => {
  const reg = require('../guards/register');
  const empty = { days: 14, sessions: 0, byProject: {}, prompts: 0, tools: { total: 0, failed: 0, medianMs: 0, byName: {}, failedByName: {} }, guard: { denied: 0, byTool: {} }, api: { requests: 0, errors: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } }, byAgent: {} };
  assert.match(reg.render(empty, { project: 'myapp' }), /by project: myapp 0/, 'a --project filter that matched nothing this window still names the project, not just "—"');
  assert.match(reg.render(empty), /by project: —/, 'with no --project filter and nothing in the window, the line stays empty');
});

test('REWORK: classifies Agent spawns by NAME PATTERN (not a hardcoded list) and rolls them up per session', () => {
  const rw = require('../lib/rework');
  const spawn = (sid, subagentType) => ({ name: 'tool_result', ts: Date.now(), attrs: { 'session.id': sid, tool_name: 'Agent', tool_parameters: JSON.stringify({ subagent_type: subagentType }) }, resource: {} });
  const evs = [spawn('s1', 'adversarial-reviewer'), spawn('s1', 'adversarial-reviewer'), spawn('s1', 'executor-feature'), spawn('s2', 'executor-bugfix'), spawn('s2', 'general-purpose')];
  const r = rw.compute(evs, { days: 14 });
  assert.equal(r.sessionsWithSpawns, 2);
  assert.equal(r.sessionsWithMultiReview, 1, 's1 spawned a reviewer-like agent twice');
  assert.equal(r.reviewSpawns, 2);
  assert.equal(r.executorSpawns, 2, 'executor-feature (s1) + executor-bugfix (s2) — "bugfix" does not steal the executor match');
  assert.equal(r.reviewPerExecutor, 1);
  assert.match(rw.render(r), /sessions with >=2 review rounds: 1/);
});

test('REWORK: "verif" in an agent name classifies as review-like too — verifier and adversarial-reviewer both review, general-purpose is neither', () => {
  const rw = require('../lib/rework');
  assert.equal(rw.classify('verifier').review, true);
  assert.equal(rw.classify('adversarial-reviewer').review, true);
  assert.equal(rw.classify('general-purpose').review, false);
  assert.equal(rw.classify('general-purpose').executor, false);
});

test('REWORK: an empty window renders plainly, with no divide-by-zero', () => {
  const rw = require('../lib/rework');
  const r = rw.compute([], { days: 14 });
  assert.equal(r.sessionsWithSpawns, 0);
  assert.equal(r.reviewPerExecutor, null);
  assert.match(rw.render(r), /no Agent-tool spawns/);
});

test('GROUND: a grounded claim passes; a fabricated quote, a missing file, and a claim with no evidence all fail', () => {
  const { ground } = require('../lib/ground');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  fs.writeFileSync(path.join(dir, 'src.js'), 'line one\nconst x = 42;\nline three\n');
  const plan = {
    claims: [
      { claim: 'x is 42', evidence: [{ file: 'src.js', line: 2, quote: 'const x = 42;' }] },
      { claim: 'fabricated', evidence: [{ file: 'src.js', quote: 'this text does not exist anywhere' }] },
      { claim: 'no evidence', evidence: [] },
      { claim: 'missing file', evidence: [{ file: 'nope.js', quote: 'anything' }] },
    ],
  };
  const r = ground(plan, { root: dir });
  assert.equal(r.total, 4);
  assert.equal(r.grounded, 1);
  assert.equal(r.failed, 3);
  assert.equal(r.failures.length, 3, 'one line per failing claim');
  assert.ok(r.failures.some((f) => f.includes('fabricated') && f.includes('src.js')));
  assert.ok(r.failures.some((f) => f.includes('no evidence')));
  assert.ok(r.failures.some((f) => f.includes('nope.js') && f.includes('not found')));
  assert.equal(r.summary, 'ground: 4 claims, 1 grounded, 3 failed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: an empty plan is a FAILURE, not a silent pass — {claims: []} and a plan with neither claims nor evidence both exit 1', () => {
  const { ground } = require('../lib/ground');
  const r1 = ground({ claims: [] }, { root: process.cwd() });
  assert.ok(r1.failures.some((f) => f.includes('ground: FAIL') && f.includes('no claims')), r1.failures.join('\n'));
  const r2 = ground({}, { root: process.cwd() });
  assert.ok(r2.failures.some((f) => f.includes('ground: FAIL') && f.includes('no claims')), r2.failures.join('\n'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ claims: [] }));
  const res = spawnSync(process.execPath, [path.join(HERE, 'lib', 'ground.js'), path.join(dir, 'empty.json'), '--root', dir], { encoding: 'utf8' });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /ground: FAIL — no claims/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: the line tolerance is exactly 3 — within it passes, one past it fails', () => {
  const { ground } = require('../lib/ground');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  fs.writeFileSync(path.join(dir, 'far.js'), `${body}\nconst target = 1;\n`); // "const target" lands on line 21
  assert.equal(ground({ claims: [{ claim: 'near', evidence: [{ file: 'far.js', line: 24, quote: 'const target = 1;' }] }] }, { root: dir }).failed, 0, 'line 21 is exactly 3 from claimed line 24');
  assert.equal(ground({ claims: [{ claim: 'far', evidence: [{ file: 'far.js', line: 25, quote: 'const target = 1;' }] }] }, { root: dir }).failed, 1, 'line 21 is 4 from claimed line 25');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: the simple-plan shape (top-level evidence[], no claims[]) is accepted', () => {
  const { ground } = require('../lib/ground');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  fs.writeFileSync(path.join(dir, 'src.js'), 'const ok = true;\n');
  const r = ground({ evidence: [{ file: 'src.js', quote: 'const ok = true;' }] }, { root: dir });
  assert.equal(r.total, 1);
  assert.equal(r.grounded, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: a CRLF file still grounds a multi-line quote — content and quote are both newline-normalised before matching', () => {
  const { ground, matchLines } = require('../lib/ground');
  // Written with explicit \r\n so this test does not depend on git's own line-ending handling.
  assert.deepEqual(matchLines('line one\r\nconst x = 42;\r\nline three\r\n', 'line one\nconst x = 42;'), [1], 'a bare unit check of the normaliser itself');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  fs.writeFileSync(path.join(dir, 'crlf.js'), 'line one\r\nconst x = 42;\r\nline three\r\n');
  const plan = { claims: [{ claim: 'two-line quote in a CRLF file', evidence: [{ file: 'crlf.js', quote: 'line one\nconst x = 42;' }] }] };
  const r = ground(plan, { root: dir });
  assert.equal(r.grounded, 1, r.failures.join('\n'));
  assert.equal(r.failed, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: as the CLI runs it — exit 0 when every claim grounds, exit 1 with FAIL lines otherwise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const ok = true;\n');
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify({ claims: [{ claim: 'ok', evidence: [{ file: 'a.js', quote: 'const ok = true;' }] }] }));
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ claims: [{ claim: 'nope', evidence: [{ file: 'a.js', quote: 'fabricated' }] }] }));
  const run = (plan) => spawnSync(process.execPath, [path.join(HERE, 'lib', 'ground.js'), plan, '--root', dir], { encoding: 'utf8' });
  const good = run(path.join(dir, 'good.json'));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /ground: 1 claims, 1 grounded, 0 failed/);
  const bad = run(path.join(dir, 'bad.json'));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GROUND: evidence[].file cannot escape --root — a "../" traversal and an absolute path both fail as ungrounded, not silently read', () => {
  const { ground } = require('../lib/ground');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ground-'));
  const root = path.join(dir, 'root');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'the secret');
  const plan = {
    claims: [
      { claim: 'traversal', evidence: [{ file: '../outside/secret.txt', quote: 'the secret' }] },
      { claim: 'absolute', evidence: [{ file: path.join(outside, 'secret.txt'), quote: 'the secret' }] },
    ],
  };
  const r = ground(plan, { root });
  assert.equal(r.grounded, 0, 'neither claim may ground by escaping --root');
  assert.equal(r.failed, 2);
  assert.ok(r.failures.some((f) => f.includes('traversal') && /root/i.test(f)), r.failures.join('\n'));
  assert.ok(r.failures.some((f) => f.includes('absolute') && /root/i.test(f)), r.failures.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
});
