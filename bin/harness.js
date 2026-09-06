#!/usr/bin/env node
'use strict';
// The harness CLI. Every subcommand is a thin call into lib/ or guards/ — nothing lives only here.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CONFIG_PATH, load, get, findRoot, HarnessConfigMissing } = require('../lib/config');

const HERE = path.resolve(__dirname, '..');
const PKG = require('../package.json');
const HOME = os.homedir();
const HARNESS_HOME = path.join(HOME, '.harness');
const REPO = 'gunslingerOP/harness';
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? undefined : (rest[i + 1] ?? true); };
const has = (name) => rest.includes(`--${name}`);
const readJson = (f, fallback = {}) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(o, null, 2)}\n`); };
const sh = (c, opts = {}) => spawnSync(c, { shell: true, encoding: 'utf8', ...opts });
const die = (m) => { console.error(`harness: ${m}`); process.exit(1); };
const projectName = (root) => readJson(path.join(root, 'package.json'), {}).name?.replace(/^@[^/]+\//, '') ?? path.basename(root);

const TELEMETRY_ENV = readJson(path.join(HERE, 'adapters', 'claude-code', 'telemetry.json'));
const hookCmd = (script, base) => `node ${JSON.stringify(path.join(base, 'guards', script))}`;

/** Merge our hooks into a settings object without touching anything already there. */
function wireHooks(settings, base) {
  settings.hooks = settings.hooks ?? {};
  let added = 0;
  const want = {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCmd('banner.js', base) }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hookCmd('safety.js', base) }] }],
  };
  for (const [event, entries] of Object.entries(want)) {
    settings.hooks[event] = settings.hooks[event] ?? [];
    if (!JSON.stringify(settings.hooks[event]).includes('/harness/guards/')) { settings.hooks[event].push(...entries); added += 1; }
  }
  return added;
}

function mergeEnv(settings, extra) {
  settings.env = settings.env ?? {};
  let added = 0;
  for (const [k, v] of Object.entries(extra)) if (settings.env[k] === undefined) { settings.env[k] = v; added += 1; }
  return added;
}

// ───────────────────────── init (per project) ─────────────────────────
function init() {
  const root = findRoot();
  const name = projectName(root);
  const stack = flag('stack') ?? detectStack(root);
  const tpl = path.join(HERE, 'templates', `${stack}.json`);
  if (!fs.existsSync(tpl)) die(`no template for stack "${stack}"`);

  const cfgFile = path.join(root, CONFIG_PATH);
  if (fs.existsSync(cfgFile)) console.log(`keep   ${CONFIG_PATH}`);
  else { const c = readJson(tpl); c.harness.project = name; writeJson(cfgFile, c); console.log(`write  ${CONFIG_PATH}  (from templates/${stack}.json — EDIT IT: the config is the policy)`); }

  const settingsFile = path.join(root, '.claude', 'settings.json');
  const settings = readJson(settingsFile);
  const base = path.join(root, 'node_modules', '@gunslinger', 'harness');
  const h = wireHooks(settings, '"$CLAUDE_PROJECT_DIR"/node_modules/@gunslinger/harness');
  const e = mergeEnv(settings, { ...TELEMETRY_ENV, OTEL_RESOURCE_ATTRIBUTES: `project=${name}` });
  writeJson(settingsFile, settings);
  console.log(`wire   .claude/settings.json  (${h} hook events, ${e} telemetry vars — sessions here now emit to the register as project=${name})`);
  void base;

  // AGENTS.md is the agent-neutral instruction file; the fragment lives between markers so an
  // upgrade can replace it without touching the project's own text.
  const agents = path.join(root, 'AGENTS.md');
  const fragment = fs.readFileSync(path.join(HERE, 'instructions', 'AGENTS.harness.md'), 'utf8');
  let text = fs.existsSync(agents) ? fs.readFileSync(agents, 'utf8') : `# ${name} — agent instructions\n\n`;
  if (/<!-- harness:begin/.test(text)) text = text.replace(/<!-- harness:begin[\s\S]*?<!-- harness:end -->\n?/, fragment);
  else text = `${text.trimEnd()}\n\n${fragment}`;
  fs.writeFileSync(agents, text);
  console.log('write  AGENTS.md  (harness section between markers)');
  const claude = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claude) && !/^@AGENTS\.md\s*$/m.test(fs.readFileSync(claude, 'utf8'))) {
    fs.appendFileSync(claude, '\n@AGENTS.md\n');
    console.log('wire   CLAUDE.md  (@AGENTS.md import appended)');
  }

  const inbox = path.join(root, 'docs', 'harness-feedback.md');
  if (!fs.existsSync(inbox)) { fs.mkdirSync(path.dirname(inbox), { recursive: true }); fs.writeFileSync(inbox, '# Harness feedback\n\nOne line whenever the harness annoys you. `npx harness feedback "…"` writes here AND files it upstream.\n\n'); console.log('write  docs/harness-feedback.md'); }

  registerConsumer(name);
  console.log(`\nnext:  edit ${CONFIG_PATH} · add \`npx harness lint\` to pre-commit · npx harness test · npx harness doctor`);
}

