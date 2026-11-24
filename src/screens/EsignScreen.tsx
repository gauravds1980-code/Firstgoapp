import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Icon, OtpInput, PressableScale, Skeleton, Text } from '../components/ui';
import { esign } from '../services';
import type { EsignSession } from '../services/types';
import { useApp } from '../state/AppState';
import { colors, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';

export default function EsignScreen() {
  const nav = useNavigation();
  const { journey, update } = useApp();
  const [session, setSession] = useState<EsignSession | null>(null);
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(30);

  const send = async () => {
    setSession(null); setResendIn(30);
    const r = await esign.sendAgreementAndOtp(journey.offer.registeredMobile, journey.offer.loanApplicationNumber);
    if (r.ok) setSession(r.data);
  };
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
    if (!r.ok) { haptic.error(); setErr(r.message); return; }
    haptic.success(); update({ esignDone: true }); nav.navigate('Docs');
  };

  return (
    <JourneyScreen step="esign" assistant="esign" footer={<Button label="E-sign agreement" icon="draw-pen" onPress={() => verify()} loading={loading} disabled={otp.length !== 6 || !session} />}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">E-sign the loan agreement</Text>
        <Text variant="body" color={colors.textSecondary}>Ask the customer to open the SMS, read the agreement and KFS, then read the OTP out to you.</Text>
      </View>
      <Card style={{ gap: space.sm }}>
        {session ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="message-processing-outline" size={28} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Agreement link + OTP sent</Text>
                <Text variant="caption" color={colors.textSecondary}>to the registered mobile {session.maskedMobile}</Text>
              </View>
            </View>
            <Text variant="caption" color={colors.primary} numberOfLines={1}>{session.agreementUrl}</Text>
          </>
        ) : (<><Skeleton w="70%" /><Skeleton w="50%" h={12} /></>)}
      </Card>
      <View style={{ gap: space.xs }}>
        <Text variant="label">Customer's e-sign OTP</Text>
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setErr(''); if (v.length === 6 && session && !loading) verify(v); /* auto-submit */ }} error={!!err} />
        {err ? <Text variant="caption" color={colors.danger}>{err}</Text> : null}
      </View>
      <PressableScale disabled={resendIn > 0} onPress={send} accessibilityRole="button" style={{ minHeight: touch.min, justifyContent: 'center', alignSelf: 'flex-end' }}>
        <Text variant="label" color={resendIn > 0 ? colors.textSecondary : colors.primary}>{resendIn > 0 ? `Resend OTP in 0:${String(resendIn).padStart(2, '0')}` : 'Resend OTP & agreement link'}</Text>
      </PressableScale>
      <Banner tone="warning" icon="account-check-outline" title="Customer must read the OTP themselves" body="Never type an OTP the customer hasn't seen. The e-stamp is applied automatically on signing." />
    </JourneyScreen>
  );
}
