'use strict';
// THE COMMENT PIN — a Figma-style marker left at the point of a note. Filled at `theme.accent`
// with a `theme.surface`-coloured border and a drop shadow; three corners are fully rounded and
// the bottom-left is nearly square, so the shape points at the exact spot the comment was left.
// Tappable — reopens that comment for editing.
//
// Ported from domybest's src/dev/variants/CommentPin.tsx. The one substantive change: every token
// import (`depth[DEFAULT_DEPTH]`, `color.paper`, `font.mono`, `type.chip.size`, `shadow.paper`) is
// replaced by a field read off the `theme` prop — see canvas/theme.js for the full contract.
//
// Plain .js, not .tsx: this package ships no build step, so JSX here is transformed by the
// CONSUMING app's own Metro/Babel, the same way it already handles every other node_modules
// RN library. Peer deps: react, react-native, react-native-reanimated.
const React = require('react');
const { useEffect } = React;
const { Pressable, StyleSheet, Text } = require('react-native');
const Animated = require('react-native-reanimated').default;
const { useAnimatedStyle, useSharedValue, withTiming } = require('react-native-reanimated');
const { defaultTheme } = require('./theme');

const PIN_SIZE = 22;
const ROUND_CORNER = 11; // three corners, ~half the box — fully rounded
const SHARP_CORNER = 3; // the bottom-left corner — the point
const ENTER_MS = 180; // a freshly dropped pin scales in — that is the confirmation

/** `point` is the page-relative proportion the comment was left at; the sharp (bottom-left)
 *  corner is anchored exactly on it, the same way a map pin's point sits under its tip.
 *  @param {{ point: {x:number,y:number}, pageSize: {width:number,height:number}, number: number,
 *    onPress: () => void, theme?: import('./theme').Theme }} props */
function CommentPin({ point, pageSize, number, onPress, theme = defaultTheme }) {
  const scale = useSharedValue(0.6);
  useEffect(() => {
    scale.value = withTiming(1, { duration: ENTER_MS });
  }, [scale]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const pos = {
    left: point.x * pageSize.width,
    top: point.y * pageSize.height - PIN_SIZE,
  };

  const s = makeStyles(theme);

  return (
    <Animated.View style={[s.pin, pos, animStyle]}>
      <Pressable
        onPress={onPress}
        hitSlop={8}
        style={s.hit}
        accessibilityRole="button"
        accessibilityLabel={`Comment ${number}`}
        testID={`canvas-pin-${number}`}
      >
        <Text style={s.number}>{number}</Text>
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    pin: {
      position: 'absolute',
      width: PIN_SIZE,
      height: PIN_SIZE,
      backgroundColor: theme.accent,
      borderWidth: 1,
      borderColor: theme.surface,
      borderTopLeftRadius: ROUND_CORNER,
      borderTopRightRadius: ROUND_CORNER,
      borderBottomRightRadius: ROUND_CORNER,
      borderBottomLeftRadius: SHARP_CORNER,
      ...theme.shadow,
    },
    hit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    number: { fontFamily: theme.fontMono, fontSize: theme.chipSize, color: theme.onAccent },
  });
}

module.exports = { CommentPin };
