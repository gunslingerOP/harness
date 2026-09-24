# canvas — on-device design review, packaged

What a design-review loop looks like without a picture board: several real *directions* of one
screen, built from the app's own components on the app's own ground, swiped on the simulator or a
real device. Long-press drops a numbered comment; `Pick <letter>` records a choice. `harness canvas
pull` copies the feedback off the device into a plain `.jsonl` file. No external model, no canvas
outside the app.

Born from an app repo's own hand-rolled version of this (issue #6) — `canvas` is that mechanism,
generalised: zero app content ships in this package. Every colour, font and size a component needs
arrives on a `theme` prop instead of an import from your app's tokens.

## What ships

- **`canvas/`** — the RN package. `require('@gunslinger/harness/canvas')` gives you
  `VariantsScreen`, `useFeedbackLayer`, `CommentPin`, `deriveInitial` (the pure pin-replay logic),
  and `defaultTheme` (a concrete fallback so the package renders something with zero app wiring).
- **`harness canvas pull`** — the puller. Bundle id from your `app.json`, key prefix from your own
  `.claude/harness.config.json` (or the built-in default), iOS **and** Android.
- **`templates/canvas/route.tsx`** — a copy-in-app-source route for Expo Router.
- **`templates/canvas/design-directions/`** — a copy-in skill: the spec schema, the validator, and
  the direction-discipline guide. You write your own `prompts/base-context.md` (your design
  system, your product, your voice) — that part is deliberately app content and does not ship.

## The theme contract

Every `canvas/*.js` component takes an optional `theme` prop (default: `canvas/theme.js`'s
`defaultTheme`). The table below is the contract, with one app's actual v9-palette mapping shown as
a worked example of what filling it in looks like — your own values will differ.

| theme field | type | used for | worked example |
| --- | --- | --- | --- |
| `accent` | color string | dot fill (active), pin fill, Send/Update label colour | `depth[DEFAULT_DEPTH]` |
| `onAccent` | color string | pin number text (sits on the accent fill) | `color.paper` |
| `surface` | color string | comment bubble background | `color.paper` |
| `surfaceBorder` | color string | bubble border, pin border | `color.cardBorder` |
| `divider` | color string | hairline under the bubble's text input — distinct from `surfaceBorder` in the worked example; do not collapse the two | `color.hairline` |
| `text` | color string | input text colour | `color.ink` |
| `mutedText` | color string | inactive dot, placeholder text, the 'picked' chip | `ink('disabledInk')` |
| `fontSans` | string or undefined | bubble input text | `font.sans` |
| `fontSansSemi` | string or undefined | Send/Update label | `font.sansSemi` |
| `fontMono` | string or undefined | Pick-letter label, pin number | `font.mono` |
| `captionSize` | number (px) | input text, action label | `type.caption.size` |
| `chipSize` | number (px) | pick label, pin number | `type.chip.size` |
| `space` | `(n: number) => number` | all internal spacing | `space` = `n => n * 4` |
| `pillRadius` | number | the dots' border-radius | `radius.pill` |
| `shadow` | RN shadow shape (`shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset: {width, height}`) | bubble + pin drop shadow | `shadow.paper` |

**Deliberately not part of the contract:** `ground`/atmosphere. `VariantsScreen` does not wrap a
direction in an app-specific background component — each `Direction.Render()` owns its own
background. That is the one behavioural change from a hand-rolled version built straight into an
app, and it exists because atmosphere is app content, not mechanism.

## Install

1. `npm i -D github:gunslingerOP/harness#<tag>`
2. Install whatever peer deps you don't already have:
   `react`, `react-native`, `react-native-reanimated`, `react-native-safe-area-context`,
   `expo-haptics`, `better-sqlite3` (only `better-sqlite3` is needed for the CLI puller, not the
   in-app package).
3. `npx harness init --stack expo` (idempotent) — writes `canvas.enabled: false` into
   `.claude/harness.config.json` if that key is missing; leaves an already-present config alone.
   Flip `canvas.enabled` to `true` and set `canvas.prefix` / `canvas.database` / `canvas.output_dir`
   if the defaults (below) don't fit:
   ```json
   "canvas": { "enabled": false, "prefix": "dev:feedback:", "database": "ExpoSQLiteStorage", "output_dir": ".design-work/feedback" }
   ```
