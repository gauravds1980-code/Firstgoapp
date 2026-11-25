import React, { useEffect, useId, useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gutter, radius, space, touch } from '../theme/tokens';
import { Icon, PressableScale, Text } from './ui';
import { setNudgeSuppressed } from '../tutorial/tutorialStore';
import { KeyboardRevealProvider, useKeyboardForm } from './keyboard';
import { sheetMaxHeight } from './keyboardMath';

/**
 * Lightweight bottom sheet (Modal + Reanimated spring). Works on Android and web, no native sheet deps.
 * Width is pinned to the screen (nothing inside can push it wider), the height is capped, the body
 * scrolls, and the footer (e.g. Apply) stays visible below the scrolling fields.
 * v1.3.1: the sheet lifts above the keyboard on iOS, Android and web (Modal windows are edge-to-edge on
 * Android, so nothing resizes for us): the container pads by the keyboard height, the cap shrinks so
 * the handle/title stay below the status bar, and the focused Field scrolls into view above the footer.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const y = useSharedValue(600);
  // v1.3.0: no tutorial nudge while a sheet is open.
  const sheetId = `sheet:${useId()}`;
  useEffect(() => { if (!visible) return; setNudgeSuppressed(sheetId, true); return () => setNudgeSuppressed(sheetId, false); }, [visible, sheetId]);
  useEffect(() => { y.value = visible ? (reduce ? withTiming(0, { duration: 1 }) : withSpring(0, { damping: 20, stiffness: 180 })) : 600; }, [visible, y, reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const { height: winH } = useWindowDimensions();
  const kb = useKeyboardForm({ assumeHeight: winH });
  const { reset } = kb;
  useEffect(() => { if (!visible) reset(); }, [visible, reset]);
  // The Modal's own height (layout viewport on web, where the window dims follow the visual viewport).
  const [boxH, setBoxH] = useState(0);
  const maxHeight = boxH ? sheetMaxHeight(boxH, kb.lift, insets.top) : '88%';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, paddingBottom: kb.lift }} onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(18,18,18,0.45)' }} onPress={onClose} accessibilityLabel="Close sheet" />
        <Animated.View style={[{ width: '100%', alignSelf: 'stretch', overflow: 'hidden', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight, paddingBottom: Math.max(insets.bottom, space.md) }, style]} accessibilityViewIsModal>
          <View style={{ alignItems: 'center', paddingTop: space.xs }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter.screen, paddingTop: space.sm, gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="h3" accessibilityRole="header">{title}</Text>
              {subtitle ? <Text variant="caption" color={colors.textSecondary}>{subtitle}</Text> : null}
            </View>
            <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={24} color={colors.text} />
            </PressableScale>
          </View>
          <ScrollView ref={kb.scrollRef} onScroll={kb.onScroll} scrollEventThrottle={32} style={{ flexShrink: 1, width: '100%' }} contentContainerStyle={{ padding: gutter.screen, gap: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="none">
            <KeyboardRevealProvider value={kb.api}>{children}</KeyboardRevealProvider>
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
