#!/usr/bin/env node
'use strict';
// The harness CLI. Every subcommand is a thin call into lib/ or guards/ — nothing lives only here.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CONFIG_PATH, load, get, findRoot, HarnessConfigMissing } = require('../lib/config');

const HERE = path.resolve(__dirname, '..');
const PKG = require('../package.json');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : (rest[i + 1] ?? true);
};

const HOOKS = {
  SessionStart: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/node_modules/@gunslinger/harness/hooks/session-start.sh' }] }],
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/node_modules/@gunslinger/harness/hooks/pre-tool-use-safety.sh' }] }],
};

function detectStack(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('app.json') && has('node_modules/expo')) return 'expo';
  if (['next.config.js', 'next.config.mjs', 'next.config.ts'].some(has)) return 'next';
  return 'node';
}

function init() {
  const root = findRoot();
  const stack = flag('stack') ?? detectStack(root);
  const tpl = path.join(HERE, 'templates', `${stack}.json`);
  if (!fs.existsSync(tpl)) die(`no template for stack "${stack}" (have: ${fs.readdirSync(path.join(HERE, 'templates')).map((f) => f.replace('.json', '')).join(', ')})`);

  const cfgFile = path.join(root, CONFIG_PATH);
  if (fs.existsSync(cfgFile)) console.log(`keep   ${CONFIG_PATH} (exists — not overwritten)`);
  else {
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.copyFileSync(tpl, cfgFile);
    console.log(`write  ${CONFIG_PATH}  (from templates/${stack}.json — EDIT IT: the config is the policy)`);
  }

  // Merge hooks into .claude/settings.json without clobbering anything already there.
  const settingsFile = path.join(root, '.claude', 'settings.json');
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  settings.hooks = settings.hooks ?? {};
  let added = 0;
  for (const [event, entries] of Object.entries(HOOKS)) {
    settings.hooks[event] = settings.hooks[event] ?? [];
    const already = JSON.stringify(settings.hooks[event]).includes('@gunslinger/harness');
    if (!already) {
      settings.hooks[event].push(...entries);
      added += 1;
    }
  }
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`${added ? 'wire ' : 'keep '}  .claude/settings.json hooks (${added} added)`);

  const inbox = path.join(root, 'docs', 'harness-feedback.md');
  if (!fs.existsSync(inbox)) {
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, '# Harness feedback\n\nOne line whenever the harness annoys you or lets something through. `npx harness retro` reads this.\n\n');
    console.log('write  docs/harness-feedback.md');
  }

  console.log(`
next:
  1. edit ${CONFIG_PATH} — top_dirs, root_files and organized_dirs are YOUR policy
  2. add to package.json scripts:   "harness:lint": "harness lint", "harness:test": "harness test"
  3. run \`harness lint\` from your pre-commit hook (lint-staged, simple-git-hooks, husky)
  4. npx harness test   — every guard must fire AND stay silent before you trust it
  5. npx harness doctor — whenever something feels off`);
}

function run(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

function doctor() {
  const root = findRoot();
  const line = (ok, msg) => console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  console.log(`\nharness doctor — ${PKG.name}@${PKG.version} in ${root}\n`);
  let ok = true;
  try {
    const { config } = load({ root });
    line(true, `${CONFIG_PATH} valid (stack: ${config.harness?.stack ?? 'unspecified'})`);
    const want = PKG.version;
    const have = config.harness?.version;
    if (have && have !== want) line(false, `config written for harness ${have}, installed is ${want} — review templates/ for new keys`);
  } catch (e) {
    ok = false;
    line(false, e instanceof HarnessConfigMissing ? `no ${CONFIG_PATH} — run \`harness init\`` : e.message.split('\n')[0]);
  }
  const settingsFile = path.join(root, '.claude', 'settings.json');
  const wired = fs.existsSync(settingsFile) && fs.readFileSync(settingsFile, 'utf8').includes('@gunslinger/harness');
  line(wired, wired ? 'hooks wired in .claude/settings.json' : 'hooks NOT wired — run `harness init`');
  ok = ok && wired;
  const pkgFile = path.join(root, 'package.json');
  const scripts = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts ?? {} : {};
  const lintWired = Object.values(scripts).some((s) => /harness lint/.test(s)) || fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit')) && fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8').includes('harness');
  line(lintWired, lintWired ? 'placement guard reachable from pre-commit' : 'placement guard not in any pre-commit path — add `harness lint`');
  const inbox = fs.existsSync(path.join(root, 'docs', 'harness-feedback.md'));
  line(inbox, inbox ? 'feedback inbox present' : 'no docs/harness-feedback.md — the retro loop has nothing to read');
  console.log(`\n  guards: run \`harness test\` to prove they fire and stay silent.\n`);
  process.exit(ok && wired ? 0 : 1);
}

