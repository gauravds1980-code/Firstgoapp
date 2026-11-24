import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSwipeBack } from '../navigation/useSwipeBack';
import { useZippyTip } from '../components/assistant/tips';
import { useZippyMood } from '../components/assistant/zippyStore';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { AVAILABLE_FROM } from '../config/phases';
import { ekyc } from '../services';
import { WaiverMotion, WaiverItem } from '../components/motion/WaiverMotion';
import { waiverPlan } from '../utils/waivers';
import { rid } from '../services/mock';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';

type Stage = 'idle' | 'capturing' | 'verifying' | 'done' | 'error';

export default function FaceKycScreen() {
  const nav = useNavigation();
  const { journey, update, features, product } = useApp();
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<'face' | 'finger'>('face');
  const [stage, setStage] = useState<Stage>(journey.ekyc ? 'done' : 'idle');
  const [err, setErr] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (stage !== 'capturing') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.06, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, [stage, pulse]);

  const start = async () => {
    setErr(''); setStage('capturing');
    const cap = await ekyc.captureFaceViaRdIntent(journey.offer.loanApplicationNumber);
    if (!cap.ok) { setStage('error'); setErr(cap.message); haptic.error(); return; }
    setStage('verifying');
    const r = await ekyc.performEkyc25(cap.data, true); // consent captured by the start tap
    if (!r.ok) { setStage('error'); setErr(r.message); haptic.error(); return; }
    haptic.success(); update({ ekyc: r.data }); setStage('done');
    setTimeout(() => nav.navigate('Mandate'), 900); // auto-advance — no extra tap
  };

  // ETB waiver: KYC already on file with the bank → animate, record, auto-advance.
  const kycOnFile = journey.offer.waivers.kycOnFile;
  const advanced = useRef(false);
  const plan = waiverPlan(journey, product);
  useZippyTip(kycOnFile && !journey.ekyc ? '' : null); // quiet during the auto-advancing waiver beat
  useZippyMood(stage === 'capturing' || stage === 'verifying' ? 'thinking' : stage === 'done' ? 'happy' : null);
  useSwipeBack(!(kycOnFile && !journey.ekyc)); // iOS: no swipe-back mid waiver animation
  if (kycOnFile && !journey.ekyc) {
    const both = plan.mandate && !journey.mandate;
    const mdt = journey.offer.waivers.mandateOnFile;
    // Auto-advance, no tap. If the mandate is also on file, one combined beat and straight to KFS.
    const finish = () => {
      if (advanced.current) return; advanced.current = true;
      update({
        ekyc: { txn: rid('BKR'), uidToken: rid('UIDT', 16), name: journey.offer.customerName, dob: '14-08-1991', gender: 'M', addressLine: 'Andheri East, Mumbai 400069', fromBankRecords: true },
        ...(both && mdt ? { mandate: { umn: mdt.umn, status: 'ACTIVE' as const, payerVpa: mdt.payerVpa, mode: 'upi' as const, existing: true } } : {}),
      });
      nav.navigate(both ? 'Kfs' : 'Mandate');
    };
    const items: WaiverItem[] = [{ icon: 'shield-account', title: 'KYC verified from bank records', detail: `${kycOnFile.source} · ${kycOnFile.verifiedOn}` }];
    if (both && mdt) items.push({ icon: 'bank-check', title: 'AutoPay mandate already active', detail: `UMN ••${mdt.umn.split('@')[0]!.slice(-4)} · up to ${'\u20B9'}${mdt.maxAmount.toLocaleString('en-IN')}/month` });
    return (
      <JourneyScreen step={both ? 'mandate' : 'kyc'} assistant="kyc" showTerms={false}>
        <WaiverMotion title={both ? 'KYC + mandate verified' : 'KYC verified from bank records'}
          subtitle={`${journey.offer.customerName.split(' ')[0]} is an existing IDFC FIRST customer. ${both ? 'Face e-KYC and the AutoPay step aren\'t needed.' : 'Face e-KYC isn\'t needed.'}`}
          items={items} onDone={finish} />
      </JourneyScreen>
    );
  }

  const ringColor = stage === 'done' ? colors.successBright : stage === 'error' ? colors.danger : colors.primary;
  const footer = stage === 'done'
    ? <Button label="Continue to AutoPay mandate" iconRight="arrow-right" onPress={() => nav.navigate('Mandate')} />
    : <Button label={stage === 'capturing' ? 'Capturing face…' : stage === 'verifying' ? 'Verifying with UIDAI…' : stage === 'error' ? 'Retry face capture' : 'Customer consents · start face capture'}
        icon="face-recognition" onPress={() => { setConsent(true); start(); }} loading={stage === 'capturing' || stage === 'verifying'} />;

  return (
    <JourneyScreen step="kyc" assistant="kyc" footer={footer}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Aadhaar face e-KYC</Text>
        <Text variant="body" color={colors.textSecondary}>Point the camera at the customer. UIDAI's Face RD app checks liveness and returns their verified KYC.</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <MethodCard on={method === 'face'} icon="face-recognition" title="Face" sub="UIDAI Face RD" onPress={() => setMethod('face')} />
        <MethodCard on={method === 'finger'} icon="fingerprint" title="Fingerprint" sub={features.fingerprintKyc ? 'RD device' : `Coming in MVP ${AVAILABLE_FROM.fingerprintKyc}`}
          disabled={!features.fingerprintKyc} onPress={() => setMethod('finger')} />
      </View>

      <View style={{ alignItems: 'center', paddingVertical: space.md }}>
        <Animated.View style={{ width: 200, height: 200, borderRadius: 100, borderWidth: 4, borderColor: ringColor, borderStyle: stage === 'idle' ? 'dashed' : 'solid', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, transform: [{ scale: pulse }] }}
          accessibilityLabel={`Face capture ${stage}`}>
          <Icon name={stage === 'done' ? 'check-bold' : stage === 'error' ? 'alert' : 'face-man-outline'} size={96} color={ringColor} />
        </Animated.View>
        <Text variant="label" color={colors.textSecondary} style={{ marginTop: space.sm }}>
          {{ idle: 'Good light · no cap or mask · eye level', capturing: 'Hold still — checking liveness…', verifying: 'Fetching e-KYC from UIDAI via ASA…', done: journey.ekyc?.fromBankRecords ? 'KYC verified from bank records · step skipped' : 'Liveness passed · KYC verified', error: 'Capture failed' }[stage]}
        </Text>
      </View>

      {stage === 'error' && <Banner tone="danger" title="Face capture failed" body={err || 'Please try again in better light.'} />}

      {stage === 'done' && journey.ekyc ? (
        <Card style={{ gap: space.xxs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="label" color={colors.textSecondary}>{journey.ekyc.fromBankRecords ? 'FROM BANK RECORDS' : 'VERIFIED BY UIDAI'}</Text><Pill label={journey.ekyc.fromBankRecords ? 'KYC ON FILE' : 'E-KYC OK'} tone="success" />
          </View>
          <ReadOnlyRow label="Name" value={journey.ekyc.name} />
          <ReadOnlyRow label="Date of birth" value={journey.ekyc.dob} />
          <ReadOnlyRow label="Address" value={journey.ekyc.addressLine} />
          <ReadOnlyRow label="UID token" value={`••••${journey.ekyc.uidToken.slice(-4)}`} />
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md, backgroundColor: colors.primaryTint }}>
          <Icon name="shield-check-outline" size={22} color={colors.primary} />
          <Text variant="body" style={{ flex: 1 }}>By tapping start, the customer consents to IDFC FIRST Bank using their Aadhaar face authentication to fetch e-KYC from UIDAI for this loan.</Text>
        </View>
      )}
    </JourneyScreen>
  );
}

function MethodCard({ on, icon, title, sub, onPress, disabled }: { on: boolean; icon: React.ComponentProps<typeof Icon>['name']; title: string; sub: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} accessibilityLabel={`${title}, ${sub}`}
      style={{ flex: 1, minHeight: 72, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface, padding: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={28} color={on ? colors.primary : colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color={colors.textSecondary}>{sub}</Text>
      </View>
    </PressableScale>
  );
}
