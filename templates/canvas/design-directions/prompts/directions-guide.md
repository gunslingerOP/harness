# Direction discipline

How to phrase and hold apart the (up to) four structural directions a design-directions spec
explores. Read alongside your own `prompts/base-context.md`, which carries your tokens and voice —
this file is only about what makes four directions usefully different from each other, rather than
four costumes on one idea.

## The four structural directions

Each direction is a genuinely different structural decision — a different thing leading the frame —
never a palette swap or a copy edit on the same layout. Four shapes that recur across most apps'
screens (write the real ones per screen; these are illustrative, not fixed):

- **A — mood or feeling first.** The emotional or atmospheric read leads; data and controls follow.
- **B — the contract or commitment as hero.** The thing the user is accountable to fills the frame.
- **C — a receipt or list column.** Information reads top to bottom, as a ledger or a log.
- **D — the minimum.** The fewest elements that still answer the screen's one job.

A screen with no contract, no receipt, or no clear mood has no business forcing these four labels —
give it its own four, named for what actually leads each one.

## What must vary between directions

- **What leads.** The element that reads first changes — mood, commitment, a list, or nothing
  extra at all. If two directions share a leading element, they are not two directions.
- **The layout skeleton** (`layout.structure`, `layout.hierarchy`, `layout.whatIsAboveTheFold`) —
  region order, what sits above the fold, how much is on screen at once.
- **Which components carry the weight.** A mood-first direction might lean on an atmosphere or
  instrument-style component; a receipt direction leans on a row/list component; the minimum
  direction uses the fewest components that still answer the screen's one job.

## What must stay constant across all of them

- **The token set.** Every direction is still built only from your own `prompts/base-context.md`'s
  tokens — the same colours, the same type ramp, the same spacing scale. A direction is a
  different structure, never a different palette.
- **The voice and the copy's substance.** Layout can differ; what the copy says, and the voice
  rules it obeys, do not change between directions.
- **One job per screen.** Every direction answers the same single job; none of them may smuggle in
  extra content just to look fuller.
- **Only real components.** Every direction's `implementation.sketch` uses only names from your own
  component manifest (see `base-context.md` § Components available) — a direction that needs
  something new describes it in `components[]` rather than inventing markup in the sketch.