4. Copy `node_modules/@gunslinger/harness/templates/canvas/route.tsx` into your Expo Router tree
   (conventionally `src/app/dev/variants/[screen].tsx`), and edit the three spots it marks: your
   own registry import, your own theme object, and the feedback-key prefix.
5. Write your own variants registry (`Direction[]` per screen — `{ id, label, Render }`), and a
   small `theme` object mapping your own tokens per the table above.
6. Copy `templates/canvas/design-directions/` over `.claude/skills/design-directions/` and write
   your own `prompts/base-context.md` (your design system, product and voice) plus at least one
   `prompts/examples/` brief.
7. `npx harness canvas pull` — auto-detects a booted iOS simulator or a connected Android device.

## `harness canvas pull`

```
harness canvas pull [--platform ios|android] [--all] [--prefix P] [--db NAME] [--dir DIR]
```

- `--platform` — else auto-detects: exactly one of {a booted iOS simulator, a connected Android
  device} present picks it; both or neither is an error asking for the flag.
- `--all` — reprint full history (ignores the cursor); appending to the `.jsonl` stays deduped by
  `at` regardless, so `--all` never duplicates a line.
- `--prefix`, `--db`, `--dir` — default from `.claude/harness.config.json`'s `harness.canvas`
  section, else the built-in defaults above, so the command works with zero config.
- `SIM_UDID` (iOS) / `ANDROID_SERIAL` (Android) — pin a specific device when more than one is
  present, the way each platform's own tooling does.

### The on-device paths, cited from expo-sqlite's own source

The file pulled is **not** your app's own database — the canvas route writes through
`expo-sqlite/kv-store`'s default instance (`new SQLiteStorage('ExpoSQLiteStorage')`,
`node_modules/expo-sqlite/src/Storage.ts`), a separate SQLite file. Both platforms' paths below
were read out of expo-sqlite's own source, not assumed — if a future expo-sqlite version moves
either one, that is a doc/code co-change here, not a guess to make again.

- **iOS**: `<container>/Documents/SQLite/<db>[,-wal,-shm]` — `ios/SQLiteModule.swift`'s
  `defaultDatabaseDirectory`, `documentDirectory/SQLite`. Container resolved via
  `xcrun simctl get_app_container <SIM_UDID|booted> <bundleId> data`.
- **Android**: `<app's internal files dir>/SQLite/<db>[,-wal,-shm]` — **not** Documents, unlike
  iOS — `android/.../SQLiteModule.kt` line 36: `context.filesDir.canonicalPath + File.separator +
  "SQLite"`. Pulled via `adb -s <serial> exec-out run-as <package> cat files/SQLite/<db>`.

Both live under the on-device copy only — the live file is never opened directly; it is copied out
(WAL/SHM sidecars included, so a row written seconds ago and not yet checkpointed is not missed)
and read read-only.

### Android specifics

`run-as` requires a **debuggable** build (dev/internal, not a release build) — the same limitation
the iOS path already has implicitly (`simctl` only ever targets simulators, never a release build
either). Most Expo-managed apps have no `expo.android.package` set in `app.json` until their first
native/EAS build; `harness canvas pull --platform android` fails immediately and correctly on a
fresh project, with a message that says so — expected, not a bug.

**Not implemented, documented as the fallback if the direct path ever corrupts a pull:**
`adb shell run-as <package> cat <path>` piped through `adb pull`, instead of `adb exec-out`.
`exec-out` is the more direct binary-safe transport and is what ships; if a real Android pull ever
shows truncated or corrupted output, switch to the `shell` + `pull` two-step here before relying on
Android pulls in production use.

## The one open question this does not resolve

Pin coordinates are `pageX/pageY` as a **proportion of the window** (0–1), so a point means the
same thing on any device size. That assumption breaks inside a page with its own scroll view — a
pin's proportion is only stable against the full page, not a scrolled sub-region. This ships
unchanged from the mechanism it was generalised from; fixing it (a different coordinate contract,
or capturing scroll offset alongside the proportion) is future work, not solved here.
