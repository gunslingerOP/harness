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
  assert.match(res.stdout.split('\n')[0], /harness 0\.2\.0 · fixture-app · node/, res.stdout);
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
