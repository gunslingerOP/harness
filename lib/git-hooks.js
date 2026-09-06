'use strict';
// The global git hooks `harness install --global` writes to ~/.harness/git-hooks. Each one runs
// the harness's own logic (pre-push only) and then CHAINS to the repo's local hook, so
// simple-git-hooks / husky / lint-staged keep working with core.hooksPath set.
//
// Born from: the first version resolving the local hook with `git rev-parse --git-path hooks`,
// which — with core.hooksPath set — returns the hooksPath ITSELF. The chain script exec'd itself
// forever and every `git commit` on the machine hung. `--git-common-dir` ignores hooksPath.
const NAMES = ['pre-commit', 'commit-msg', 'prepare-commit-msg', 'pre-push', 'post-checkout', 'post-merge', 'post-commit'];

function hookBody(name, pushGuardPath) {
  const chain = [
    `LOCAL="$(git rev-parse --git-common-dir)/hooks/${name}"`,
    // never exec ourselves, whatever git resolves to
    `if [ -x "$LOCAL" ] && ! [ "$LOCAL" -ef "$0" ]; then exec "$LOCAL" "$@"; fi`,
    'exit 0',
  ].join('\n');
  const head = `#!/bin/sh\n# harness global ${name} — written by \`harness install --global\`; chains to the repo's own hook.\n`;
  if (name === 'pre-push') return `${head}node ${JSON.stringify(pushGuardPath)} "$@" || exit $?\n${chain}\n`;
  return `${head}${chain}\n`;
}

module.exports = { NAMES, hookBody };
