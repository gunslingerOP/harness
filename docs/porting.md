# Porting the harness to a new project

Five minutes. The order matters — do not wire hooks before the suite is green.

```bash
npm i -D github:gunslingerOP/harness#v0.1.0
npx harness init --stack expo     # or next | node; omit to auto-detect
```

`init` writes `.claude/harness.config.json` from the stack template, merges the two hooks into
`.claude/settings.json` without touching anything already there, and creates the feedback inbox.

Then, in order:

1. **Edit the config.** `layout.top_dirs` and `layout.root_files` are your closed root — every
   directory and root file the repo legitimately has. Adding one later is a config edit in the same
   PR, and that edit is the decision. `layout.organized_dirs` names the trees that must not go flat.
2. **`npx harness test`** — expect passes. It proves every guard fires, stays silent, and fails in
   the right direction when the config is missing.
3. **Wire `harness lint` into pre-commit** (lint-staged, simple-git-hooks, husky — whichever the
   project has). `harness init` cannot do this safely for you because pre-commit setups differ.
4. **Optional, for a design-system app:** `...require('@gunslinger/harness/eslint')()` in
   `eslint.config.js` turns the `style` section into lint errors — raw colours and literal font
   sizes become unrepresentable outside your tokens file.
5. **`npx harness doctor`** whenever something feels off.

Upgrading a project is bumping the tag in `package.json`. The harness's own CI inits itself into a
fixture project on every push, so a release that breaks `init` cannot be tagged.

## What each project keeps for itself

Project-specific drift checks (a dependency pin that must not move, a generated diagram that must be
current) stay in the project — the harness is mechanism, and those are policy with code attached.
They can read the same config: `npx harness config repo.main_branch`.
