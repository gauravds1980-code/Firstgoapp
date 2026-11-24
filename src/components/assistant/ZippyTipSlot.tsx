import React from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { ASSISTANT_NAME } from '../../config/brand';
import { colors, elevation, fontScaleCap, gutter, radius, space } from '../../theme/tokens';
import { Icon, Text } from '../ui';
import { ZippyCharacter } from './ZippyCharacter';
import { useZippyStore, zippyDock, zippyTip } from './zippyStore';

/**
 * Where Zippy's once-per-screen tip appears: the bottom safe zone directly ABOVE the screen's sticky
 * footer (JourneyScreen, AuthScaffold, Scan QR) or above Home's Scan QR FAB. In-flow screens give the
 * tip its own row, so the scroll area shrinks while it shows and the tip can never sit on a form error,
 * a link or an amount. ZippyBubble decides what to say and auto-dismisses it.
 *
 * One close control: the ✕ here dismisses the tip only. Hiding Zippy itself is a long-press on Zippy
 * (or the menu in its help sheet). Tapping the bubble opens the help sheet.
 */
export function ZippyTipSlot({ style, onDark = false, bottomInset = 0 }: { style?: StyleProp<ViewStyle>; onDark?: boolean; bottomInset?: number }) {
  const route = useRoute().name;
  const focused = useIsFocused();
  const reduce = useReducedMotion();
  const { tip } = useZippyStore();
  const show = focused && tip && tip.route === route;
  return (
    <View pointerEvents="box-none" style={style}>
      {show && tip ? (
        <Animated.View key={tip.id} entering={reduce ? undefined : FadeInDown.duration(220)} exiting={FadeOut.duration(160)}
          style={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, paddingBottom: space.xs + bottomInset }}>
          <Pressable onPress={() => { zippyTip.hide(tip.id); zippyDock.requestSheet(); }}
            accessibilityRole="button" accessibilityLabel={`${ASSISTANT_NAME} says: ${tip.text}`} accessibilityHint="Opens quick help"
            accessibilityLiveRegion="polite"
            style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingLeft: space.sm, paddingRight: space.xxs,
              borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: onDark ? 'rgba(255,255,255,0.96)' : colors.surface }, elevation.card as object]}>
            <View style={{ width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ZippyCharacter size={32} speaking />
            </View>
            <Text variant="caption" color={colors.text} numberOfLines={3} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" color={colors.primary} maxFontSizeMultiplier={fontScaleCap.compact}>{ASSISTANT_NAME} · </Text>{tip.text}
            </Text>
            <Pressable onPress={() => zippyTip.hide(tip.id)} hitSlop={4} accessibilityRole="button" accessibilityLabel="Dismiss tip"
              style={{ width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
