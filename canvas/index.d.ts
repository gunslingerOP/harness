// THE CANVAS BARREL — TYPES. Hand-written, not generated: `canvas/` ships plain CommonJS `.js`
// with JSDoc-only typedefs and no build step, so an adopting app's own `tsc` never sees them.
// This file is the contract those apps compile against — it must stay in sync with the JSDoc in
// canvas/pins.js, canvas/theme.js, canvas/CommentPin.js, canvas/FeedbackLayer.js and
// canvas/VariantsScreen.js by hand. Co-located with canvas/index.js so both "bundler" and
// "node16"/"nodenext" moduleResolution pick it up for `require('@gunslinger/harness/canvas')` /
// `import … from '@gunslinger/harness/canvas'` without an `exports` map or a `types` field in
// package.json — plain directory-index resolution, the same fallback classic Node resolution uses.
//
// Born from: templates/canvas/route.tsx imports `Direction` and `FeedbackEntry` as TS types from
// this subpath; without this file an adopting Expo app's `tsc` (moduleResolution "bundler",
// allowJs true) fails with "has no exported member" on both.

import type { ReactElement } from 'react';
import type { GestureResponderEvent } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

// ───────────────────────── canvas/pins.js ─────────────────────────

/** A point on a page, as a proportion (0–1) of the page's own box — stable across device sizes. */
export interface Proportion {
  x: number;
  y: number;
}

/** A numbered comment marker, replayed from a screen's saved FeedbackEntry rows. */
export interface Pin {
  id: string;
  variant: string;
  point: Proportion;
  note: string;
  number: number;
}

/** Written by `useFeedbackLayer`'s `onPick` — a choice, not a mark on the page. No `note`, no
 *  `pin`, no `x`/`y`. */
export interface FeedbackPickEntry {
  screen: string;
  variant: string;
  kind: 'pick';
  at: string; // ISO timestamp
}

/** Written by `useFeedbackLayer`'s `onSubmit` — a note dropped (or edited) at a point. `pin`
 *  carries the pin id (new on first send, the same id again on an edit); `x`/`y` are optional in
 *  the wire shape because `deriveInitial` tolerates a missing pair (`e.x ?? 0`), even though the
 *  current writer (FeedbackLayer.js) always sends both. */
export interface FeedbackNoteEntry {
  screen: string;
  variant: string;
  kind: 'note';
  note: string;
  pin: string;
  x?: number;
  y?: number;
  at: string; // ISO timestamp
}

/** The append-only wire shape `send` is called with and `initial` is seeded from — one of the two
 *  variants above, discriminated on `kind`. */
export type FeedbackEntry = FeedbackPickEntry | FeedbackNoteEntry;

/** Replays a screen's saved entries into pin state: latest note per pin id wins, numbered per
 *  variant in first-seen order. Entries without a `pin` are ignored for pins, but a 'pick' still
 *  counts toward `picked`. */
export declare function deriveInitial(entries: FeedbackEntry[]): { pins: Pin[]; picked: string[] };

// ───────────────────────── canvas/theme.js ─────────────────────────

/** RN-native shadow shape; bubble + pin drop shadow. */
export interface ThemeShadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
}

/** The table every `canvas/*.js` component reads instead of an app tokens import — full contract
 *  and worked example in docs/canvas.md. Deliberately excludes `ground`/atmosphere: each
 *  `Direction.Render()` owns its own background, that is app content. */
export interface Theme {
  accent: string; // dot fill (active), pin fill, Send/Update label colour
  onAccent: string; // pin number text (sits on the accent fill)
  surface: string; // comment bubble background
  surfaceBorder: string; // bubble border, pin border
  divider: string; // hairline under the bubble's text input — distinct from surfaceBorder
  text: string; // input text colour
  mutedText: string; // inactive dot, placeholder text, the 'picked' chip
  fontSans?: string; // bubble input text
  fontSansSemi?: string; // Send/Update label
  fontMono?: string; // Pick-letter label, pin number
  captionSize: number; // px, input text + action label
  chipSize: number; // px, pick label + pin number
  space: (n: number) => number; // all internal spacing
  pillRadius: number; // the dots' border-radius
  shadow: ThemeShadow;
}

/** Concrete, sane-looking fallback so the package renders something with zero app wiring — never
 *  a value an adopting app should ship with. */
export declare const defaultTheme: Theme;

// ───────────────────────── canvas/CommentPin.js ─────────────────────────

export interface PageSize {
  width: number;
  height: number;
}

export interface CommentPinProps {
  point: Proportion;
  pageSize: PageSize;
  number: number;
  onPress: () => void;
  theme?: Theme;
}

/** A Figma-style marker left at the point of a note; tappable to reopen that comment for editing. */
export declare function CommentPin(props: CommentPinProps): ReactElement;

// ───────────────────────── canvas/FeedbackLayer.js ─────────────────────────

/** Everything the comment bubble and its pins need. Returns the long-press props to spread onto
 *  a page's wrapping Pressable, the overlay to render once (pins + the open bubble, if any), and
 *  which variants have been picked. */
export declare function useFeedbackLayer(
  screen: string,
  variant: string,
  pageSize: PageSize,
  insets: EdgeInsets,
  send: (entry: FeedbackEntry) => void,
  initial: FeedbackEntry[],
  theme?: Theme,
): {
  longPressProps: { onLongPress: (event: GestureResponderEvent) => void };
  overlay: ReactElement;
  picked: string[];
};

// ───────────────────────── canvas/VariantsScreen.js ─────────────────────────

/** One real-component direction for a screen. `label` names what the direction IS, not a verdict
 *  on it; `Render` owns its own background. */
export interface Direction {
  id: string;
  label: string;
  Render: () => ReactElement;
}

export interface VariantsScreenProps {
  screen: string;
  directions?: Direction[];
  send: (entry: FeedbackEntry) => void;
  initial?: FeedbackEntry[];
  theme?: Theme;
}

/** Several real-component directions for one screen, swiped in the real app, with a comment
 *  bubble for picks and notes. */
export declare function VariantsScreen(props: VariantsScreenProps): ReactElement;
