'use strict';
// Reusable ESLint flat-config blocks, built from the project's harness.config.json `style` section.
// Usage in eslint.config.js:   ...require('@gunslinger/harness/eslint')()
//
// Born from: a design system that existed while every screen retyped hex values out of the
// canvas, because "use the tokens" was a sentence. A rule the model has to remember loses;
// a literal that cannot lint is unrepresentable.
const { load } = require('../lib/config');

module.exports = function harnessEslint(opts = {}) {
  const { config } = load(opts);
  const S = config.style;
  if (!S) return [];
  const blocks = [];

  if (S.literals) {
    const hint = S.literals.hint ? ` ${S.literals.hint}` : '';
    blocks.push({
      files: S.literals.globs,
      ignores: S.literals.allow_files ?? [],
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: `Raw hex colour.${hint}` },
          { selector: 'Literal[value=/^rgba?\\(/]', message: `Raw rgba colour.${hint}` },
          { selector: 'Property[key.name="fontSize"][value.type="Literal"]', message: `Literal fontSize — the type ramp is locked.${hint}` },
          { selector: 'Property[key.name="fontFamily"][value.type="Literal"]', message: `Literal fontFamily.${hint}` },
        ],
      },
    });
  }

  for (const p of S.pure ?? []) {
    blocks.push({
      files: p.globs,
      rules: { 'no-restricted-imports': ['error', { patterns: [{ group: p.forbid, message: p.message }] }] },
    });
  }
  return blocks;
};
