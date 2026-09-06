'use strict';
// SESSION BANNER — a SessionStart hook. One line of git ground truth, then the project's own
// status command if it names one. Whatever this prints lands in the agent's context, so a fresh
// session opens knowing where it stands instead of reading a prose file that has gone stale.
// HYGIENE: fails OFF — no config means the git line alone.
//
// Born from: docs/HANDOFF.md going stale inside a single session and sending the next one to
// redo finished work. "Run the status command first" was prose in CLAUDE.md, and prose is skipped.
//
// reads: harness.project, harness.stack, session.banner_command
const { execFileSync, spawnSync } = require('node:child_process');
const { load, HarnessConfigMissing, findRoot } = require('../lib/config');

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gitLine(root) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '(no git)';
  const ab = git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  const [ahead, behind] = ab ? ab.split(/\s+/) : ['?', '?'];
  const dirty = git(root, ['status', '--porcelain']).split('\n').filter(Boolean).length;
  const last = git(root, ['log', '-1', '--format=%h %s (%cr)']);
  return `⎇ ${branch} ↑${ahead} ↓${behind} · ${dirty} dirty · ${last || 'no commits'}`;
}

function identity(root, config) {
  const pkg = require('../package.json');
  const name = config?.harness?.project || require('node:path').basename(root);
  const stack = config?.harness?.stack ?? 'no config';
  return `harness ${pkg.version} · ${name} · ${stack}`;
}

function main() {
  const root = findRoot();
  let config = null;
  try {
    config = load({ root }).config;
  } catch (e) {
    // identity still prints — a session in a repo with no config should know that too
    console.log(identity(root, null));
    console.log(gitLine(root));
    if (e instanceof HarnessConfigMissing) {
      console.log('harness: no config in this repo — run `npx harness init` to install the guards.');
      return;
    }
    console.log(`harness: config unreadable — ${e.message.split('\n')[0]}`);
    return;
  }
  console.log(identity(root, config));
  console.log(gitLine(root));
  const cmd = config.session?.banner_command;
  if (cmd) spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' });
}

module.exports = { gitLine, identity };
if (require.main === module) main();
