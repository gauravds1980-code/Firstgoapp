import React, { useEffect, useId, useRef } from 'react';
import { PanResponder, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ASSISTANT_NAME } from '../../config/brand';
import { colors } from '../../theme/tokens';
import { haptic } from '../../utils/haptics';
import { ZippyCharacter } from './ZippyCharacter';
import { registerDockSlot, useRouteMood, useZippyStore, zippyDock, ZippyMood } from './zippyStore';

/** Header slot footprint (always reserved, so headers never shift) and the docked mini face size. */
export const DOCK_SLOT_SIZE = 44;
export const DOCK_MINI_SIZE = 36;

/** Drag the docked face down at least this far (dp) to float it again. */
const UNDOCK_DRAG = 24;

/** Set when the orb lands, so only that hand-off gets the little settle bounce (not every screen mount). */
let landedAt = 0;
export const markZippyLanded = () => { landedAt = Date.now(); };

function DockedFace({ mood, disabled }: { mood: ZippyMood; disabled: boolean }) {
  const reduce = useReducedMotion();
  const settle = useSharedValue(1);
  /** Follows the finger while the face is dragged down out of the header. */
  const pull = useSharedValue(0);
  useEffect(() => {
    if (reduce || Date.now() - landedAt > 500) return;
    settle.value = withSequence(withTiming(1.14, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 260 }));
  }, [reduce, settle]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }, { scale: settle.value }] }));
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  // v1.2.9: pan down out of the header (> UNDOCK_DRAG) → float Zippy where it was dropped. Taps and
  // long-press still go to the Pressable (the pan only claims a clearly downward drag).
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => !disabledRef.current && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { pull.value = Math.max(0, Math.min(g.dy, 40)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > UNDOCK_DRAG) { pull.value = 0; haptic.select(); zippyDock.requestUndock({ x: g.moveX, y: g.moveY }); return; }
      pull.value = reduceRef.current ? 0 : withSpring(0, { damping: 14 });
    },
    onPanResponderTerminate: () => { pull.value = reduceRef.current ? 0 : withSpring(0, { damping: 14 }); },
  })).current;
  return (
    <View {...pan.panHandlers} style={{ width: '100%', height: '100%' }}>
      <Pressable
        onPress={() => { haptic.tap(); zippyDock.requestSheet(); }}
        onLongPress={() => { haptic.select(); zippyDock.requestUndock(); }}
        delayLongPress={550}
        disabled={disabled}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`${ASSISTANT_NAME}, your assistant`}
        accessibilityHint="Opens quick help. Drag down or long-press to show the assistant on screen"
        accessibilityActions={[{ name: 'longpress', label: 'Show on screen' }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') zippyDock.requestUndock(); }}
        style={({ pressed }) => [{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 }, { cursor: 'pointer' } as object]}
      >
        <Animated.View style={a}><ZippyCharacter size={DOCK_MINI_SIZE} mood={mood} /></Animated.View>
      </Pressable>
    </View>
  );
}

/** "Drop to dock" ring, shown on the empty slot while a floating Zippy is dragged over the header. */
function DropRing({ on, size }: { on: boolean; size: number }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => { v.value = reduce ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 140 }); }, [on, reduce, v]);
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.86 + v.value * 0.14 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size - 4, height: size - 4, borderRadius: size, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primaryTint }, st]} />
  );
}

/**
 * Fixed-size header slot Zippy docks into. Used by BrandHeader, Home, AuthScaffold, Scan QR and Face e-KYC.
 * Docked → this slot draws the mini face: tap = help sheet, drag down / long-press = float on screen.
 * Floating (the default since v1.2.9) → empty slot (same footprint, so the header never jumps); while the
 * floating orb is dragged over the header it shows a "drop to dock" ring.
 * Zippy only: no mic here (the standalone HeaderVoiceMic is a sibling slot), and the face shows the
 * route mood — voice commands never animate it.
 * Floating → empty placeholder (same footprint), so there is only ever one face. While its screen is focused the slot
 * registers a measurer, so ZippyBubble flies to its real on-screen position.
 */
export function HeaderDockSlot({ size = DOCK_SLOT_SIZE, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const id = useId();
  const focused = useIsFocused();
  const route = useRoute().name;
  const { phase, dropHint } = useZippyStore();
  const routeMood = useRouteMood(route);

  useEffect(() => {
    if (!focused) return;
    return registerDockSlot(id, (cb) => {
      const node = ref.current;
      if (!node) { cb(null); return; }
      node.measureInWindow((x, y, width, height) => cb(width || height ? { x, y, width, height } : null));
    });
  }, [focused, id]);

  const showFace = phase === 'docked' || phase === 'undocking';
  return (
    <View
      ref={ref}
      collapsable={false}
      importantForAccessibility={showFace ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!showFace}
      style={[{ width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {focused && phase === 'floating' && <DropRing on={dropHint} size={size} />}
      {showFace && <DockedFace mood={routeMood} disabled={phase !== 'docked'} />}
    </View>
  );
}
