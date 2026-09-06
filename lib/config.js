'use strict';
// THE ONE CONFIG READER. Every guard reads through here and carries no defaults of its own —
// the project's .claude/harness.config.json is the policy, and editing it IS the decision.
//
// Fail direction is decided by the CALLER, not here: this throws HarnessConfigMissing and each
// guard chooses. Hygiene guards catch it and go quiet, loudly. Safety guards catch it and keep
// refusing on their hardcoded floor. See test/harness-test.js for the assertions of both.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join('.claude', 'harness.config.json');

class HarnessConfigMissing extends Error {
  constructor(root) {
    super(`no ${CONFIG_PATH} under ${root}`);
    this.name = 'HarnessConfigMissing';
    this.root = root;
  }
}

/** Walk up to the nearest directory holding .git or the config. */
function findRoot(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, CONFIG_PATH))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}

// Required keys per section. A config that lacks one is invalid, not defaulted.
const REQUIRED = {
  repo: ['main_branch', 'protected_branches'],
  layout: ['top_dirs', 'root_files', 'organized_dirs', 'source_extensions', 'test_markers'],
  safety: ['deny_patterns'],
};

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['config is not an object'];
  for (const [section, keys] of Object.entries(REQUIRED)) {
    if (!config[section] || typeof config[section] !== 'object') {
      errors.push(`missing section "${section}"`);
      continue;
    }
    for (const k of keys) if (!(k in config[section])) errors.push(`missing "${section}.${k}"`);
  }
  for (const od of config.layout?.organized_dirs ?? []) {
    if (!od.dir) errors.push('layout.organized_dirs entry without "dir"');
    if (typeof od.max_files !== 'number') errors.push(`layout.organized_dirs[${od.dir}] needs numeric "max_files"`);
  }
  return errors;
}

function load(opts = {}) {
  const root = opts.root ?? findRoot();
  const file = path.join(root, CONFIG_PATH);
  if (!fs.existsSync(file)) throw new HarnessConfigMissing(root);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${CONFIG_PATH} is not valid JSON: ${e.message}`);
  }
  const errors = validate(config);
  if (errors.length) throw new Error(`${CONFIG_PATH} is invalid:\n  - ${errors.join('\n  - ')}`);
  return { config, root, file };
}

/** `get(config, 'session.banner_command')` — dotted lookup, undefined when absent. */
function get(config, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), config);
}

module.exports = { CONFIG_PATH, HarnessConfigMissing, findRoot, load, validate, get };
