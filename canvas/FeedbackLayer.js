'use strict';
// THE FEEDBACK LAYER — a comment bubble, the way a design canvas does it. A bubble opens beside
// wherever the viewer long-presses on the page, and a numbered pin is left behind after every
// send so a look back at a direction shows its own trail of comments. The bubble fades and scales
// in, tracks the keyboard so it is never covered, autofocuses so typing needs no second tap, and a
// pin is tappable — it reopens the same bubble, prefilled, with `Update` instead of `Send`,
// writing a new append-only entry that carries the same pin id.
//
// One hook, `useFeedbackLayer`, so VariantsScreen only has to spread `longPressProps` onto each
// page's wrapping Pressable and render `overlay` once. All bubble/pin state lives here; this file
// never reaches any app's storage — `send` is handed in by the consuming app's own route, and
// `initial` (that screen's own prior entries) is handed in too, read by the route on mount.
//
// Ported from an app's own hand-rolled src/dev/variants/FeedbackLayer.tsx (issue #6). Token
// imports are replaced by fields read off the `theme` prop (see canvas/theme.js): color.paper ->
// theme.surface, color.cardBorder -> theme.surfaceBorder, color.ink -> theme.text,
// ink('disabledInk') -> theme.mutedText,
// font.sans/sansSemi -> theme.fontSans/fontSansSemi, type.caption.size -> theme.captionSize,
// type.chip.size -> theme.chipSize, space() -> theme.space(), shadow.paper -> theme.shadow,
// depth[DEFAULT_DEPTH] -> theme.accent. The Hairline import (src/components/layout) is dropped —
// a 1px divider is inlined here instead, coloured by `theme.divider`.
//
// Peer deps: react, react-native, react-native-reanimated, react-native-safe-area-context,
// expo-haptics.
const React = require('react');
const { useRef, useState } = React;
const { Keyboard, Pressable, StyleSheet, Text, TextInput, View } = require('react-native');
const Animated = require('react-native-reanimated').default;
const {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} = require('react-native-reanimated');
const Haptics = require('expo-haptics');
const { CommentPin } = require('./CommentPin');
const { deriveInitial } = require('./pins');
const { defaultTheme } = require('./theme');

const BUBBLE_WIDTH = 240;
const BUBBLE_RADIUS = 14;
const BUBBLE_PADDING = 10;
const EDGE_MARGIN = 12; // how close the nudged bubble may sit to a screen edge
const POINT_OFFSET = 12; // the bubble opens just past the finger, not under it
const DOTS_CLEARANCE = 24; // approximate height of the dots row, so the bubble clears it
const KEYBOARD_CLEARANCE = 12; // the bubble's bottom never sits closer than this to the keyboard
const ENTER_MS = 160; // opacity 0->1 and scale 0.96->1 over ~160ms
const EXIT_MS = 120; // it leaves by fading ~120ms

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

/** Everything the bubble and pins need. `pageSize` is the current page's own box (the pager sizes
 *  every page to the window, so this is just the window) — proportions are computed against it,
 *  which is what makes a point mean the same thing on any device.
 *  @param {string} screen
 *  @param {string} variant
 *  @param {{width:number,height:number}} pageSize
 *  @param {import('react-native-safe-area-context').EdgeInsets} insets
 *  @param {(entry: import('./pins').FeedbackEntry) => void} send
 *  @param {import('./pins').FeedbackEntry[]} initial
 *  @param {import('./theme').Theme} [theme] */
