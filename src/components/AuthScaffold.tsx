import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gutter, radius, space } from '../theme/tokens';
import { Text } from './ui';
import { BrandLockup } from './BrandMarks';
import { ZippyTipSlot } from './assistant/ZippyTipSlot';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { useRoute } from '@react-navigation/native';
import { reportFooterHeight } from './assistant/zippySection';
import { scrollZippyAvoid } from './assistant/zippyAvoid';

/**
 * Auth layout: maroon hero header with the shared bank lockup (IDFC mark + one-line "IDFC FIRST Bank"
 * + "» FIRSTgo · Dealer app" in mixed case), warm canvas body, fixed bottom CTA bar. Zippy's tip slot
 * sits right above the CTA bar, never over the form. The CTA bar reports its height so floating Zippy
 * rests above it.
 */
export function AuthScaffold({ title, subtitle, children, footer, top }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode; top?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const route = useRoute().name;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} locations={[0, 0.5, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter.screen, paddingBottom: space.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden', gap: space.lg }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -30, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          <BrandLockup onDark appSuffix=" · Dealer app" style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.xs, flexShrink: 0, marginLeft: space.sm }}>
            {top}
            <HeaderVoiceMic onDark />
            <HeaderDockSlot />
          </View>
        </View>
        <View style={{ gap: space.xs }}>
          <Text variant="h1" color={colors.onPrimary} accessibilityRole="header">{title}</Text>
          <Text variant="body" color="rgba(255,255,255,0.88)">{subtitle}</Text>
        </View>
      </LinearGradient>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: gutter.screen, gap: space.lg }} keyboardShouldPersistTaps="handled" onScroll={scrollZippyAvoid} scrollEventThrottle={64}>{children}</ScrollView>
        <ZippyTipSlot />
        <View onLayout={(e) => reportFooterHeight(route, e.nativeEvent.layout.height)} style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: gutter.screen, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.xs }}>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