function detectStack(root) {
  const h = (f) => fs.existsSync(path.join(root, f));
  if (h('app.json') && h('node_modules/expo')) return 'expo';
  if (['next.config.js', 'next.config.mjs', 'next.config.ts'].some(h)) return 'next';
  return 'node';
}

// ───────────────────────── install --global (per machine) ─────────────────────────
function installGlobal() {
  for (const d of ['bin', 'otel', 'register', 'git-hooks']) fs.mkdirSync(path.join(HARNESS_HOME, d), { recursive: true });
  const log = (k, v) => console.log(`${k.padEnd(7)}${v}`);

  // 1. the collector — one binary, one config, supervised by launchd
  const bin = path.join(HARNESS_HOME, 'bin', 'otelcol-contrib');
  if (!fs.existsSync(bin)) {
    const ver = flag('otel-version') ?? '0.160.0';
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const url = `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${ver}/otelcol-contrib_${ver}_darwin_${arch}.tar.gz`;
    log('fetch', `otelcol-contrib ${ver} (${arch})`);
    const r = sh(`cd "${path.dirname(bin)}" && curl -sSL -o otelcol.tgz "${url}" && tar -xzf otelcol.tgz otelcol-contrib && rm otelcol.tgz && chmod +x otelcol-contrib`);
    if (r.status !== 0) die(`collector download failed: ${r.stderr}`);
  } else log('keep', 'otelcol-contrib');
  const sub = (f) => fs.readFileSync(path.join(HERE, 'adapters', 'otel', f), 'utf8').replaceAll('__HOME__', HOME);
  fs.writeFileSync(path.join(HARNESS_HOME, 'otel', 'collector.yaml'), sub('collector.yaml'));
  const v = sh(`"${bin}" validate --config "${path.join(HARNESS_HOME, 'otel', 'collector.yaml')}"`);
  if (v.status !== 0) die(`collector config invalid:\n${v.stderr}`);
  log('write', '~/.harness/otel/collector.yaml (validated)');
  if (process.platform === 'darwin') {
    const plist = path.join(HOME, 'Library', 'LaunchAgents', 'dev.gunslinger.harness.otelcol.plist');
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, sub('launchd.plist'));
    sh(`launchctl unload "${plist}" 2>/dev/null; launchctl load -w "${plist}"`);
    log('start', 'launchd dev.gunslinger.harness.otelcol (127.0.0.1:4318 → ~/.harness/register/otel.jsonl)');
  } else log('skip', 'launchd (not macOS) — run the collector with your init system');

  // 2. every Claude Code session on this machine emits, and has the banner + safety hooks
  const userSettings = path.join(HOME, '.claude', 'settings.json');
  const s = readJson(userSettings);
  const h = wireHooks(s, HERE);
  const e = mergeEnv(s, TELEMETRY_ENV);
  writeJson(userSettings, s);
  log('wire', `~/.claude/settings.json (${h} hook events, ${e} telemetry vars)`);

  // 3. the reviewer and the output style travel with you
  for (const [src, dst] of [['agents/adversarial-reviewer.md', '.claude/agents/adversarial-reviewer.md'], ['output-styles/concise.md', '.claude/output-styles/concise.md']]) {
    const to = path.join(HOME, dst); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(HERE, src), to);
  }
  log('copy', '~/.claude/agents/adversarial-reviewer.md · ~/.claude/output-styles/concise.md');

  // 4. the safety floor in EVERY repo, including ones you do not own — global git hooks that chain
  //    to each repo's own hooks so simple-git-hooks / husky keep working. Bodies come from
  //    lib/git-hooks.js, which the suite tests by committing under a hooksPath — the first version
  //    resolved the local hook to ITSELF and hung every commit on the machine.
  const hooksDir = path.join(HARNESS_HOME, 'git-hooks');
  const { NAMES, hookBody } = require('../lib/git-hooks');
  for (const name of NAMES) {
    const f = path.join(hooksDir, name);
    fs.writeFileSync(f, hookBody(name, path.join(HERE, 'guards', 'push-guard.js')));
    fs.chmodSync(f, 0o755);
  }
  sh(`git config --global core.hooksPath "${hooksDir}"`);
  log('wire', 'git config --global core.hooksPath ~/.harness/git-hooks (chains to each repo\'s own hooks)');
  console.log('\ndone. `harness doctor` in any repo reports collector liveness and register freshness.');
}

