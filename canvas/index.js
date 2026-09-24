'use strict';
// THE CANVAS BARREL — `require('@gunslinger/harness/canvas')`. Everything a consuming app needs
// to replace its own hand-rolled variants tooling: the screen, the feedback hook, the pin
// component, the pure pin-replay logic, and a fallback theme. Mechanism only — zero app content.
// See docs/canvas.md for the full theme contract and the adoption steps.
//
// @typedef {import('./theme').Theme} Theme
// @typedef {import('./VariantsScreen').Direction} Direction
// @typedef {import('./pins').Pin} Pin
// @typedef {import('./pins').Proportion} Proportion
// @typedef {import('./pins').FeedbackEntry} FeedbackEntry
const { VariantsScreen } = require('./VariantsScreen');
const { useFeedbackLayer } = require('./FeedbackLayer');
const { CommentPin } = require('./CommentPin');
const { deriveInitial } = require('./pins');
const { defaultTheme } = require('./theme');

module.exports = { VariantsScreen, useFeedbackLayer, CommentPin, deriveInitial, defaultTheme };
