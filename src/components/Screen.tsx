import React from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { reportFooterHeight } from './assistant/zippySection';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { PRODUCTS } from '../config/products';
import type { AssistantContext, JourneyStep } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, fontScaleCap, gutter, headerBtn, space, touch } from '../theme/tokens';
import { IdfcMark } from './BrandMarks';
import { BrandWordmark } from './BrandWordmark';
import { ZippyTipSlot } from './assistant/ZippyTipSlot';
import { StepProgress } from './StepProgress';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { scrollZippyAvoid } from './assistant/zippyAvoid';
import { ZIPPY_SAFE_GUTTER } from './assistant/ZippyBubble';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { Icon, PressableScale, Text } from './ui';
import { ToastView, type ToastTone } from './Toast';
import { KeyboardRevealProvider, useKeyboardForm } from './keyboard';

/**
 * Compact header used by every main-stack screen except Home and Scan QR.
 *   [‹ back]? [IDFC mark] [IDFC FIRST Bank / title] … [Zippy dock] [mic] [home]
 * The mic (HeaderVoiceMic) is its own slot, independent of Zippy. No dealer avatar here (Home only).
 * `title` is the screen's own name ("Profile") on non-journey screens, or the product
 * ("Two-wheeler loan") on journey screens. Everything is ONE line (wordmark and title both), so the
 * header height never changes from screen to screen. Same logo-mark tile as login and Home.
 * v1.3.0: `hideTitle` (screens whose page already opens with that name as an H1) shows the wordmark
 * alone. All trailing actions are the same 40dp circle (headerBtn), Home included.
 */
export function BrandHeader({ showHome = true, title, subtitle, back = false, hideTitle = false }: { showHome?: boolean; title?: string; subtitle?: string; back?: boolean; hideTitle?: boolean }) {
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
          {!hideTitle && <Text variant="label" color={title ? colors.text : colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}>{heading}</Text>}
        </View>
      </View>
      {/* Zippy docks here; the hold-to-talk mic is its own slot beside it (both fixed footprints, so the header never shifts). */}
      <HeaderDockSlot />
      <HeaderVoiceMic />
      {showHome && <HeaderCircleButton icon="home-outline" label="Go to home" onPress={() => nav.navigate('Home')} />}
    </View>
  );
}

/** A header action in the shared 40dp circle (same shape and size as the mic and the docked Zippy). */
export function HeaderCircleButton({ icon, label, onPress, children }: { icon?: React.ComponentProps<typeof Icon>['name']; label: string; onPress?: () => void; children?: React.ReactNode }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={headerBtn.hitSlop}
      style={{ width: headerBtn.box, height: headerBtn.box, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: headerBtn.disc, height: headerBtn.disc, borderRadius: headerBtn.disc / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint, borderWidth: 1.5, borderColor: colors.primary }}>
        {icon ? <Icon name={icon} size={22} color={colors.primary} /> : null}
      </View>
      {children}
    </PressableScale>
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
 * v1.3.0: `titleInBody` (the page opens with its own H1) drops the repeated header title. The scroll body
 * ends with ZIPPY_SAFE_GUTTER, so the last card can scroll clear of floating Zippy, and every scroll end
 * lets Zippy re-check that it is not resting on a control.
 * v1.3.1: the body + sticky footer lift above the keyboard (padding by its height, every platform), and a
 * focused Field / OtpInput scrolls into view above the footer.
 */
export function JourneyScreen({ step, title, titleInBody = false, interstitial, back, assistant, children, footer, showTerms = true, onScroll, toast, toastTone }: {
  step?: JourneyStep; title?: string; titleInBody?: boolean; interstitial?: string; back?: boolean; assistant: AssistantContext; children: React.ReactNode; footer?: React.ReactNode; showTerms?: boolean;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; toast?: string | null; toastTone?: ToastTone;
}) {
  const insets = useSafeAreaInsets();
  const route = useRoute().name;
  const hasFooter = !!(footer || showTerms);
  const [footerH, setFooterH] = React.useState(0);
  const showBack = back ?? (!step && !interstitial);
  React.useEffect(() => { if (!hasFooter) { reportFooterHeight(route, 0); setFooterH(0); } }, [hasFooter, route]);
  // No sticky footer → the field's action is inline below it: keep room for it above the keyboard.
  const kb = useKeyboardForm({ revealBelow: hasFooter ? 16 : 140 });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {/* Non-journey screens get a back chevron instead of the Home button (they open from Home). */}
        <BrandHeader title={step || interstitial ? undefined : title} hideTitle={titleInBody && !step && !interstitial} back={showBack} showHome={!showBack} />
        {step && <StepProgress step={step} interstitial={interstitial} />}
      </View>
      <View style={{ flex: 1, paddingBottom: kb.lift }}>
        <View style={{ flex: 1 }}>
        <ScrollView ref={kb.scrollRef} style={{ flex: 1, width: '100%' }} contentContainerStyle={{ padding: gutter.screen, gap: space.lg, paddingBottom: ZIPPY_SAFE_GUTTER }} keyboardShouldPersistTaps="handled"
          onScroll={(e) => { kb.onScroll(e); onScroll?.(e); scrollZippyAvoid(); }} scrollEventThrottle={64}>
          <KeyboardRevealProvider value={kb.api}>{children}</KeyboardRevealProvider>
        </ScrollView>
        {/* A short fade above the sticky footer, so the last visible row (e.g. Disbursal's UTR) never sits flush against the CTA bar. */}
        {hasFooter && <LinearGradient pointerEvents="none" colors={['rgba(253,244,239,0)', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: space.md }} />}
        </View>
        {/* With no footer the tip sits at the screen bottom, so it clears the home indicator itself. */}
        <ZippyTipSlot bottomInset={hasFooter ? 0 : insets.bottom} />
        {hasFooter && <View onLayout={(e) => { reportFooterHeight(route, e.nativeEvent.layout.height); setFooterH(e.nativeEvent.layout.height); }}
          style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: gutter.screen, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.sm), gap: space.xs }}>
          {footer}
          {showTerms && <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>}
        </View>}
        {toast ? <ToastView text={toast} tone={toastTone} side={gutter.screen} bottom={(hasFooter ? footerH : Math.max(insets.bottom, space.sm)) + space.sm + kb.lift} /> : null}
      </View>
    </View>
  );
}
