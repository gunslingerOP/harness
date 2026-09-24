// Route template for `harness canvas pull`'s companion screen: /dev/variants/[screen] — several
// real-component directions for one screen, swiped in the real app. Copy this into your Expo
// Router tree (conventionally `src/app/dev/variants/[screen].tsx`) and edit the three things
// marked below. This route owns the kv write AND read — the way a *Container owns infrastructure
// for its *Screen — so your own dev/variants code can stay free of infrastructure imports, if you
// keep that convention.
//
// Generalised from a working app's own hand-rolled route (see docs/canvas.md). Everything RN/UI
// lives in the published `canvas/` package; this file is deliberately NOT part of it — a `.tsx`
// file with no build step would need YOUR project's own tsc/eslint/Metro to ever compile, and this
// one does, because it lives in your source tree, not in node_modules.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { VariantsScreen, type Direction, type FeedbackEntry } from '@gunslinger/harness/canvas';

// EDIT 1: your own registry — the screen -> directions lookup. This module stays in YOUR repo
// (it is app content: real components, real copy), typed against `Direction` from the package.
// See docs/canvas.md's install steps for what a registry entry looks like.
import { registry } from '../../../dev/variants/registry';

// EDIT 2: your own theme mapping — see docs/canvas.md's theme contract table for every field.
import { canvasTheme } from '../../../dev/variants/canvasTheme';

// EDIT 3: match this to `canvas.prefix` in your .claude/harness.config.json (default below).
const FEEDBACK_PREFIX = 'dev:feedback:';

/** Writes one row under `dev:feedback:<at>` — read back by `harness canvas pull`. If your project
 *  already has its own kv seam (the way a *Container narrows infrastructure), swap `Storage` here
 *  for that seam instead of talking to expo-sqlite/kv-store directly. */
function send(entry: FeedbackEntry): void {
  Storage.setItemSync(`${FEEDBACK_PREFIX}${entry.at}`, JSON.stringify(entry));
}

/** Every entry already recorded for `screen`, oldest first — the kv keys are ISO timestamps, so a
 *  plain string sort is chronological. This is how a pin (and a pick) survives an app relaunch:
 *  the screen replays its own history instead of starting blank. */
function readEntries(forScreen: string): FeedbackEntry[] {
  const keys = Storage.getAllKeysSync()
    .filter((key) => key.startsWith(FEEDBACK_PREFIX))
    .sort();
  const entries: FeedbackEntry[] = [];
  for (const key of keys) {
    const raw = Storage.getItemSync(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as FeedbackEntry;
      if (parsed.screen === forScreen) entries.push(parsed);
    } catch {
      // a corrupted row does not stop the screen from loading
    }
  }
  return entries;
}

export default function VariantsRoute() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  const entry = registry.find((r: { screen: string }) => r.screen === screen);
  const directions: Direction[] = entry?.directions ?? [];
  // Read once, at mount — this route remounts per `screen` (a different segment is a different
  // route match), so a lazy initializer keyed on first render is the whole story.
  const [initial] = useState(() => readEntries(screen ?? ''));
  return (
    <VariantsScreen screen={screen ?? ''} directions={directions} send={send} initial={initial} theme={canvasTheme} />
  );
}
