import React, { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeInLeft, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { DisbursalHero } from '../components/motion/DisbursalMotion';
import { GoldShimmer } from '../components/motion/primitives';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { copyUtr, useToast } from '../components/Toast';
import { useSectionTracker } from '../components/assistant/zippySection';
import { Button, Card, Icon, IconName, PressableScale, Text } from '../components/ui';
import { Milestone, useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { charges, fmtDuration, inr } from '../utils/finance';

const STEPS: { key: Milestone; label: string; icon: IconName }[] = [
  { key: 'offer', label: 'Offer', icon: 'tag-check-outline' },
  { key: 'kyc', label: 'KYC', icon: 'face-recognition' },
  { key: 'mandate', label: 'Mandate', icon: 'bank-check' },
  { key: 'esign', label: 'e-Sign', icon: 'draw-pen' },
  { key: 'disbursed', label: 'Disbursed', icon: 'bank-transfer-in' },
];

/**
 * Final screen: check burst + confetti + gold ring pulse, a stopwatch that counts up to the
 * real elapsed time (journey.startedAt → disbursal), and the Offer → … → Disbursed timeline.
 */
export default function DisbursalScreen() {
  const nav = useNavigation();
  const { journey, product, session } = useApp();
  const d = journey.disbursal ?? {
    utr: 'IDFBR817262893749220', netAmount: charges(product, journey.loan).net, creditedTo: `${session?.name ?? 'ABC Motors'} · IDFC FIRST ••4321`, elapsedSec: 222, timeline: [],
  };
  // Real elapsed time when the journey ran in this session; demo fallback otherwise.
  const end = journey.marks.disbursed;
  const totalSec = end ? Math.max(1, Math.round((end - journey.startedAt) / 1000)) : d.elapsedSec;
  const at = useMemo(() => {
    // Offsets (s) from start for each milestone; fill gaps for a deep-linked demo.
    const m = journey.marks; const start = journey.startedAt;
    return STEPS.map((s, i) => (m[s.key] && end ? Math.round((m[s.key]! - start) / 1000) : Math.round((totalSec * i) / (STEPS.length - 1))));
  }, [journey.marks, journey.startedAt, end, totalSec]);
  const waived: Partial<Record<Milestone, boolean>> = { kyc: !!journey.ekyc?.fromBankRecords, mandate: !!journey.mandate?.existing };

  const reduce = useReducedMotion();
  const [cardW, setCardW] = useState(320);
  const sec = useSectionTracker<'receipt' | 'timeline'>('receipt');
  const utrToast = useToast();

  return (
    <JourneyScreen step="disbursal" assistant="disbursal" showTerms={false} onScroll={sec.onScroll} toast={utrToast.toast?.text} toastTone={utrToast.toast?.tone} footer={
      <View style={{ gap: space.xs }}>
        <Button label="Start next loan" icon="qrcode-scan" onPress={() => nav.navigate('Home')} />
        <Button label="View all applications" variant="ghost" onPress={() => nav.navigate('QuickList', { kind: 'loans' })} />
      </View>}>
      <DisbursalHero totalSec={totalSec} />
      <Animated.View entering={reduce ? undefined : FadeInUp.delay(500).springify().damping(16)}>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
          Approved & disbursed in <Text variant="bodyStrong">{fmtDuration(totalSec)}</Text> · offer to money in the dealer's account
        </Text>
      </Animated.View>

      <View onLayout={sec.at('receipt')}>
      <Card style={{ backgroundColor: colors.primaryTint, borderColor: colors.primarySoft, gap: space.sm, alignItems: 'center', overflow: Platform.OS === 'ios' ? 'visible' : 'hidden' }}>
        {/* iOS: clip the shimmer layer itself so the card keeps its shadow (overflow:'hidden' drops iOS shadows). */}
        <View onLayout={(e) => setCardW(e.nativeEvent.layout.width)} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, ...(Platform.OS === 'ios' ? { overflow: 'hidden' as const, borderRadius: radius.lg } : null) }} pointerEvents="none">
          {!reduce && <GoldShimmer width={cardW} height={220} delay={1500} />}
        </View>
        <Text variant="label" color={colors.textSecondary}>CREDITED TO DEALER</Text>
        <Text variant="display" color={colors.primary} style={{ fontSize: 36, lineHeight: 44, fontVariant: ['tabular-nums'] }}>{inr(d.netAmount)}</Text>
        <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>{d.creditedTo} · net of {inr(journey.loan - d.netAmount)} customer charges · loan {inr(journey.loan)}</Text>
        <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: colors.primarySoft }} />
        <View style={{ alignSelf: 'stretch' }}>
          <Text variant="caption" color={colors.textSecondary}>UTR number</Text>
          <PressableScale haptics={false} onPress={() => { void copyUtr(d.utr, utrToast.show); }} accessibilityRole="button" accessibilityLabel={`UTR ${d.utr}. Tap to copy`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: touch.min }}>
            <Text variant="label">{d.utr}</Text><Icon name="content-copy" size={16} color={colors.primary} />
          </PressableScale>
        </View>
      </Card>
      </View>
      {/* Timeline */}
      <View onLayout={sec.at('timeline')}>
      <Card style={{ gap: 0, paddingVertical: space.md }}>
        {STEPS.map((s, i) => {
          const last = i === STEPS.length - 1;
          return (
            <Animated.View key={s.key} entering={reduce ? undefined : FadeInLeft.delay(700 + i * 140).springify().damping(15)} style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: last ? colors.successBright : waived[s.key] ? colors.ctaTint : colors.successSoft, alignItems: 'center', justifyContent: 'center', borderWidth: waived[s.key] ? 1.5 : 0, borderColor: colors.cta }}>
                  <Icon name={last ? 'check-bold' : s.icon} size={18} color={last ? '#fff' : waived[s.key] ? colors.ctaDark : colors.success} />
                </View>
                {!last && <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: colors.successBright, opacity: 0.35 }} />}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : space.sm, paddingTop: 5 }}>
                <Text variant="bodyStrong">{s.label}</Text>
                {waived[s.key] ? <Text variant="caption" color={colors.ctaDark}>On file with bank · step skipped</Text> : null}
              </View>
              <Text variant="label" color={last ? colors.success : colors.textSecondary} style={{ paddingTop: 6, fontVariant: ['tabular-nums'] }}>{i === 0 ? '0s' : `+${fmtDuration(at[i]!)}`}</Text>
            </Animated.View>
          );
        })}
      </Card>
      </View>

      <View style={{ borderRadius: radius.md, padding: space.sm, backgroundColor: colors.ctaTint, flexDirection: 'row', gap: space.xs }}>
        <Icon name="card-account-details-outline" size={20} color={colors.ctaDark} />
        <Text variant="caption" style={{ flex: 1 }}>Remember to upload the RC once registration is done (Actions → RC Pendency).</Text>
      </View>
    </JourneyScreen>
  );
}
