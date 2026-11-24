import React, { useEffect, useId, useRef } from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ASSISTANT_NAME } from '../../config/brand';
import { haptic } from '../../utils/haptics';
import { ZippyCharacter } from './ZippyCharacter';
import { registerDockSlot, useRouteMood, useZippyStore, zippyDock, ZippyMood } from './zippyStore';

/** Header slot footprint (always reserved, so headers never shift) and the docked mini face size. */
export const DOCK_SLOT_SIZE = 44;
export const DOCK_MINI_SIZE = 36;

/** Set when the orb lands, so only that hand-off gets the little settle bounce (not every screen mount). */
let landedAt = 0;
export const markZippyLanded = () => { landedAt = Date.now(); };

function DockedFace({ mood, disabled }: { mood: ZippyMood; disabled: boolean }) {
  const reduce = useReducedMotion();
  const settle = useSharedValue(1);
  useEffect(() => {
    if (reduce || Date.now() - landedAt > 500) return;
    settle.value = withSequence(withTiming(1.14, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 260 }));
  }, [reduce, settle]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));
  return (
    <Pressable
      onPress={() => { haptic.tap(); zippyDock.requestSheet(); }}
      onLongPress={() => { haptic.select(); zippyDock.requestUndock(); }}
      delayLongPress={550}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${ASSISTANT_NAME}, your assistant`}
      accessibilityHint="Opens quick help. Long-press to show the assistant on screen"
      accessibilityActions={[{ name: 'longpress', label: 'Show on screen' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') zippyDock.requestUndock(); }}
      style={({ pressed }) => [{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 }, { cursor: 'pointer' } as object]}
    >
      <Animated.View style={a}><ZippyCharacter size={DOCK_MINI_SIZE} mood={mood} /></Animated.View>
    </Pressable>
  );
}

/**
 * Fixed-size header slot Zippy docks into. Used by BrandHeader, Home, AuthScaffold and ScanQr.
 * Docked (the default) → this slot draws the mini face: tap = help sheet, long-press = float on screen.
 * Floating → empty placeholder (same footprint), so there is only ever one face. While its screen is focused the slot
 * registers a measurer, so ZippyBubble flies to its real on-screen position.
 */
export function HeaderDockSlot({ size = DOCK_SLOT_SIZE, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const id = useId();
  const focused = useIsFocused();
  const route = useRoute().name;
  const { phase } = useZippyStore();
  const mood = useRouteMood(route);

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
      {showFace && <DockedFace mood={mood} disabled={phase !== 'docked'} />}
    </View>
  );
}
