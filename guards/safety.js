'use strict';
// SAFETY GUARD — a PreToolUse hook on Bash. SAFETY: fails CLOSED. Holding when everything else is
// broken is its entire job, so the FLOOR below is denied even when the config is missing or
// invalid. Exit 2 blocks the tool call and hands the reason back to the agent.
//
// Born from: the general truth that an agent will run `git reset --hard` to "clean up" and a
// `gh pr create` without --base will ship the wrong branch. Both are one keystroke and neither
// is recoverable.
//
// reads: safety.deny_patterns, repo.protected_branches, deploy.protected_stages
const { load, HarnessConfigMissing } = require('../lib/config');

/** Denied ALWAYS. Config can add to this list; nothing can remove from it. */
const FLOOR = [
  { re: /\bgit\s+push\b[^|;&]*\s(--force|-f)(\s|$)/, why: 'force push rewrites published history' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'reset --hard destroys uncommitted work' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: 'git clean -f deletes untracked files' },
  { re: /\bgit\s+push\b[^|;&]*--delete\b/, why: 'deletes a remote branch' },
  { re: /\bgit\s+push\b[^|;&]*\s:\S+/, why: 'deletes a remote branch (colon form)' },
  { re: /\bgit\s+branch\s+-D\b/, why: 'force-deletes a branch' },
  { re: /\bgit\s+checkout\s+--\s+\.(\s|$)/, why: 'discards every working-tree change' },
  { re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME)(\/?\s|\/?$)/, why: 'recursive delete of a root-like path' },
];

/** Pure: `{ deny, why, source }`. The hook and the tests both call this. */
function check(command, config) {
  for (const f of FLOOR) if (f.re.test(command)) return { deny: true, why: f.why, source: 'floor' };
  if (!config) return { deny: false };

  for (const p of config.safety.deny_patterns ?? []) {
    if (new RegExp(p).test(command)) return { deny: true, why: `matches safety.deny_patterns: ${p}`, source: 'config' };
  }
  for (const b of config.repo.protected_branches ?? []) {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bgit\\s+branch\\s+-[dD]\\s+${esc}\\b`).test(command)) return { deny: true, why: `"${b}" is a protected branch`, source: 'config' };
    if (new RegExp(`\\bgit\\s+push\\b[^|;&]*(--delete\\s+|:)${esc}\\b`).test(command)) return { deny: true, why: `"${b}" is a protected branch`, source: 'config' };
  }
  for (const s of config.deploy?.protected_stages ?? []) {
    const isDeploy = /\b(deploy|eas\s+(build|submit|update)|vercel|fly\s+deploy|wrangler\s+(deploy|publish)|firebase\s+deploy)\b/.test(command);
    if (isDeploy && new RegExp(`\\b${s}\\b`).test(command)) return { deny: true, why: `deploys to protected stage "${s}"`, source: 'config' };
  }
  return { deny: false };
}

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  let cmd = '';
  try {
    cmd = JSON.parse(raw).tool_input?.command ?? '';
  } catch {
    cmd = raw.trim();
  }
  if (!cmd) return;

  let config = null;
  try {
    config = load().config;
  } catch (e) {
    if (!(e instanceof HarnessConfigMissing)) console.error(`harness safety: config unreadable (${e.message.split('\n')[0]}) — running on the FLOOR only`);
  }
  const r = check(cmd, config);
  if (r.deny) {
    console.error(`harness safety: DENIED — ${r.why} [${r.source}]\n  command: ${cmd}`);
    process.exit(2);
  }
}

module.exports = { check, FLOOR };
if (require.main === module) main();
