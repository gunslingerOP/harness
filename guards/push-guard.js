'use strict';
// PUSH GUARD — the safety floor as a GIT pre-push hook, so it holds for every agent that pushes
// through git, not only the one whose PreToolUse hook we wired. Installed globally by
// `harness install --global` (core.hooksPath), it runs in every repo on the machine — including
// ones you do not own — with zero footprint in their tree. SAFETY: fails CLOSED.
//
// Born from: the PreToolUse safety guard only covering Claude Code. A Codex session, or a human
// in a hurry, could still delete or force-push main. The floor has to sit where git is.
//
// reads: repo.protected_branches
const { execFileSync } = require('node:child_process');
const { load, HarnessConfigMissing } = require('../lib/config');

const ZERO = '0'.repeat(40);
const FLOOR = ['main', 'master'];

function protectedBranches(config) {
  return [...new Set([...FLOOR, ...(config?.repo?.protected_branches ?? [])])];
}

function isAncestor(older, newer) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Pure over parsed ref lines: returns the refusals. `ancestor` is injectable for tests. */
function check(refs, config, ancestor = isAncestor) {
  const out = [];
  const guarded = protectedBranches(config);
  for (const r of refs) {
    const branch = r.remoteRef.replace(/^refs\/heads\//, '');
    if (!guarded.includes(branch)) continue;
    if (r.localSha === ZERO) out.push(`refusing to DELETE protected branch "${branch}"`);
    else if (r.remoteSha !== ZERO && !ancestor(r.remoteSha, r.localSha)) out.push(`refusing NON-FAST-FORWARD push to "${branch}" — it would rewrite published history`);
  }
  return out;
}

function parse(stdin) {
  return stdin
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [localRef, localSha, remoteRef, remoteSha] = l.trim().split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

function main() {
  let config = null;
  try {
    config = load().config;
  } catch (e) {
    if (!(e instanceof HarnessConfigMissing)) console.error('harness push-guard: config unreadable — running on the floor (main, master)');
  }
  const refs = parse(require('node:fs').readFileSync(0, 'utf8'));
  const refusals = check(refs, config);
  if (refusals.length) {
    console.error(`harness push-guard: DENIED\n${refusals.map((r) => `  ✗ ${r}`).join('\n')}`);
    process.exit(1);
  }
}

module.exports = { check, parse, protectedBranches, FLOOR };
if (require.main === module) main();
