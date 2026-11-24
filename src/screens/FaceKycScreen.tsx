import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSwipeBack } from '../navigation/useSwipeBack';
import { useZippyTip } from '../components/assistant/tips';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { JourneyScreen } from '../components/Screen';
import { FaceCapture } from '../components/FaceCapture';
import { Button, Card, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { ekyc } from '../services';
import { WaiverMotion, WaiverItem } from '../components/motion/WaiverMotion';
import { waiverPlan } from '../utils/waivers';
import { rid } from '../services/mock';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { haptic } from '../utils/haptics';

/** idle = consent + method cards; capturing = front camera, waiting for a blink; verifying = blink seen, success beat + UIDAI fetch. */
type Stage = 'idle' | 'capturing' | 'verifying' | 'done' | 'error';
/** Success beat after the blink before auto-advancing to Mandate. */
const SUCCESS_BEAT_MS = 1000;

export default function FaceKycScreen() {
  const nav = useNavigation();
  const { journey, update, features, product } = useApp();
  const [method, setMethod] = useState<'face' | 'finger'>('face');
  // v1.2.8: first arrival opens the front camera straight away (no consent card / "Start face capture" tap).
  // KYC on file keeps the waiver beat; closing the camera falls back to the consent + retry UI ('idle').
  const [stage, setStage] = useState<Stage>(() => (journey.ekyc ? 'done' : journey.offer.waivers.kycOnFile ? 'idle' : 'capturing'));
  const [err, setErr] = useState('');

  // Start (re)opens the front camera from the fallback UI after the dealer closed it. The blink drives the rest.
  const start = () => { setErr(''); setStage('capturing'); };

  const leaving = useRef(false);
  const onBlink = async () => {
    haptic.success(); setStage('verifying'); // liveness passed — short tick beat, then auto-advance
    const pid = { pidBlock: `MOCK_PID_${journey.offer.loanApplicationNumber}`, livenessScore: 0.97, wadh: 'MOCK_WADH_HASH=' };
    const [r] = await Promise.all([ekyc.performEkyc25(pid, true), new Promise((res) => setTimeout(res, SUCCESS_BEAT_MS))]);
    if (!r.ok) { setStage('error'); setErr(r.message); haptic.error(); return; }
    update({ ekyc: r.data }); setStage('done');
    if (!leaving.current) { leaving.current = true; nav.navigate('Mandate'); } // auto-advance — no Continue / Next button
  };

  // ETB waiver: KYC already on file with the bank → animate, record, auto-advance.
  const kycOnFile = journey.offer.waivers.kycOnFile;
  const advanced = useRef(false);
  const plan = waiverPlan(journey, product);
  useZippyTip(kycOnFile && !journey.ekyc ? '' : null); // quiet during the auto-advancing waiver beat
  useZippyMood(stage === 'capturing' ? 'thinking' : stage === 'verifying' || stage === 'done' ? 'happy' : null);
  useSwipeBack(!(kycOnFile && !journey.ekyc)); // iOS: no swipe-back mid waiver animation
  const sec = useSectionTracker<'method' | 'capture'>('capture');
  const needsCapture = !kycOnFile && stage !== 'done' && stage !== 'capturing' && stage !== 'verifying';
  useZippyPending(needsCapture ? [{
    id: 'faceKyc', label: stage === 'error' ? 'Face capture failed — retry needed' : 'Customer consent + face capture',
    detail: 'Read the consent line to the customer, then start the capture.', actionLabel: stage === 'error' ? 'Retry capture' : 'Start capture',
    onAction: start, // consent is captured by the start action, as on the footer button
  }] : []);
  if (kycOnFile && !journey.ekyc) {
    const both = plan.mandate && !journey.mandate;
    const mdt = journey.offer.waivers.mandateOnFile;
    // Auto-advance, no tap. If the mandate is also on file, one combined beat and straight to e-sign (KFS goes with the link).
    const finish = () => {
      if (advanced.current) return; advanced.current = true;
      update({
        ekyc: { txn: rid('BKR'), uidToken: rid('UIDT', 16), name: journey.offer.customerName, dob: '14-08-1991', gender: 'M', addressLine: 'Andheri East, Mumbai 400069', fromBankRecords: true },
        ...(both && mdt ? { mandate: { umn: mdt.umn, status: 'ACTIVE' as const, payerVpa: mdt.payerVpa, mode: 'upi' as const, existing: true } } : {}),
      });
      nav.navigate(both ? 'Esign' : 'Mandate');
    };
    const items: WaiverItem[] = [{ icon: 'shield-account', title: 'KYC verified from bank records', detail: `${kycOnFile.source} · ${kycOnFile.verifiedOn}` }];
    if (both && mdt) items.push({ icon: 'bank-check', title: 'AutoPay mandate already active', detail: `UMN ••${mdt.umn.split('@')[0]!.slice(-4)} · up to ${'\u20B9'}${mdt.maxAmount.toLocaleString('en-IN')}/month` });
    return (
      <JourneyScreen step={both ? 'mandate' : 'kyc'} interstitial="Checking bank records" assistant="kyc" showTerms={false}>
        <WaiverMotion title={both ? 'KYC + mandate verified' : 'KYC verified from bank records'}
          subtitle={`${journey.offer.customerName.split(' ')[0]} is an existing IDFC FIRST customer. ${both ? 'Face e-KYC and the AutoPay step aren\'t needed — the KFS + e-sign link goes to them next.' : 'Face e-KYC isn\'t needed.'}`}
          items={items} onDone={finish} />
      </JourneyScreen>
    );
  }

  // Camera capture UI: full screen, front camera, oval guide. No footer buttons — a blink auto-advances.
  if (stage === 'capturing' || stage === 'verifying' || stage === 'error') {
    return (
      <FaceCapture phase={stage === 'verifying' ? 'passed' : stage === 'error' ? 'error' : 'live'} error={err}
        onBlink={onBlink} onClose={() => { setErr(''); setStage('idle'); }} onRetry={start} />
    );
  }

  // Done path auto-advances, so the footer is only for starting / retrying the capture.
  const footer = stage === 'done' ? undefined
    : <Button label="Start face capture" icon="face-recognition" onPress={start}
        accessibilityHint="Confirms the customer consented to Aadhaar face authentication, then opens the front camera" />;
  const ringColor = stage === 'done' ? colors.successBright : colors.primary;

  return (
    <JourneyScreen step="kyc" assistant="kyc" footer={footer} onScroll={sec.onScroll}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Aadhaar face e-KYC</Text>
        <Text variant="body" color={colors.textSecondary}>The front camera opens with an oval guide. The customer lines up their face and blinks; liveness is checked and UIDAI returns their verified KYC.</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }} onLayout={sec.at('method')}>
        <MethodCard on={method === 'face'} icon="face-recognition" title="Face" sub="UIDAI Face RD" onPress={() => setMethod('face')} />
        <MethodCard on={method === 'finger'} icon="fingerprint" title="Fingerprint" sub={features.fingerprintKyc ? 'RD device' : 'Coming soon'}
          disabled={!features.fingerprintKyc} onPress={() => setMethod('finger')} />
      </View>

      <View style={{ alignItems: 'center', paddingVertical: space.md }} onLayout={sec.at('capture')}>
        <View style={{ width: 200, height: 200, borderRadius: 100, borderWidth: 4, borderColor: ringColor, borderStyle: stage === 'idle' ? 'dashed' : 'solid', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
          accessibilityLabel={`Face capture ${stage}`}>
          <Icon name={stage === 'done' ? 'check-bold' : 'face-man-outline'} size={96} color={ringColor} />
        </View>
        <Text variant="label" color={colors.textSecondary} style={{ marginTop: space.sm }}>
          {stage === 'done' ? (journey.ekyc?.fromBankRecords ? 'KYC verified from bank records · step skipped' : 'Liveness passed · KYC verified') : 'Good light · no cap or mask · eye level'}
        </Text>
      </View>

      {stage === 'done' && journey.ekyc ? (
        <Card style={{ gap: space.xxs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="label" color={colors.textSecondary}>{journey.ekyc.fromBankRecords ? 'FROM BANK RECORDS' : 'VERIFIED BY UIDAI'}</Text><Pill label={journey.ekyc.fromBankRecords ? 'KYC on file' : 'e\u2011KYC verified'} tone="success" />
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