function retro() {
  // Assembles the evidence an LLM session needs to propose harness changes. It does NOT call a
  // model: the loop is a session + a human approving PRs, never an unsupervised cron.
  const root = findRoot();
  const inbox = path.join(root, 'docs', 'harness-feedback.md');
  const notes = fs.existsSync(inbox) ? fs.readFileSync(inbox, 'utf8') : '(no inbox)';
  const log = spawnSync('git', ['log', '--since=14 days', '--format=%h %s', '--', '.claude', 'scripts', '.github'], { cwd: root, encoding: 'utf8' }).stdout;
  console.log(`# Harness retro — ${new Date().toISOString().slice(0, 10)}

Read the inbox and the recent harness-related commits below. Propose AT MOST THREE changes, each
tied to a specific line of evidence. Proposals only — a human approves. A fix lands as machinery
(a guard, a lint, a config key), never as prose. If nothing has evidence behind it, say so.

## Inbox (docs/harness-feedback.md)
${notes}
## Harness-related commits, last 14 days
${log || '(none)'}
## Rules
- every proposed guard names the failure that justifies it
- every proposed guard ships with a fire test, a silent test, and its fail direction
- a guard the project cannot feed is worse than no guard`);
}

function review() {
  process.stdout.write(fs.readFileSync(path.join(HERE, 'discipline', 'adversarial-reviewer.md'), 'utf8'));
}

function die(msg) {
  console.error(`harness: ${msg}`);
  process.exit(1);
}

switch (cmd) {
  case 'init': init(); break;
  case 'lint': run('guards/repo-lint.js'); break;
  case 'safety': run('guards/safety.js'); break;
  case 'banner': run('guards/banner.js'); break;
  case 'test': {
    const suite = path.join(HERE, 'test', 'harness-test.js');
    // A missing suite must be a loud failure, not a quiet exit 0 — an install that cannot prove
    // its guards is exactly the install you should not trust. (0.1.0 shipped without test/ in
    // package.json "files"; every consumer's `harness test` was a no-op.)
    if (!fs.existsSync(suite)) die(`suite not found at ${suite} — this install is incomplete; reinstall the harness`);
    const r = spawnSync(process.execPath, ['--test', suite], { stdio: 'inherit', env: { ...process.env, HARNESS_CONSUMER_ROOT: findRoot() } });
    process.exit(r.status ?? 1);
  }
  case 'doctor': doctor(); break;
  case 'retro': retro(); break;
  case 'review': review(); break;
  case 'config': {
    const key = rest[0];
    if (!key) die('usage: harness config <dotted.key>');
    try {
      const v = get(load().config, key);
      if (v === undefined) process.exit(1);
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
    } catch (e) {
      if (e instanceof HarnessConfigMissing) process.exit(1);
      die(e.message);
    }
    break;
  }
  case 'version': case '--version': case '-v': console.log(PKG.version); break;
  default:
    console.log(`harness ${PKG.version} — mechanism only; your ${CONFIG_PATH} is the policy

  init [--stack expo|next|node]   write the config from a template, wire hooks, create the inbox
  lint                            placement guard on staged files (pre-commit)     hygiene: fails OFF
  safety                          PreToolUse guard, reads the tool call on stdin    safety:  fails CLOSED
  banner                          SessionStart: git truth + your status command
  test                            prove every guard fires, stays silent, and fails the right way
  doctor                          is this project's install healthy
  retro                           assemble the inbox + recent changes into a retro prompt
  review                          print the adversarial-reviewer discipline
  config <dotted.key>             read one value (for shell scripts)`);
}
