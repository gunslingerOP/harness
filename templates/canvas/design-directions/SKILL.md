---
name: design-directions
description: "Divergent design exploration grounded in YOUR app's own tokens and component manifest, implemented as real, swipeable variants in the app rather than a mockup image. Use when asked to explore directions, answer what should this screen look like, produce four directions, or run a divergent pass before building. Produces a spec and variants only — promoting the pick into real screen code is a separate, app-owned step."
---

# design-directions

> Ships with **no app content**. This skill is a generic template — before it is useful, fill in
> `<YOUR_DESIGN_SYSTEM_DOC>` and `<YOUR_COMPONENT_MANIFEST_DOC>` below with your own project's
> paths, and write your own `prompts/base-context.md` (your design system distilled: tokens,
> voice, product) the way `prompts/directions-guide.md` here already is generic. See
> `docs/canvas.md` in `@gunslinger/harness` for the full adoption steps.

A divergent step that widens the field before anyone writes a component — a structured spec to
reason about, then several real, running variants to swipe through on device and pick from.
**There is no external model call here.** The session itself is the generator: it writes the spec
by hand, following your own `prompts/base-context.md`, the same way it would reason about any
other design problem. No canvas, no image generation, no API key, no dependency.

## Workflow

1. **Write the brief for one screen** — what it is, what it must do, what state it's in.
2. **Read your own `prompts/base-context.md`** (your design system: tokens, voice, product) and
   `prompts/directions-guide.md` (how up to four structural directions hold apart from each
   other — what must vary, what must stay constant).
3. **Write the spec** to `.design-work/canvas/<screen>/spec.json`, obeying the schema in
   `lib/designSchema.mjs`: `concept` (overview, rationale — including which structural direction
   it argues for and why), `layout` (structure, hierarchy, what's above the fold), `components`
   (each with its token names, drawn only from `<YOUR_COMPONENT_MANIFEST_DOC>`), `colourUsage`,
   `interactions` (taps, transitions, haptics by name), `implementation` (a composition using only
   real components, its hierarchy, its props interface), and `copy` — every string on the screen,
   verbatim. Then validate:

   ```
   node .claude/skills/design-directions/lib/validate.mjs .design-work/canvas/<screen>/spec.json
   ```

   Fix and re-run until it prints `valid`. Do not move on with a spec the validator rejects.

4. **From the spec, implement the directions as real components** in your own variants registry
   (the app-owned module your `templates/canvas/route.tsx` copy imports — see `docs/canvas.md`):
   one module per screen, exporting a `Direction[]` — `{ id, label, Render }`, `Render` an actual
   component built from your own component library, not a description of one. Each direction from
   step 2/3 becomes one array entry. `Render()` owns its own background/atmosphere — the canvas
   package itself renders no app-specific ground.
5. **Swipe the variants on device** and answer through the comment bubble (long-press → note or
   pick); `harness canvas pull` pulls the picks and notes back out.
6. **The pick is promoted** into real screen code through your own project's usual build loop,
   unchanged from there on. This skill's job ends at the pick.

## The schema and the validator

`lib/designSchema.mjs` exports `DESIGN_SPEC_SCHEMA` (the shape above, as a plain JSON-schema-like
object) and `validateDesignSpec(spec)` (a hand-rolled structural check — no dependency, since a
schema this shaped doesn't need one). `lib/validate.mjs` is the CLI on top of it:

```
node lib/validate.mjs <spec.json>
```

Exit `0` and prints `valid` if the file matches the schema. Exit `1` otherwise — missing file,
invalid JSON, or a `$.path: reason` line per problem (missing required field, wrong type). No
network call, no API key, no `npm install` — the whole skill has zero dependencies.

## Prompts — the two files you write for your own project

- `prompts/base-context.md` — **you write this.** Your design system distilled from
  `<YOUR_DESIGN_SYSTEM_DOC>` and `<YOUR_COMPONENT_MANIFEST_DOC>`, plus your product and voice.
  Read before writing any spec; quote its token values exactly.
- `prompts/directions-guide.md` — ships generic, ready to use: the four structural directions (A
  mood/feeling first, B the commitment/contract as hero, C a receipt/list column, D the minimum)
  and what must vary versus stay constant between them. Rename the labels for your own screens if
  the illustrative four don't fit.
- `prompts/examples/` — **you write your own worked example(s)** here, the way a real app would
  (a brief for one real screen, ready to run through the full workflow above). None ships with
  this template — a worked example is app content by construction.

## Non-goals

- **No images, no external model.** The spec and the variants are written by the session that is
  already running this skill — there is nothing to call out to, and nothing to configure.
- **No canvas outside the app.** Every direction is a real component rendered inside your own app.
- **Does not pick a direction.** Several variants are not a vote — you look, on device, and decide.
- **Stops at the pick.** Writing your variants registry entries is in scope (step 4); promoting the
  winning direction into shipped screen code is your own project's job, not this skill's.
