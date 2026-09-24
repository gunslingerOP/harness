'use strict';
// PIN DERIVATION — pure logic, no React: replay a screen's saved feedback entries into pin state
// so pins and picks survive a reload instead of vanishing every relaunch. Ported verbatim from
// domybest's src/dev/variants/pins.ts (mechanism only — nothing app-specific in here to begin
// with). The one pure file in this package a plain `node:test` can exercise directly — see
// test/canvas-test.js.
//
// @typedef {Object} Proportion
// @property {number} x
// @property {number} y
//
// @typedef {Object} Pin
// @property {string} id
// @property {string} variant
// @property {Proportion} point
// @property {string} note
// @property {number} number
//
// @typedef {Object} FeedbackEntry
// @property {string} screen
// @property {string} variant
// @property {'pick'|'note'} kind
// @property {string} [note]
// @property {string} [pin]
// @property {number} [x]
// @property {number} [y]
// @property {string} at - ISO timestamp

/** Replays a screen's saved entries into pin state: latest note per pin id wins, numbered per
 *  variant in first-seen order. Entries without a `pin` are ignored for pins, but a 'pick' still
 *  counts toward `picked`.
 *  @param {FeedbackEntry[]} entries
 *  @returns {{ pins: Pin[], picked: string[] }} */
function deriveInitial(entries) {
  const sorted = [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const byPinId = new Map();
  const counts = {};
  const picked = new Set();
  for (const e of sorted) {
    if (e.kind === 'pick') {
      picked.add(e.variant);
      continue;
    }
    if (typeof e.pin !== 'string' || !e.pin) continue;
    const existing = byPinId.get(e.pin);
    if (existing) {
      existing.note = e.note;
      continue;
    }
    const number = (counts[e.variant] ?? 0) + 1;
    counts[e.variant] = number;
    byPinId.set(e.pin, {
      id: e.pin,
      variant: e.variant,
      point: { x: e.x ?? 0, y: e.y ?? 0 },
      note: e.note,
      number,
    });
  }
  return { pins: [...byPinId.values()], picked: [...picked] };
}

module.exports = { deriveInitial };
