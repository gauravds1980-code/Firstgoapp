import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { AuthScaffold } from '../components/AuthScaffold';
import { Banner, Button, Field, Icon, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { DEALER_MOBILE_REGEX, requestDealerOtp } from '../services/auth';
import { colors, space } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';
import { SHOW_DEV_UI } from '../config/devFlags';
import { useAutoAdvance, useVoiceStep } from '../voice/useAutoAdvance';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';

export default function DealerLoginScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'DealerLogin'>>();
  const [mobile, setMobile] = useState(route.params?.mobile ?? '');
  // Only Get OTP marks the field touched (not blur), so dismissing a tip never flags an empty field.
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = DEALER_MOBILE_REGEX.test(mobile);
  const fieldErr = touched && !valid ? (mobile.length < 10 ? 'Enter all 10 digits' : 'Mobile numbers start with 6, 7, 8 or 9') : undefined;

  const getOtp = async () => {
    setTouched(true); setErr(null);
    if (!valid) { haptic.error(); reportValidationError('DealerLogin'); return; }
    setLoading(true);
    const r = await requestDealerOtp(mobile);
    setLoading(false);
    if (!r.ok) { haptic.error(); setErr(r.message); autoSend.reset(); return; }
    nav.navigate('DealerOtp', { mobile, txnId: r.data.txnId, resendInSec: r.data.resendInSec });
  };

  // v1.4.5 S2.6 hands-off: a valid 10-digit number (typed or spoken) asks for the OTP 900 ms after the last edit; an
  // edit cancels the countdown; one request per number (a tap during the countdown sends once). Get OTP stays.
  const autoSend = useAutoAdvance(() => { void getOtpRef.current(); });
  const getOtpRef = useRef(getOtp);
  getOtpRef.current = getOtp;
  const tap = () => { if (valid && !loading) autoSend.press(); else void getOtp(); };
  const draft = useVoiceDraft();
  useEffect(() => {
    const m = draft?.slots.mobileNumber;
    if (!m || !DEALER_MOBILE_REGEX.test(m)) return;
    voiceDraft.take('mobileNumber'); voiceDraft.take('sendOtp');
    setMobile(m); setErr(null); autoSend.typed(true);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useVoiceStep({ route: 'DealerLogin', cta: { id: 'get-otp', label: 'Get OTP', destructive: false, enabled: valid && !loading, hint: 'Say your 10-digit dealer mobile number first.', press: tap } });

  return (
    <AuthScaffold title="Dealer login" subtitle="Sign in with your IDFC FIRST registered dealer mobile number."
      footer={<>
        <Button label="Get OTP" iconRight="arrow-right" onPress={tap} loading={loading} accessibilityHint="Sends by itself once the 10-digit number is complete" />
        <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>
      </>}>
      <Field
        label="Dealer mobile" prefix="+91" placeholder="10-digit registered mobile" keyboardType="number-pad" inputMode="numeric" maxLength={10}
        textContentType="telephoneNumber" autoComplete="tel" autoFocus
        value={mobile} onChangeText={(t) => { const d = t.replace(/\D/g, ''); setMobile(d); setErr(null); autoSend.typed(DEALER_MOBILE_REGEX.test(d)); }} onSubmitEditing={tap}
        error={fieldErr} hint="We'll send a 6-digit OTP to this number."
        right={valid ? <Icon name="check-circle" size={22} color={colors.successBright} style={{ marginRight: space.md }} /> : undefined}
      />
      {err && <Banner tone="danger" title="Couldn't send OTP" body={err} />}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon name="shield-lock-outline" size={20} color={colors.primary} />
        <Text variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
          For authorised dealer staff only. Your login is separate from your customers' details — never use a customer's number here.
        </Text>
      </View>
      {SHOW_DEV_UI && <Text variant="caption" color={colors.textMuted}>Demo: OTP 123456 · any other number Hero, TA · ends 1111 multi-brand, TA · 2222 Maruti sub-dealer, no TA/INF (apply) · 3333 Tata CV dealer, INF · 0000 not a dealer · 9999 network error</Text>}
    </AuthScaffold>
  );
}
