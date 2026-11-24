import React from 'react';
import { ASSISTANT_NAME } from '../config/brand';
import { Image, KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { reportFooterHeight } from './assistant/zippySection';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRODUCTS } from '../config/products';
import type { AssistantContext, JourneyStep } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, gutter, space, touch } from '../theme/tokens';
import { StepProgress } from './StepProgress';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { Icon, PressableScale, Text } from './ui';

export function BrandHeader({ showHome = true, subtitle, onHelp }: { showHome?: boolean; subtitle?: string; onHelp?: () => void }) {
  const nav = useNavigation();
  const { product } = useApp();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter.screen, paddingVertical: space.xs, minHeight: 64 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityRole="header" accessibilityLabel={`IDFC FIRST Bank, ${subtitle ?? PRODUCTS[product].headerSubtitle}`}>
        <Logo height={28} />
        <View style={{ width: 1, height: 28, backgroundColor: colors.border }} />
        <Text variant="overline" color={colors.primary} style={{ flexShrink: 1 }}>{subtitle ?? PRODUCTS[product].headerSubtitle}</Text>
      </View>
      {onHelp && (
        <PressableScale accessibilityRole="button" accessibilityLabel={`Get help from ${ASSISTANT_NAME}`} onPress={onHelp}
          style={{ width: touch.min, height: touch.min, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.aiUser, marginRight: space.xs }}>
          <Icon name="creation" size={22} color={colors.accent} />
        </PressableScale>
      )}
      {/* Zippy docks here (fixed footprint, so the header never shifts). */}
      <HeaderDockSlot style={showHome ? { marginRight: space.xs } : undefined} />
      {showHome && (
        <PressableScale accessibilityRole="button" accessibilityLabel="Go to home"
          onPress={() => nav.navigate('Home')}
          style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primaryTint }}>
          <Icon name="home-outline" size={26} color={colors.primary} />
        </PressableScale>
      )}
    </View>
  );
}

/** Official IDFC FIRST Bank logo lockup (from /workspace/boom-brand/IDFC-logo-website.png). */
export function Logo({ height = 32 }: { height?: number }) {
  return <Image source={require('../../assets/idfc-logo.png')} accessibilityIgnoresInvertColors accessibilityLabel="IDFC FIRST Bank"
    style={{ height, width: height * (455 / 151), borderRadius: 6 }} resizeMode="contain" />;
}

/**
 * Journey scaffold: safe areas, brand header, step progress, scroll body,
 * thumb-reachable sticky CTA bar at the bottom and T&C footer. The assistant is the global
 * draggable Zippy bubble (ZippyBubble) — `assistant` is kept as a hint for the tip context.
 * The footer reports its height so Zippy never floats over the primary CTA; `onScroll` feeds
 * section-aware help (useSectionTracker).
 */
export function JourneyScreen({ step, assistant, children, footer, showTerms = true, onScroll }: {
  step?: JourneyStep; assistant: AssistantContext; children: React.ReactNode; footer?: React.ReactNode; showTerms?: boolean;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const insets = useSafeAreaInsets();
  const route = useRoute().name;
  const hasFooter = !!(footer || showTerms);
  React.useEffect(() => { if (!hasFooter) reportFooterHeight(route, 0); }, [hasFooter, route]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <BrandHeader />
        {step && <StepProgress step={step} />}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: gutter.screen, gap: space.lg, paddingBottom: space.xxxl + space.xl }} keyboardShouldPersistTaps="handled"
          onScroll={onScroll} scrollEventThrottle={onScroll ? 64 : undefined}>
          {children}
        </ScrollView>
        {hasFooter && <View onLayout={(e) => reportFooterHeight(route, e.nativeEvent.layout.height)}
          style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: gutter.screen, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.sm), gap: space.xs }}>
          {footer}
          {showTerms && <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>}
        </View>}
      </KeyboardAvoidingView>
    </View>
  );
}
