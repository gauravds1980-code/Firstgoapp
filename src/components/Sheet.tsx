import React, { useEffect, useId } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gutter, radius, space, touch } from '../theme/tokens';
import { Icon, PressableScale, Text } from './ui';
import { setNudgeSuppressed } from '../tutorial/tutorialStore';

/**
 * Lightweight bottom sheet (Modal + Reanimated spring). Works on Android and web, no native sheet deps.
 * Width is pinned to the screen (nothing inside can push it wider), the height is capped, the body
 * scrolls, and the footer (e.g. Apply) stays visible below the scrolling fields.
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(18,18,18,0.45)' }} onPress={onClose} accessibilityLabel="Close sheet" />
        <Animated.View style={[{ width: '100%', alignSelf: 'stretch', overflow: 'hidden', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%', paddingBottom: Math.max(insets.bottom, space.md) }, style]} accessibilityViewIsModal>
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
          <ScrollView style={{ flexShrink: 1, width: '100%' }} contentContainerStyle={{ padding: gutter.screen, gap: space.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