// ───────────────────────── incidents · feedback · consumers (GitHub issues = the union) ─────────────────────────
function ghOk() { return sh('gh auth status').status === 0; }
function fileIssue(label, title, body) {
  if (!ghOk()) { console.error('harness: gh is not authenticated — recorded locally only'); return null; }
  const r = sh(`gh issue create --repo ${REPO} --label ${label} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`);
  return r.status === 0 ? r.stdout.trim() : (console.error(r.stderr), null);
}
function context(root) {
  const sha = sh('git rev-parse --short HEAD', { cwd: root }).stdout.trim() || '-';
  const branch = sh('git rev-parse --abbrev-ref HEAD', { cwd: root }).stdout.trim() || '-';
  return `project: ${projectName(root)} · ${branch}@${sha} · harness ${PKG.version} · ${new Date().toISOString().slice(0, 16)}`;
}
function record(label, text) {
  const root = findRoot();
  const line = `- ${new Date().toISOString().slice(0, 10)} · ${label} · ${text}`;
  const inbox = path.join(root, 'docs', 'harness-feedback.md');
  if (fs.existsSync(inbox)) fs.appendFileSync(inbox, `${line}\n`);
  const url = fileIssue(label, `${projectName(root)}: ${text.slice(0, 80)}`, `${text}\n\n---\n${context(root)}`);
  console.log(url ? `${label} filed: ${url}` : `${label} recorded in docs/harness-feedback.md`);
}
function registerConsumer(name) {
  if (!ghOk()) return;
  const existing = sh(`gh issue list --repo ${REPO} --label consumer --search ${JSON.stringify(`consumer: ${name} in:title`)} --state all --json number --jq '.[0].number'`).stdout.trim();
  const body = `${name} on harness ${PKG.version} — ${new Date().toISOString().slice(0, 10)}`;
  if (existing) sh(`gh issue comment ${existing} --repo ${REPO} --body ${JSON.stringify(body)}`);
  else fileIssue('consumer', `consumer: ${name}`, body);
  console.log(`note   registered as a consumer (${REPO} issue)`);
}

// ───────────────────────── doctor ─────────────────────────
function doctor() {
  const root = findRoot();
  const line = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); return ok; };
  console.log(`\nharness doctor — ${PKG.name}@${PKG.version} · ${projectName(root)}\n`);
  let ok = true;
  try { const { config } = load({ root }); line(true, `${CONFIG_PATH} valid (stack ${config.harness?.stack ?? '?'})`); }
  catch (e) { ok = line(false, e instanceof HarnessConfigMissing ? `no ${CONFIG_PATH} — run \`harness init\`` : e.message.split('\n')[0]) && ok; }
  const ps = readJson(path.join(root, '.claude', 'settings.json'));
  ok = line(JSON.stringify(ps.hooks ?? {}).includes('/harness/guards/'), 'project hooks wired') && ok;
  ok = line(ps.env?.CLAUDE_CODE_ENABLE_TELEMETRY === '1', 'telemetry env in project settings') && ok;
  const pre = path.join(root, '.git', 'hooks', 'pre-commit');
  const pkgScripts = readJson(path.join(root, 'package.json')).scripts ?? {};
  ok = line(Object.values(pkgScripts).some((s) => /harness lint/.test(s)) || (fs.existsSync(pre) && fs.readFileSync(pre, 'utf8').includes('harness')), 'placement guard reachable from pre-commit') && ok;
  const reg = path.join(HARNESS_HOME, 'register', 'otel.jsonl');
  // -x: exact process name. `pgrep -f` matched the shell running pgrep itself, so a runner with
  // no collector reported one — a false positive found by the CI dogfood job.
  const alive = sh('pgrep -x otelcol-contrib').status === 0;
  line(alive, alive ? 'collector running' : 'collector NOT running — `harness install --global`');
  const fresh = fs.existsSync(reg) && Date.now() - fs.statSync(reg).mtimeMs < 86400000;
  line(fresh, fresh ? `register written in the last 24h (${(fs.statSync(reg).size / 1048576).toFixed(1)} MB)` : 'register stale or empty');
  ok = line(fs.existsSync(path.join(root, 'AGENTS.md')) && fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('harness:begin'), 'AGENTS.md carries the harness section') && ok;
  const latest = ghOk() ? sh(`gh release view --repo ${REPO} --json tagName --jq .tagName`).stdout.trim().replace(/^v/, '') : '';
  if (latest) line(latest === PKG.version, latest === PKG.version ? `up to date (v${latest})` : `v${latest} available — installed ${PKG.version}: npm i -D github:${REPO}#v${latest}`);
  console.log('');
  process.exit(ok ? 0 : 1);
}

