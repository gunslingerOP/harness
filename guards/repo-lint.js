'use strict';
// PLACEMENT GUARD — runs at pre-commit. HYGIENE: fails OFF when the config is missing.
//
// Born from: src/domain drifting to ten loose files, being fixed, and src/infrastructure/db then
// growing ten of its own because the first check guarded one directory. A rule that encodes the
// incident teaches nothing; this one reads the policy and applies it everywhere.
//
// Checks, all on STAGED files so untracked junk is never the question:
//   closed root     — a root file must be listed; a top-level dir must be listed
//   flat dumps      — no directory in an organized tree holds more than max_files sources
//   ASCII names     — non-ASCII filenames break tooling silently
//   tool artifacts  — .DS_Store, *.orig, editor swap files never get committed
//   docs with code  — optional: code changes must touch docs, or the skip marker exists
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, HarnessConfigMissing } = require('../lib/config');

const ARTIFACTS = [/(^|\/)\.DS_Store$/, /\.orig$/, /\.rej$/, /(^|\/)Thumbs\.db$/, /(^|\/)\.expo\//, /\.swp$/, /~$/, /(^|\/)npm-debug\.log/];

function stagedFiles(root) {
  try {
    // -z: NUL-separated, UNQUOTED paths. Without it git escapes non-ASCII names to pure-ASCII
    // octal ("caf\303\251.ts"), and the non-ASCII check can never fire. Found by the test suite.
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACR', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isSource(name, config) {
  const L = config.layout;
  return L.source_extensions.some((e) => name.endsWith(e)) && !L.test_markers.some((m) => name.includes(m)) && !name.endsWith('.d.ts');
}

function walkDirs(dir, fn) {
  fn(dir);
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkDirs(p, fn);
  }
}

/** Pure: takes the staged list, returns errors. The CLI and the tests both call this. */
function lint({ root, config, staged }) {
  const errors = [];
  const L = config.layout;

  for (const f of staged) {
    if (!/^[\x20-\x7e]+$/.test(f)) errors.push(`non-ASCII filename: ${f}`);
    if (ARTIFACTS.some((re) => re.test(f))) errors.push(`tool artifact staged: ${f}`);
    if (!f.includes('/')) {
      if (!L.root_files.includes(f)) errors.push(`closed root: "${f}" is not in layout.root_files — add it there if it belongs (that edit is the decision)`);
    } else {
      const top = f.split('/')[0];
      if (!L.top_dirs.includes(top)) errors.push(`closed root: directory "${top}/" is not in layout.top_dirs`);
    }
  }

  for (const od of L.organized_dirs) {
    const base = path.join(root, od.dir);
    if (!fs.existsSync(base)) continue;
    const exempt = od.exempt ?? [];
    walkDirs(base, (dir) => {
      const rel = path.relative(root, dir);
      if (exempt.some((e) => rel === e || rel.startsWith(`${e}/`))) return;
      const n = fs.readdirSync(dir).filter((x) => !fs.statSync(path.join(dir, x)).isDirectory() && isSource(x, config)).length;
      if (n > od.max_files) errors.push(`flat dump: ${rel}/ holds ${n} source files (max ${od.max_files}) — group them into subfolders`);
    });
  }

  const D = config.docs;
  if (D?.required_for_code) {
    const code = staged.some((f) => L.organized_dirs.some((od) => f.startsWith(`${od.dir}/`)) && isSource(f, config));
    const docs = staged.some((f) => D.doc_dirs.some((d) => f.startsWith(d)));
    const skip = fs.existsSync(path.join(root, D.skip_marker));
    if (code && !docs && !skip) errors.push(`code changed without docs — touch ${D.doc_dirs.join(' or ')}, or create ${D.skip_marker} for this commit`);
  }

  return { errors };
}

function main() {
  let loaded;
  try {
    loaded = load();
  } catch (e) {
    if (e instanceof HarnessConfigMissing) {
      // HYGIENE FAILS OFF, LOUDLY. A guard that lost its config must not hold the repo hostage.
      console.error(`harness lint: ${e.message}\n  HYGIENE GUARD OFF — nothing was checked. Run \`npx harness init\`.`);
      process.exit(0);
    }
    throw e;
  }
  const { config, root } = loaded;
  const { errors } = lint({ root, config, staged: stagedFiles(root) });
  if (errors.length) {
    console.error(`harness lint: refused\n${errors.map((e) => `  ✗ ${e}`).join('\n')}`);
    process.exit(1);
  }
}

module.exports = { lint, stagedFiles, ARTIFACTS, isSource };
if (require.main === module) main();
