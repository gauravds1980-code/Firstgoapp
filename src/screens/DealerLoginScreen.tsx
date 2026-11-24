import React, { useState } from 'react';
import { View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { AuthScaffold } from '../components/AuthScaffold';
import { Banner, Button, Field, Icon, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { DEALER_MOBILE_REGEX, requestDealerOtp } from '../services/auth';
import { colors, space } from '../theme/tokens';
import { haptic } from '../utils/haptics';

export default function DealerLoginScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'DealerLogin'>>();
  const [mobile, setMobile] = useState(route.params?.mobile ?? '');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = DEALER_MOBILE_REGEX.test(mobile);
  const fieldErr = touched && !valid ? (mobile.length < 10 ? 'Enter all 10 digits' : 'Mobile numbers start with 6, 7, 8 or 9') : undefined;

  const getOtp = async () => {
    setTouched(true); setErr(null);
    if (!valid) { haptic.error(); return; }
    setLoading(true);
    const r = await requestDealerOtp(mobile);
    setLoading(false);
    if (!r.ok) { haptic.error(); setErr(r.message); return; }
    nav.navigate('DealerOtp', { mobile, txnId: r.data.txnId, resendInSec: r.data.resendInSec });
  };

  return (
    <AuthScaffold title="Dealer login" subtitle="Sign in with your IDFC FIRST registered dealer mobile number."
      footer={<>
        <Button label="Get OTP" iconRight="arrow-right" onPress={getOtp} loading={loading} />
        <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>
      </>}>
      <Field
        label="Dealer mobile" prefix="+91" placeholder="10-digit registered mobile" keyboardType="number-pad" inputMode="numeric" maxLength={10}
        textContentType="telephoneNumber" autoComplete="tel" autoFocus
        value={mobile} onChangeText={(t) => { setMobile(t.replace(/\D/g, '')); setErr(null); }} onBlur={() => setTouched(true)} onSubmitEditing={getOtp}
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
      <Text variant="caption" color={colors.textMuted}>Demo: OTP 123456 · ends 1111 multi-brand · 2222 Maruti sub-dealer · 3333 Tata CV dealer · 0000 not a dealer · 9999 network error</Text>
    </AuthScaffold>
  );
}
