import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Banner, Button, Card, Icon, OtpInput, PressableScale, Skeleton, Text } from '../components/ui';
import { esign } from '../services';
import type { EsignSession } from '../services/types';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { maskMobile } from '../utils/finance';
import { haptic, hapticMoment } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';

/**
 * v1.2.2: there is no dealer KFS screen. The KFS + agreement go to the customer's registered mobile
 * with the e-sign link; this chip tells the dealer where it went and whether consent is in.
 */
function KfsChip({ mobile, state }: { mobile: string; state: 'sending' | 'awaiting' | 'consented' }) {
  const [bg, fg, icon] = state === 'consented'
    ? [colors.successSoft, colors.success, 'file-document-check-outline' as const]
    : state === 'awaiting' ? [colors.ctaTint, colors.ctaDark, 'file-send-outline' as const] : [colors.surfaceMuted, colors.textSecondary, 'progress-upload' as const];
  const text = state === 'sending' ? `Sending KFS to customer on ${maskMobile(mobile)}…`
    : state === 'awaiting' ? `KFS sent to customer on ${maskMobile(mobile)} · awaiting consent`
    : `KFS sent to ${maskMobile(mobile)} · consent received`;
  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={text}
      style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, minHeight: 40, borderRadius: radius.pill, backgroundColor: bg }}>
      <Icon name={icon} size={18} color={fg} />
      <Text variant="label" color={fg} style={{ flex: 1, fontVariant: ['tabular-nums'] }}>{text}</Text>
    </View>
  );
}

export default function EsignScreen() {
  const nav = useNavigation();
  const { journey, update } = useApp();
  const [session, setSession] = useState<EsignSession | null>(null);
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  useZippyMood(loading ? 'thinking' : null);
  const [resendIn, setResendIn] = useState(30);

  const send = async () => {
    setSession(null); setResendIn(30);
    const r = await esign.sendAgreementAndOtp(journey.offer.registeredMobile, journey.offer.loanApplicationNumber);
    if (r.ok) { setSession(r.data); hapticMoment.offerSent(); }
  };
  const sec = useSectionTracker<'kfs' | 'otp'>('kfs');
  useZippyPending(journey.esignDone ? [] : [{
    id: 'consent', label: session ? 'Awaiting customer consent on the KFS' : 'Sending KFS + agreement link',
    detail: otp.length ? `OTP ${otp.length}/6 digits entered.` : 'Customer reads the KFS on their phone, then reads the OTP to you.',
    ...(resendIn <= 0 ? { actionLabel: 'Resend KFS & OTP', onAction: () => { send(); } } : {}),
  }]);
  useEffect(() => { send(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const verify = async (code = otp) => {
    if (!session) return;
    setLoading(true); setErr('');
    const r = await esign.verifyEsignOtp(session.txnId, code);
    setLoading(false);
    if (!r.ok) { haptic.error(); reportValidationError('Esign'); setErr(r.message); return; }
    haptic.success(); update({ esignDone: true }); nav.navigate('Docs');
  };

  // v1.3.0: it signs by itself at the 6th digit, so there is no disabled button while the OTP is incomplete —
  // just a status line. The button shows while signing, once signed, and to retry a full OTP after an error.
  const footer = journey.esignDone || loading || (otp.length === 6 && session)
    ? <Button label="E-sign agreement" icon="draw-pen" onPress={() => verify()} loading={loading} success={journey.esignDone} />
    : (
      <View accessible accessibilityLabel={`Signs automatically at the 6th digit. ${otp.length} of 6 entered`}
        style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
        <Icon name="draw-pen" size={20} color={colors.textSecondary} />
        <Text variant="bodyStrong" color={colors.textSecondary}>{session ? `Signs automatically at the 6th digit · ${otp.length}/6` : 'Sending the e-sign OTP…'}</Text>
      </View>
    );

  return (
    <JourneyScreen step="esign" assistant="esign" onScroll={sec.onScroll} footer={footer}>
      <View style={{ gap: space.xs }} onLayout={sec.at('kfs')}>
        <KfsChip mobile={journey.offer.registeredMobile} state={journey.esignDone ? 'consented' : session ? 'awaiting' : 'sending'} />
        <Text variant="h2">E-sign the loan agreement</Text>
        <Text variant="body" color={colors.textSecondary}>Ask the customer to open the SMS, read the KFS and agreement on their phone, then read the OTP out to you.</Text>
      </View>
      <Card style={{ gap: space.sm }}>
        {session ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="message-processing-outline" size={28} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">KFS, agreement link + OTP sent</Text>
                <Text variant="caption" color={colors.textSecondary}>to the registered mobile {maskMobile(journey.offer.registeredMobile)}</Text>
              </View>
            </View>
            <Text variant="caption" color={colors.primary} numberOfLines={1}>{session.agreementUrl}</Text>
          </>
        ) : (<><Skeleton w="70%" /><Skeleton w="50%" h={12} /></>)}
      </Card>
      <View style={{ gap: space.xs }} onLayout={sec.at('otp')}>
        <Text variant="label">Customer's e-sign OTP</Text>
        {/* OtpInput registers its own Zippy avoid-rect. */}
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setErr(''); if (v.length === 6 && session && !loading) verify(v); /* auto-submit */ }} error={!!err} />
        {err ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{err}</Text>
          : <Text variant="caption" color={colors.textSecondary}>The customer reads the 6-digit OTP from their SMS.</Text>}
      </View>
      <ZippyAvoid style={{ alignSelf: 'flex-end' }}>
        <PressableScale disabled={resendIn > 0} dimDisabled={false} onPress={send} accessibilityRole="button" style={{ minHeight: touch.min, justifyContent: 'center' }}>
          <Text variant="label" color={resendIn > 0 ? colors.textSecondary : colors.primary}>{resendIn > 0 ? `Resend OTP in 0:${String(resendIn).padStart(2, '0')}` : 'Resend OTP & KFS link'}</Text>
        </PressableScale>
      </ZippyAvoid>
      <Banner tone="warning" icon="account-check-outline" title="Customer must read the OTP themselves" body="Never type an OTP the customer hasn't seen. The e-stamp is applied automatically on signing." />
    </JourneyScreen>
  );
}
