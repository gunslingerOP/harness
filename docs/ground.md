# `harness ground` — a plan is not done because it reads well

A deterministic check that a plan is grounded in the code, not in memory: every claim the plan
makes names the evidence for it — a file, an exact quote, optionally a line — and `ground` checks
every quote is really there before anyone spends a turn on the plan.

```
npx harness ground plan.json                # root defaults to cwd
npx harness ground plan.json --root ~/app    # evidence[].file resolves against this instead
```

## Why

Plans written from memory instead of from the code get sent back by reviewers — sometimes once,
sometimes twice — before they land. That is a human catching a machine-checkable problem the slow
way. `ground` is the fast way: it cannot tell you a plan is a GOOD plan, only that the plan is not
lying about what the code currently says.

## The schema

```json
{
  "claims": [
    {
      "claim": "the timer persists across an app restart",
      "evidence": [
        { "file": "src/domain/timer/machine.ts", "line": 42, "quote": "persistTimerState(ctx)" }
      ]
    }
  ]
}
```

- **`claim`** — a string naming what the plan asserts. Free text; it only labels the failure lines.
- **`evidence`** — one or more `{ file, line?, quote }`. Every claim needs at least one entry.
  - **`file`** — resolved against `--root` (default: the current directory).
  - **`quote`** — must appear **verbatim** in `file`, after trimming leading/trailing whitespace
    off the quote itself. Not fuzzy, not case-insensitive, not "close enough" — copy it from the
    real file.
  - **`line`** *(optional)* — if given, the quote's match must land within **3 lines** of it. Cheap
    insurance against a quote that is real but was pasted next to the wrong citation.

A simpler shape is also accepted for a plan that has not grouped its evidence into named claims:

```json
{ "evidence": [{ "file": "src/x.ts", "quote": "export function x()" }] }
```

Each top-level entry becomes its own claim (`evidence[0]`, `evidence[1]`, …) so the summary still
counts something meaningful.

## Output

One line per failing claim, naming the file and the quote that did not check out, then a summary:

```
ground: FAIL — "the timer persists across an app restart" — src/domain/timer/machine.ts: quote not found in src/domain/timer/machine.ts: "persistTimerState(ctx)"
ground: 3 claims, 2 grounded, 1 failed
```

Exit code **1** if anything failed, **0** if every claim grounded. Nothing is printed to stderr —
this is meant to be read, and grepped (`grep FAIL`), from stdout.

## The intended wiring

A planner's output schema should require `claims[].evidence[]` for anything it asserts about the
existing code — not "the timer already persists," but the file and line that prove it. The
executor's **first action**, before writing or changing anything, is:

```
harness ground plan.json
```

A plan that fails is returned to the planner before any code is written and before any reviewer is
spent verifying claims the plan itself got wrong. This does not replace review — it removes the
category of review finding that is "this citation is not real," which `ground` catches in
milliseconds instead of a round trip.

## What it does not do

It does not check that a claim's REASONING is sound, that the evidence actually SUPPORTS the
claim, or that the plan is complete. It checks exactly one thing: is this quote, from this file,
real. That is a small, boring, load-bearing thing for a machine to verify — which is why it is
worth having a machine verify it.
