import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { RouteProp, StackActions, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { Banner, Button, ErrorState, Field, Icon, OtpInput, PressableScale, Text } from '../components/ui';
import { PRODUCTS } from '../config/products';
import type { RootStackParamList } from '../navigation/types';
import { offers } from '../services';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { haptic, hapticMoment } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';
import { maskMobile } from '../utils/finance';
import { SHOW_DEV_UI } from '../config/devFlags';
import { otpFromDraft } from '../voice/otpParse';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { useUndoSource } from '../voice/voiceUndo';
import { useAutoAdvance, useVoiceStep } from '../voice/useAutoAdvance';

type Stage = 'enter' | 'otp' | 'none';

export default function SearchMobileScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SearchMobile'>>();
  const { product, condition, startJourney, features, session } = useApp();
  const [stage, setStage] = useState<Stage>(route.params?.stage ?? 'enter');
  const [mobile, setMobile] = useState(route.params?.stage && route.params.stage !== 'enter' ? (route.params.stage === 'none' ? '9876500000' : '9912345677') : '');
  const [touched, setTouched] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  useZippyMood(loading ? 'thinking' : null);
  const [err, setErr] = useState<string | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(30);

  useEffect(() => {
    if (stage !== 'otp' || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, resendIn]);

  // Customer mobile is never pre-filled from the dealer session; typing the dealer's own number is blocked.
  const isDealerOwn = !!session && mobile === session.mobile;
  const valid = /^[6-9]\d{9}$/.test(mobile) && !isDealerOwn;
  // Inline validation: a wrong first digit shows at once; a short number shows once 10 digits are typed or on blur.
  const badStart = mobile.length > 0 && !/^[6-9]/.test(mobile);
  const mobileErr = isDealerOwn ? "This is your dealer login number, not the customer's"
    : badStart ? 'Indian mobile numbers start with 6, 7, 8 or 9'
    : touched && !valid ? (mobile.length < 10 ? `Enter all 10 digits (${mobile.length}/10)` : 'Indian mobile numbers start with 6, 7, 8 or 9') : undefined;
  const otpErr = err; // partial OTPs get a live digit counter, not an error

  // Mirror the stage into route params so voice can tell the server what to expect (phone vs OTP).
  useEffect(() => { if (route.params?.stage !== stage) nav.setParams({ stage }); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Confirmed voice fills: take only the slot this stage uses, leave the rest of the draft for later screens.
  // The OTP is only placed in the boxes; the dealer still taps Verify (no auto-submit from voice).
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!draft || loading) return;
    if (stage === 'enter' && draft.slots.mobileNumber && /^[6-9]\d{9}$/.test(draft.slots.mobileNumber)) {
      const m = voiceDraft.take('mobileNumber');
      voiceDraft.take('sendOtp');
      // v1.4.5 S2.6: a valid spoken number sends the consent OTP after the same debounce as typing (Undo cancels it).
      if (m) { setMobile(m); setTouched(true); autoSend.typed(validMobile(m)); }
    } else if (stage === 'otp' && draft.slots.otp) {
      voiceDraft.take('otpSubmit'); // never auto-verified here: the dealer taps Verify
      const code = otpFromDraft(voiceDraft.take('otp'), false); // exactly 6 digits (v1.4.5), else dropped
      if (code) { setOtp(code); setErr(null); }
    }
  }, [draft, stage, loading]);

  // Voice Undo (auto-filled mobile / OTP): put the previous value back. Never verifies.
  const focused = useIsFocused();
  useUndoSource('mobile', () => mobile, (v) => { autoSend.cancel(); setMobile(v); setTouched(v !== ''); }, focused && stage === 'enter');
  useUndoSource('otp', () => otp, (v) => { setOtp(v); setErr(null); }, focused && stage === 'otp');

  const sec = useSectionTracker<'mobile' | 'otp'>('mobile');
  useEffect(() => { sec.set(stage === 'otp' ? 'otp' : 'mobile'); }, [stage, sec]);
  useZippyPending(stage === 'enter' && !valid ? [{ id: 'mobile', label: "Customer's 10-digit mobile", detail: mobileErr ?? 'The number registered with IDFC FIRST Bank.' }]
    : stage === 'otp' && otp.length < 6 ? [{ id: 'otp', label: 'Customer consent OTP', detail: `${otp.length}/6 digits — the customer reads it out.` }] : []);

  const sendOtp = async () => {
    setTouched(true);
    if (!valid) { haptic.error(); reportValidationError('SearchMobile'); return; }
    setLoading(true); setNetErr(null);
    const r = await offers.sendConsentOtp(mobile);
    setLoading(false);
    if (!r.ok) { haptic.error(); setNetErr(r.message); autoSend.reset(); return; }
    hapticMoment.offerSent(); // consent OTP is on its way to the customer
    voiceDraft.take('otp'); // a spoken code from before this OTP was sent is stale
    setOtp(''); setTouched(false); setResendIn(30); setStage('otp');
  };

  // v1.4.5 S2.6 hands-off: a valid 10-digit number (typed or voice) sends the consent OTP 900 ms after the last edit;
  // an edit cancels the countdown; one send per number (a tap during the countdown sends once). The button stays.
  const autoSend = useAutoAdvance(() => { void sendRef.current(); });
  const sendRef = React.useRef(sendOtp);
  sendRef.current = sendOtp;
  const validMobile = (m: string) => /^[6-9]\d{9}$/.test(m) && !(session && m === session.mobile);
  const sendTap = () => { if (valid && !loading) autoSend.press(); else void sendOtp(); };
  useEffect(() => { if (stage === 'enter') autoSend.reset(); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useVoiceStep(focused && stage === 'enter' ? { route: 'SearchMobile',
    cta: { id: 'send-otp', label: 'Send consent OTP', destructive: false, enabled: valid && !loading, hint: mobileErr ?? "Say the customer's 10-digit mobile number first.", press: sendTap } } : null);

  const verify = async (code = otp) => {
    setLoading(true); setErr(null);
    const r = await offers.verifyConsentAndFetchOffer(mobile, code, product, condition);
    setLoading(false);
    if (!r.ok) { haptic.error(); reportValidationError('SearchMobile'); setErr(r.message); return; }
    if (!r.data) { setStage('none'); return; }
    startJourney(r.data);
    // Same path as a QR scan: ~1.6 s offer celebration (owns the haptics), then Vehicle & EMI. Replace so
    // back from Asset doesn't return to the OTP step or replay the celebration.
    nav.dispatch(StackActions.replace('OfferReveal'));
  };

  if (netErr) {
    return (
      <JourneyScreen assistant="search" footer={<Button label="Go to Home" variant="secondary" onPress={() => nav.navigate('Home')} />}>
        <ErrorState title="Something went wrong" body={netErr} onRetry={sendOtp} />
      </JourneyScreen>
    );
  }

  if (stage === 'none') {
    return (
      <JourneyScreen assistant="search" footer={
        <View style={{ gap: space.xs }}>
          <Button label="Try another number" onPress={() => { setStage('enter'); setMobile(''); setTouched(false); }} />
          <Button label="Go to Home" variant="ghost" onPress={() => nav.navigate('Home')} />
        </View>}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.lg }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.warningSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file-search-outline" size={44} color={colors.warning} />
          </View>
          <Text variant="h1" style={{ textAlign: 'center' }}>No pre-qualified offer found</Text>
          <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
            We couldn't find a {PRODUCTS[product].label.toLowerCase()} offer for {maskMobile(mobile)}.
          </Text>
        </View>
        <Banner tone="info" title="Why this happens" body="Right now, instant offers are only for existing IDFC FIRST customers. New-to-bank customers can apply through the regular loan journey." />
      </JourneyScreen>
    );
  }

  if (stage === 'otp') {
    return (
      <JourneyScreen assistant="search" footer={<Button label="Verify OTP & check offer" iconRight="arrow-right" onPress={() => verify()} loading={loading} disabled={otp.length !== 6} />}>
        <Illustration icon="shield-check-outline" />
        <View style={{ gap: space.xs }}>
          <Text variant="h1" style={{ textAlign: 'center' }}>Customer consent</Text>
          <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
            We've sent a 6-digit OTP to <Text variant="bodyStrong">{maskMobile(mobile)}</Text>. Ask the customer to read it out to confirm they consent to checking their offer.
          </Text>
        </View>
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setErr(null); if (v.length === 6 && !loading) verify(v); /* auto-submit */ }} error={!!otpErr} />
        {otpErr ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{otpErr}</Text>
          : <Text variant="caption" color={colors.textSecondary}>{otp.length ? `${otp.length}/6 digits` : 'Checks the offer automatically at the 6th digit.'}</Text>}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <PressableScale onPress={() => setStage('enter')} accessibilityRole="button" style={{ minHeight: touch.min, justifyContent: 'center' }}>
            <Text variant="label" color={colors.primary}>Change number</Text>
          </PressableScale>
          <PressableScale disabled={resendIn > 0} onPress={sendOtp} accessibilityRole="button" style={{ minHeight: touch.min, justifyContent: 'center' }}>
            <Text variant="label" color={resendIn > 0 ? colors.textSecondary : colors.primary}>{resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, '0')}` : 'Resend OTP'}</Text>
          </PressableScale>
        </View>
        <Banner tone="info" icon="lock-outline" title="Privacy safeguard" body="Offers are only shown after the customer confirms with an OTP, so a mobile number alone never reveals their offer." />
      </JourneyScreen>
    );
  }

  return (
    <JourneyScreen assistant="search" footer={
      <View style={{ gap: space.xs }}>
        <Button label="Send consent OTP" iconRight="arrow-right" onPress={sendTap} loading={loading} disabled={isDealerOwn} accessibilityHint="Sends by itself once the 10-digit number is complete" />
        <PressableScale onPress={() => nav.navigate('ScanQr')} accessibilityRole="button" accessibilityLabel="Scan customer QR instead"
          style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
          <Icon name="qrcode-scan" size={20} color={colors.primary} />
          <Text variant="bodyStrong" color={colors.primary}>Scan Customer QR instead</Text>
        </PressableScale>
      </View>}>
      <Illustration icon="cellphone-lock" />
      <View style={{ gap: space.xs }}>
        <Text variant="h1" style={{ textAlign: 'center' }}>Search Pre-Qualified Offers</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Enter the customer's bank registered mobile number to check for a Pre-Qualified Offer</Text>
      </View>
      <Field
        label="Customer's Mobile Number" prefix="+91" placeholder="Enter 10-digit mobile number" keyboardType="number-pad" maxLength={10}
        value={mobile} onChangeText={(t) => { const d = t.replace(/\D/g, ''); setMobile(d); autoSend.typed(validMobile(d)); }} onBlur={() => setTouched(true)} error={mobileErr}
        hint={`${mobile.length}/10 digits${SHOW_DEV_UI ? ' · Demo: ends 0000 → no offer · 9999 → network error · ETB on file: 5555 KYC, 6666 mandate, 7777 both' : ''}`}
        right={valid ? <Icon name="check-circle" size={22} color={colors.successBright} style={{ marginRight: space.md }} /> : undefined}
      />
      {isDealerOwn && (
        <Banner tone="warning" icon="account-alert-outline" title="That's your dealer number"
          body={`${maskMobile(mobile)} is registered to ${session?.name}. Enter the customer's own bank-registered mobile so the consent OTP reaches them.`} />
      )}
      {!features.selfServeLink ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, opacity: 0.6 }}>
          <Icon name="link-variant" size={18} color={colors.textSecondary} />
          <Text variant="caption" color={colors.textSecondary}>Send self-serve link to customer · Coming soon</Text>
        </View>
      ) : (
        <Button label="Send self-serve link to customer" variant="secondary" icon="link-variant" onPress={() => { setTouched(true); if (valid) haptic.success(); }} />
      )}
    </JourneyScreen>
  );
}

export function Illustration({ icon }: { icon: React.ComponentProps<typeof Icon>['name'] }) {
  return (
    <View style={{ alignSelf: 'center', width: 112, height: 112, borderRadius: radius.xl, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginTop: space.xs }}>
      <Icon name={icon} size={56} color={colors.primary} />
    </View>
  );
}
