'use strict';
// THE THEME CONTRACT — canvas/*.js ships with zero app content, so every colour, font and size a
// component needs arrives on a `theme` prop instead of an import from the app's own tokens file.
// `defaultTheme` below is a concrete, sane-looking fallback (so the package renders something on
// its own, with zero app wiring) — never a value an adopting app should ship with. The real job of
// this file is the `Theme` typedef: the table an adopting app maps its own design tokens onto.
// docs/canvas.md carries the same table with DoMyBest's worked mapping as the example.
//
// @typedef {Object} Theme
// @property {string} accent       - dot fill (active), pin fill, Send/Update label colour
// @property {string} onAccent     - pin number text (sits on the accent fill)
// @property {string} surface      - comment bubble background
// @property {string} surfaceBorder - bubble border, pin border
// @property {string} divider      - hairline under the bubble's text input (distinct from
//                                    surfaceBorder in the worked example — do not collapse the two)
// @property {string} text         - input text colour
// @property {string} mutedText    - inactive dot, placeholder text, the 'picked' chip
// @property {string} [fontSans]        - bubble input text
// @property {string} [fontSansSemi]    - Send/Update label
// @property {string} [fontMono]        - Pick-letter label, pin number
// @property {number} captionSize  - px, input text + action label
// @property {number} chipSize     - px, pick label + pin number
// @property {(n: number) => number} space - all internal spacing
// @property {number} pillRadius   - the dots' border-radius
// @property {{shadowColor: string, shadowOpacity: number, shadowRadius: number, shadowOffset: {width: number, height: number}}} shadow
//   - RN-native shadow shape; bubble + pin drop shadow
//
// Deliberately NOT part of this contract: `ground`/atmosphere. VariantsScreen does not wrap
// directions in an app "Screen" background — each Direction's own `Render()` owns its background.
// That is app content, not mechanism.

/** @type {Theme} */
const defaultTheme = {
  accent: '#5B4FE8',
  onAccent: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceBorder: 'rgba(20,20,30,0.14)',
  divider: 'rgba(20,20,30,0.10)',
  text: '#16161F',
  mutedText: 'rgba(20,20,30,0.45)',
  fontSans: undefined,
  fontSansSemi: undefined,
  fontMono: undefined,
  captionSize: 15,
  chipSize: 15,
  space: (n) => n * 4,
  pillRadius: 999,
  shadow: {
    shadowColor: 'rgba(20,20,30,1)',
    shadowOpacity: 0.16,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 8 },
  },
};

module.exports = { defaultTheme };
