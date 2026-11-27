import React from 'react';
import { ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gutter, radius, space } from '../theme/tokens';
import { Text } from './ui';
import { BrandLockup } from './BrandMarks';
import { ZippyTipSlot } from './assistant/ZippyTipSlot';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { MIC_DISC, MIC_GAP } from '../voice/micDock';
import { useRoute } from '@react-navigation/native';
import { reportFooterHeight } from './assistant/zippySection';
import { scrollZippyAvoid } from './assistant/zippyAvoid';
import { KeyboardRevealProvider, useKeyboardForm } from './keyboard';

/**
 * Auth layout: maroon hero header with the shared bank lockup (IDFC mark + one-line "IDFC FIRST Bank"
 * + "» FIRSTgo · Dealer app" in mixed case), warm canvas body, fixed bottom CTA bar. Zippy's tip slot
 * sits right above the CTA bar, never over the form. The CTA bar reports its height so floating Zippy
 * rests above it.
 * v1.3.1: form + CTA bar lift above the keyboard (see ./keyboard) and the focused input scrolls into view.
 * v1.4.2: the voice mic is bottom-right, 16 dp above the CTA bar (VoiceHost). Sign-in / OTP keep it there —
 * dealers can speak the OTP — so a focused field (the OTP boxes) scrolls to stop above the disc, and the form
 * ends with room for it: the boxes and the CTA are never under the mic.
 */
const MIC_ROOM = MIC_GAP + MIC_DISC + space.xs;
export function AuthScaffold({ title, subtitle, children, footer, top }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode; top?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const route = useRoute().name;
  const kb = useKeyboardForm({ revealBelow: MIC_ROOM });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} locations={[0, 0.5, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter.screen, paddingBottom: space.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden', gap: space.lg }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          <BrandLockup onDark appSuffix=" · Dealer app" style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.xs, flexShrink: 0, marginLeft: space.sm }}>
            {top}
            <HeaderDockSlot />
          </View>
        </View>
        <View style={{ gap: space.xs }}>
          <Text variant="h1" color={colors.onPrimary} accessibilityRole="header">{title}</Text>
          <Text variant="body" color="rgba(255,255,255,0.88)">{subtitle}</Text>
        </View>
      </LinearGradient>
      <View style={{ flex: 1, paddingBottom: kb.lift }}>
        <ScrollView ref={kb.scrollRef} contentContainerStyle={{ padding: gutter.screen, paddingBottom: gutter.screen + MIC_ROOM, gap: space.lg }} keyboardShouldPersistTaps="handled"
          onScroll={(e) => { kb.onScroll(e); scrollZippyAvoid(); }} scrollEventThrottle={64}>
          <KeyboardRevealProvider value={kb.api}>{children}</KeyboardRevealProvider>
        </ScrollView>
        <ZippyTipSlot />
        <View onLayout={(e) => reportFooterHeight(route, e.nativeEvent.layout.height)} style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: gutter.screen, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.xs }}>
          {footer}
        </View>
      </View>
    </View>
  );
}
