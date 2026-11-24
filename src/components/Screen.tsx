import React from 'react';
import { ASSISTANT_NAME } from '../config/brand';
import { KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { reportFooterHeight } from './assistant/zippySection';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRODUCTS } from '../config/products';
import type { AssistantContext, JourneyStep } from '../navigation/types';
import { useApp } from '../state/AppState';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { colors, elevation, fontScaleCap, gutter, radius, space, touch } from '../theme/tokens';
import { IdfcMark } from './BrandMarks';
import { BrandWordmark } from './BrandWordmark';
import { ZippyTipSlot } from './assistant/ZippyTipSlot';
import { StepProgress } from './StepProgress';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { Icon, PressableScale, Text } from './ui';

/**
 * Compact header used by every main-stack screen except Home and Scan QR.
 *   [‹ back]? [IDFC mark] [IDFC FIRST Bank / title] … [help]? [Zippy dock] [mic] [home]
 * The mic (HeaderVoiceMic) is its own slot, independent of Zippy. No dealer avatar here (Home only).
 * `title` is the screen's own name ("Payouts", "RC pendency") on non-journey screens, or the product
 * ("Two-wheeler loan") on journey screens. Everything is ONE line (wordmark and title both), so the
 * header height never changes from screen to screen. Same logo-mark tile as login and Home.
 */
export function BrandHeader({ showHome = true, title, subtitle, back = false, onHelp }: { showHome?: boolean; title?: string; subtitle?: string; back?: boolean; onHelp?: () => void }) {
  const nav = useNavigation();
  const { product } = useApp();
  const heading = title ?? subtitle ?? PRODUCTS[product].headerSubtitle;
  const goBack = () => (nav.canGoBack() ? nav.goBack() : nav.navigate('Home'));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: back ? space.xs : gutter.screen, paddingRight: gutter.screen, paddingVertical: space.xs, minHeight: 64 }}>
      {back && (
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={goBack}
          style={{ width: touch.min, height: touch.min, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron-left" size={30} color={colors.text} />
        </PressableScale>
      )}
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: space.xxs }} accessibilityRole="header" accessibilityLabel={`${heading}, IDFC FIRST Bank`}>
        <IdfcMark size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <BrandWordmark />
          <Text variant="label" color={title ? colors.text : colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}>{heading}</Text>
        </View>
      </View>
      {onHelp && (
        <PressableScale accessibilityRole="button" accessibilityLabel={`Get help from ${ASSISTANT_NAME}`} onPress={onHelp}
          style={{ width: touch.min, height: touch.min, flexShrink: 0, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.aiUser, marginRight: space.xs }}>
          <Icon name="creation" size={22} color={colors.accent} />
        </PressableScale>
      )}
      {/* Zippy docks here; the hold-to-talk mic is its own slot beside it (both fixed footprints, so the header never shifts). */}
      <HeaderDockSlot />
      <HeaderVoiceMic style={showHome ? { marginRight: space.xxs } : undefined} />
      {showHome && (
        <PressableScale accessibilityRole="button" accessibilityLabel="Go to home"
          onPress={() => nav.navigate('Home')}
          style={{ width: touch.min, height: touch.min, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primaryTint }}>
          <Icon name="home-outline" size={26} color={colors.primary} />
        </PressableScale>
      )}
    </View>
  );
}

/**
 * Screen scaffold for the main stack: safe areas, compact header, step progress (journey steps only),
 * scroll body, Zippy's tip slot, thumb-reachable sticky CTA bar at the bottom and T&C footer.
 *  - `step` → journey screen: product title + one-line step progress.
 *  - `title` (no step) → a non-journey screen ("Payouts", "Profile"…): its own title + a back chevron.
 *  - `interstitial` → the "Checking bank records" beat: progress bar with that title, no step number.
 * Zippy's tip appears in the bottom safe zone right above the footer (ZippyTipSlot), never over content.
 * The footer reports its height so a floating Zippy stays clear of the CTA; `onScroll` feeds
 * section-aware help (useSectionTracker). `toast` shows a short confirmation above the footer.
 */
export function JourneyScreen({ step, title, interstitial, back, assistant, children, footer, showTerms = true, onScroll, toast }: {
  step?: JourneyStep; title?: string; interstitial?: string; back?: boolean; assistant: AssistantContext; children: React.ReactNode; footer?: React.ReactNode; showTerms?: boolean;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; toast?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const route = useRoute().name;
  const hasFooter = !!(footer || showTerms);
  const [footerH, setFooterH] = React.useState(0);
  const showBack = back ?? (!step && !interstitial);
  React.useEffect(() => { if (!hasFooter) { reportFooterHeight(route, 0); setFooterH(0); } }, [hasFooter, route]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {/* Non-journey screens get a back chevron instead of the Home button (they open from Home). */}
        <BrandHeader title={step || interstitial ? undefined : title} back={showBack} showHome={!showBack} />
        {step && <StepProgress step={step} interstitial={interstitial} />}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1, width: '100%' }} contentContainerStyle={{ padding: gutter.screen, gap: space.lg, paddingBottom: space.xxxl + space.xl }} keyboardShouldPersistTaps="handled"
          onScroll={onScroll} scrollEventThrottle={onScroll ? 64 : undefined}>
          {children}
        </ScrollView>
        {/* With no footer the tip sits at the screen bottom, so it clears the home indicator itself. */}
        <ZippyTipSlot bottomInset={hasFooter ? 0 : insets.bottom} />
        {hasFooter && <View onLayout={(e) => { reportFooterHeight(route, e.nativeEvent.layout.height); setFooterH(e.nativeEvent.layout.height); }}
          style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: gutter.screen, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.sm), gap: space.xs }}>
          {footer}
          {showTerms && <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>}
        </View>}
        {toast ? (
          <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(160)} pointerEvents="none"
            style={{ position: 'absolute', left: gutter.screen, right: gutter.screen, bottom: (hasFooter ? footerH : Math.max(insets.bottom, space.sm)) + space.sm }}>
            <View accessibilityRole="alert" accessibilityLiveRegion="polite"
              style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.textStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }, elevation.raised as object]}>
              <Icon name="check-circle" size={20} color={colors.successBright} />
              <Text variant="bodyStrong" color={colors.onPrimary} style={{ flex: 1 }}>{toast}</Text>
            </View>
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