// ───────────────────────── retro ─────────────────────────
function retro() {
  const root = findRoot();
  const inbox = path.join(root, 'docs', 'harness-feedback.md');
  const reg = require('../guards/register');
  const evs = reg.load();
  const summary = evs.length ? reg.render(reg.summarise(evs, { days: 14 })) : '(register empty — collector not running?)';
  const issues = ghOk() ? sh(`gh issue list --repo ${REPO} --label incident,feedback --state open --json number,title,labels --jq '.[] | "#\\(.number) [\\(.labels[0].name)] \\(.title)"'`).stdout : '(gh unavailable)';
  const commits = sh('git log --since="14 days" --format="%h %s" -- .claude scripts .github', { cwd: root }).stdout;
  const guards = fs.readdirSync(path.join(HERE, 'guards')).map((f) => f.replace('.js', ''));
  console.log(`# Harness retro — ${new Date().toISOString().slice(0, 10)} — ${projectName(root)}

Propose AT MOST THREE changes, each tied to a line of evidence below. Proposals only — a human
approves. A fix lands as machinery (a guard, a lint, a config key), never as prose. Then name
ANY guard that earned nothing in the window — no denial, no incident, no inbox line — and
propose retiring it. Guards that only accrete become a bureaucracy.

## Register
${summary}

## Open incidents and feedback (${REPO})
${issues.trim() || '(none)'}

## Inbox (docs/harness-feedback.md)
${fs.existsSync(inbox) ? fs.readFileSync(inbox, 'utf8') : '(none)'}
## Harness-related commits, last 14 days
${commits.trim() || '(none)'}
## Guards in service
${guards.join(' · ')}

## Rules
- every proposed guard names the failure that justifies it and ships with fire, silent and fail-direction tests
- a guard the project cannot feed is worse than no guard
- retirement is a proposal like any other`);
}

// ───────────────────────── dispatch ─────────────────────────
const run = (script, args = []) => process.exit(spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: 'inherit' }).status ?? 1);
switch (cmd) {
  case 'init': init(); break;
  case 'install': has('global') ? installGlobal() : die('usage: harness install --global'); break;
  case 'lint': run('guards/repo-lint.js'); break;
  case 'safety': run('guards/safety.js'); break;
  case 'banner': run('guards/banner.js'); break;
  case 'register': run('guards/register.js', rest); break;
  case 'incident': rest[0] ? record('incident', rest.join(' ')) : die('usage: harness incident "<what happened>"'); break;
  case 'feedback': rest[0] ? record('feedback', rest.join(' ')) : die('usage: harness feedback "<one line>"'); break;
  case 'test': {
    const suite = path.join(HERE, 'test', 'harness-test.js');
    if (!fs.existsSync(suite)) die(`suite not found at ${suite} — this install is incomplete; reinstall the harness`);
    process.exit(spawnSync(process.execPath, ['--test', suite], { stdio: 'inherit' }).status ?? 1);
  }
  case 'doctor': doctor(); break;
  case 'retro': retro(); break;
  case 'review': process.stdout.write(fs.readFileSync(path.join(HERE, 'discipline', 'adversarial-reviewer.md'), 'utf8')); break;
  case 'config': { const key = rest[0]; if (!key) die('usage: harness config <dotted.key>'); try { const v = get(load().config, key); if (v === undefined) process.exit(1); console.log(typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { if (e instanceof HarnessConfigMissing) process.exit(1); die(e.message); } break; }
  case 'version': case '--version': case '-v': console.log(PKG.version); break;
  default:
    console.log(`harness ${PKG.version} — mechanism only; ${CONFIG_PATH} is the policy

  install --global      collector + register + global git safety + user-level hooks + reviewer (once per machine)
  init [--stack x]      config, hooks, telemetry, AGENTS.md section, inbox, consumer registration (once per project)
  doctor                is this project's and this machine's install healthy; is a newer version out
  test                  every guard fires, stays silent, fails the right way
  lint                  placement guard on staged files (pre-commit)             hygiene: fails OFF
  safety                PreToolUse guard, reads the tool call on stdin            safety:  fails CLOSED
  banner                SessionStart: identity, git truth, your status command
  register [--days=N]   what the register recorded: sessions, failures, guard fires, cost
  incident "…"          record a failure a guard should have caught → local inbox + ${REPO} issue
  feedback "…"          record an annoyance → local inbox + issue
  retro                 register + issues + inbox + commits → a proposals prompt (≤3 changes, retirements too)
  review                the six-attack adversarial discipline
  config <key>          read one value`);
}
