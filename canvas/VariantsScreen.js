'use strict';
// THE VARIANTS SCREEN — several real-component directions for one screen, swiped in the real app,
// with a comment bubble (FeedbackLayer.js) for picks and notes that reach the planning session as
// a file (via `harness canvas pull`). Several sketches side by side instead of one at a time,
// judged where the app's own owner already is instead of over a session's shoulder.
//
// Ported from domybest's src/dev/variants/VariantsScreen.tsx, with ONE structural change from the
// original, both required because atmosphere/backgrounds are app content, not mechanism:
//   - No `registry` import and no `screen`-keyed lookup. This component takes `directions`
//     directly, already resolved — the consuming app's own registry (which stays app-side, see
//     docs/canvas.md) does the lookup and passes the array in.
//   - No `Screen`/`GroundKind`/`ground` wrapping. Each `Direction.Render()` now owns its own
//     background; VariantsScreen no longer wraps a page in an app atmosphere component.
// `Caption`/`Chip` (this app's own Typography primitives) are replaced by two small internal
// <Text> wrappers styled from `theme`. Token reads (`depth[DEFAULT_DEPTH]`, `ink('leader')`,
// `radius.pill`, `space()`) are replaced by `theme` fields.
//
// Pure of any app's storage layer, deliberately: `send` is owned by the caller (the route
// template in templates/canvas/route.tsx), the same shape every *Container in a well-factored app
// already uses. This file only calls it.
//
// @typedef {Object} Direction
// @property {string} id
// @property {string} label - shown next to the dots; what this direction IS, not a verdict on it
// @property {() => import('react').ReactElement} Render - owns its own background
//
// Peer deps: react, react-native, react-native-safe-area-context.
const React = require('react');
const { useRef, useState } = React;
const { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } = require('react-native');
const { useSafeAreaInsets } = require('react-native-safe-area-context');
const { useFeedbackLayer } = require('./FeedbackLayer');
const { defaultTheme } = require('./theme');

const DOT_SIZE = 6;
const DOT_GAP = 6;
const DOT_HIT_SLOP = 14;

/** Small internal replacement for this app's own `Caption` — styled entirely from `theme`. */
function CanvasCaption({ children, theme }) {
  return <Text style={{ fontFamily: theme.fontSans, fontSize: theme.captionSize, color: theme.mutedText }}>{children}</Text>;
}

/** Small internal replacement for this app's own `Chip` (tone="muted") — the 'picked' badge. */
function CanvasChip({ children, theme }) {
  return (
    <View
      style={{
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1),
        borderRadius: theme.pillRadius,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.surfaceBorder,
      }}
    >
      <Text style={{ fontFamily: theme.fontMono, fontSize: theme.chipSize, color: theme.mutedText }}>{children}</Text>
    </View>
  );
}

/** @param {{
 *   screen: string,
 *   directions: Direction[],
 *   send: (entry: import('./pins').FeedbackEntry) => void,
 *   initial?: import('./pins').FeedbackEntry[],
 *   theme?: import('./theme').Theme,
 * }} props */
function VariantsScreen({ screen, directions = [], send, initial = [], theme = defaultTheme }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef(null);
  const [index, setIndex] = useState(0);

  const current = directions[index] ?? directions[0];
  // Status bar + the dots row + a little air, so a page's content starts clear of them.
  const topClearance = 8 + 6 + theme.space(4);

  // Called unconditionally, before the early return below, so hook order never changes: with no
  // registered direction there is nothing for the overlay to attach to, but the hook still runs.
  const { longPressProps, overlay, picked } = useFeedbackLayer(
    screen,
    current?.id ?? 'A',
    { width, height },
    insets,
    send,
    initial,
    theme,
  );

  if (!current) {
    return (
      <View style={[s.root, { paddingTop: insets.top + theme.space(5) }]}>
        <CanvasCaption theme={theme}>{`No directions registered for "${screen}".`}</CanvasCaption>
      </View>
    );
  }

  const goTo = (i) => {
    setIndex(i);
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  };

  const s = makeStyles();

  return (
    <View style={s.root}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={s.pager}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
      >
        {directions.map((direction) => (
          <Pressable key={direction.id} style={{ width, height }} onLongPress={longPressProps.onLongPress} delayLongPress={250}>
            <View style={[s.page, { paddingTop: insets.top + topClearance }]}>
              <direction.Render />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.dots, { top: insets.top + 8 }]} pointerEvents="box-none">
        {directions.map((d, i) => (
          <Pressable
            key={d.id}
            onPress={() => goTo(i)}
            hitSlop={DOT_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Direction ${d.id}: ${d.label}`}
            testID={`canvas-dot-${d.id}`}
          >
            <View style={[s.dot, { backgroundColor: i === index ? theme.accent : theme.mutedText, borderRadius: theme.pillRadius }]} />
          </Pressable>
        ))}
        {picked.includes(current.id) ? <CanvasChip theme={theme}>picked</CanvasChip> : null}
      </View>

      {overlay}
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    root: { flex: 1 },
    pager: { flex: 1 },
    page: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 },
    dots: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: DOT_GAP,
    },
    dot: { width: DOT_SIZE, height: DOT_SIZE },
  });
}

module.exports = { VariantsScreen };