function useFeedbackLayer(screen, variant, pageSize, insets, send, initial, theme = defaultTheme) {
  const [note, setNote] = useState('');
  const [bubble, setBubble] = useState(null);
  const [closing, setClosing] = useState(false);
  const [seeded] = useState(() => deriveInitial(initial));
  const [pins, setPins] = useState(seeded.pins);
  const [picked, setPicked] = useState(seeded.picked);
  // Seeded with each variant's highest pin number so far, so a pin dropped this session
  // continues the sequence instead of restarting it.
  const nextNumber = useRef(
    seeded.pins.reduce((counts, p) => {
      counts[p.variant] = Math.max(counts[p.variant] ?? 0, p.number);
      return counts;
    }, {}),
  );
  const pinCounter = useRef(0);

  const openAtPoint = (e) => {
    if (!pageSize.width || !pageSize.height) return;
    // pageX/pageY, never locationX/Y: location is relative to the innermost view under the
    // finger (a card, a scale cell), which scatters pins. The page fills the window, so window
    // coordinates ARE page coordinates. (See docs/canvas.md for the one open question this
    // leaves: a scrollable page breaks the "page fills the window" assumption.)
    const { pageX, pageY } = e.nativeEvent;
    Haptics.selectionAsync().catch(() => {});
    setNote('');
    setClosing(false);
    setBubble({
      point: { x: clamp01(pageX / pageSize.width), y: clamp01(pageY / pageSize.height) },
      pinId: null,
    });
  };

  const openAtPin = (pin) => {
    Haptics.selectionAsync().catch(() => {});
    setNote(pin.note);
    setClosing(false);
    setBubble({ point: pin.point, pinId: pin.id });
  };

  const requestClose = () => {
    if (!bubble) return;
    Keyboard.dismiss();
    setClosing(true);
    setTimeout(() => {
      setBubble(null);
      setClosing(false);
    }, EXIT_MS);
  };

  /** Writes `{ screen, variant, kind: 'pick', at }` immediately and closes — no pin: a pick shows
   *  as a `picked` chip beside the dots, not a mark on the page. */
  const onPick = () => {
    if (!bubble) return;
    send({ screen, variant, kind: 'pick', at: new Date().toISOString() });
    setPicked((prev) => (prev.includes(variant) ? prev : [...prev, variant]));
    requestClose();
  };

  /** Empty note is a no-op — the bubble stays open. A bubble opened from an existing pin
   *  (`bubble.pinId` set) writes an edit: same pin id, new text, the log still append-only. */
  const onSubmit = () => {
    if (!bubble) return;
    const trimmed = note.trim();
    if (!trimmed) return;
    const pinId = bubble.pinId ?? `${Date.now()}-${pinCounter.current++}`;
    send({
      screen,
      variant,
      kind: 'note',
      note: trimmed,
      pin: pinId,
      x: bubble.point.x,
      y: bubble.point.y,
      at: new Date().toISOString(),
    });
    if (bubble.pinId) {
      setPins((prev) => prev.map((p) => (p.id === pinId ? { ...p, note: trimmed } : p)));
    } else {
      const number = (nextNumber.current[variant] ?? 0) + 1;
      nextNumber.current[variant] = number;
      setPins((prev) => [...prev, { id: pinId, variant, point: bubble.point, note: trimmed, number }]);
    }
    setNote('');
    requestClose();
  };

  const overlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {pins
        .filter((p) => p.variant === variant)
        .map((p) => (
          <CommentPin
            key={p.id}
            point={p.point}
            pageSize={pageSize}
            number={p.number}
            onPress={() => openAtPin(p)}
            theme={theme}
          />
        ))}

      {bubble ? (
        <>
          {/* Tap outside the bubble closes it — a full-screen catcher UNDER the bubble (rendered
              first), so the bubble's own taps never reach it. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} testID="canvas-bubble-scrim" />
          <Bubble
            point={bubble.point}
            pageSize={pageSize}
            insets={insets}
            note={note}
            setNote={setNote}
            variant={variant}
            actionLabel={bubble.pinId ? 'Update' : 'Send'}
            onPick={onPick}
            onSubmit={onSubmit}
            closing={closing}
            theme={theme}
          />
        </>
      ) : null}
    </View>
  );

  return { longPressProps: { onLongPress: openAtPoint }, overlay, picked };
}

/** Paper-style bubble, 240 wide, radius 14, padding 10. Anchors at the pressed point (or the
 *  reopened pin's point), nudged to stay on-screen, and never lower than `KEYBOARD_CLEARANCE`
 *  above the keyboard. */
function Bubble({ point, pageSize, insets, note, setNote, variant, actionLabel, onPick, onSubmit, closing, theme }) {
  // Two-pass position: a reasonable estimate on first paint, corrected by onLayout's real size.
  // The estimate never actually paints — opacity starts at 0, and onLayout lands well inside the
  // entrance's 160ms — which is what kills a visible two-pass jump.
  const [measured, setMeasured] = useState({ width: BUBBLE_WIDTH, height: 96 });
  const basePos = atPoint(point, pageSize, insets, measured);

  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);
  React.useEffect(() => {
    if (closing) {
      opacity.value = withTiming(0, { duration: EXIT_MS });
    } else {
      opacity.value = withTiming(1, { duration: ENTER_MS });
      scale.value = withTiming(1, { duration: ENTER_MS });
    }
  }, [closing, opacity, scale]);

  const keyboard = useAnimatedKeyboard();
  const animStyle = useAnimatedStyle(() => {
    const minTop = insets.top + DOTS_CLEARANCE;
    const keyboardTop = pageSize.height - keyboard.height.value - KEYBOARD_CLEARANCE - measured.height;
    const top =
      keyboard.height.value > 0 ? Math.max(minTop, Math.min(basePos.top, keyboardTop)) : basePos.top;
    return {
      opacity: opacity.value,
      transform: [{ scale: scale.value }],
      top: withTiming(top, { duration: 160 }),
    };
  });

  const s = makeStyles(theme);

  return (
    <Animated.View
      style={[s.bubble, { width: BUBBLE_WIDTH, left: basePos.left }, animStyle]}
      onLayout={(e) => setMeasured(e.nativeEvent.layout)}
      testID="canvas-bubble"
    >
      <View style={s.inputBlock}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="note"
          placeholderTextColor={theme.mutedText}
          style={s.input}
          autoFocus
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          testID="canvas-note-input"
        />
        <View style={s.divider} />
      </View>
      <View style={s.row}>
        <Pressable onPress={onPick} hitSlop={8} testID="canvas-pick">
          <Text style={s.pick}>{`Pick ${variant}`}</Text>
        </Pressable>
        <View style={s.gap} />
        <Pressable onPress={onSubmit} hitSlop={8} testID="canvas-send">
          <Text style={s.send}>{actionLabel}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function atPoint(point, pageSize, insets, box) {
  const desiredLeft = point.x * pageSize.width + POINT_OFFSET;
  const desiredTop = point.y * pageSize.height + POINT_OFFSET;
  const minLeft = EDGE_MARGIN;
  const maxLeft = Math.max(minLeft, pageSize.width - EDGE_MARGIN - box.width);
  const minTop = insets.top + DOTS_CLEARANCE;
  const maxTop = Math.max(minTop, pageSize.height - insets.bottom - EDGE_MARGIN - box.height);
  return {
    left: Math.min(Math.max(desiredLeft, minLeft), maxLeft),
    top: Math.min(Math.max(desiredTop, minTop), maxTop),
  };
}

function makeStyles(theme) {
  return StyleSheet.create({
    bubble: {
      position: 'absolute',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.surfaceBorder,
      borderRadius: BUBBLE_RADIUS,
      padding: BUBBLE_PADDING,
      gap: BUBBLE_PADDING,
      ...theme.shadow,
    },
    inputBlock: { gap: theme.space(1.5) },
    input: {
      fontFamily: theme.fontSans,
      fontSize: theme.captionSize,
      color: theme.text,
      paddingVertical: theme.space(1),
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.divider },
    row: { flexDirection: 'row', alignItems: 'center' },
    gap: { flex: 1 },
    pick: { fontFamily: theme.fontMono, fontSize: theme.chipSize, color: theme.text },
    send: { fontFamily: theme.fontSansSemi, fontSize: theme.captionSize, color: theme.accent },
  });
}

module.exports = { useFeedbackLayer };
