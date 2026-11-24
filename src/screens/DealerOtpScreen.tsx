import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { AuthScaffold } from '../components/AuthScaffold';
import { Banner, Button, OtpInput, PressableScale, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { MAX_OTP_ATTEMPTS, OTP_COOLDOWN_SEC, requestDealerOtp, verifyDealerOtp } from '../services/auth';
import { useApp } from '../state/AppState';
import { colors, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { maskMobile } from '../utils/finance';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { useUndoSource } from '../voice/voiceUndo';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Guard: a cold deep link without a txn goes back to Login. */
export default function DealerOtpScreen() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'DealerOtp'>>();
  const ok = !!params?.mobile && !!params?.txnId;
  useEffect(() => { if (!ok) nav.navigate('DealerLogin'); }, [ok, nav]);
  return ok ? <DealerOtpForm /> : null;
}

function DealerOtpForm() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'DealerOtp'>>();
  const { signIn } = useApp();
  const [txnId, setTxnId] = useState(params.txnId);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_OTP_ATTEMPTS);
  const [resendIn, setResendIn] = useState(params.resendInSec ?? 30);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (resendIn <= 0 && cooldown <= 0) return;
    const t = setTimeout(() => { setResendIn((s) => Math.max(0, s - 1)); setCooldown((s) => Math.max(0, s - 1)); }, 1000);
    return () => clearTimeout(t);
  }, [resendIn, cooldown]);
  useEffect(() => { if (cooldown === 0 && attemptsLeft === 0) { setAttemptsLeft(MAX_OTP_ATTEMPTS); setErr(null); } }, [cooldown, attemptsLeft]);

  const locked = cooldown > 0;

  // A confirmed voice OTP only fills the boxes; the dealer taps "Verify & log in" themselves.
  // Anything spoken before this screen opened is stale, so drop it first.
  useEffect(() => { voiceDraft.take('otp'); }, []);
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!draft?.slots.otp || locked || loading || !/^\d{4,6}$/.test(draft.slots.otp)) return;
    const code = voiceDraft.take('otp');
    if (code) { setOtp(code.slice(0, 6)); setErr(null); }
  }, [draft, locked, loading]);

  // Voice Undo (auto-filled OTP): put the previous boxes back. Never verifies.
  useUndoSource('otp', () => otp, (v) => { setOtp(v); setErr(null); });

  const verify = async (code = otp) => {
    if (locked || loading || code.length !== 6) return;
    setLoading(true); setErr(null);
    const r = await verifyDealerOtp(txnId, params.mobile, code);
    setLoading(false);
    if (r.ok) {
      haptic.success();
      // Swapping the auth stack for the main stack in RootNavigator resets history: Back can't return here.
      await signIn(r.data);
      return;
    }
    haptic.error();
    const left = attemptsLeft - 1;
    setAttemptsLeft(left);
    setOtp('');
    if (left <= 0) { setCooldown(OTP_COOLDOWN_SEC); setErr(`Too many incorrect attempts. Try again in ${mmss(OTP_COOLDOWN_SEC)}.`); }
    else setErr(`${r.message} ${left} attempt${left === 1 ? '' : 's'} left.`);
  };

  const resend = async () => {
    setResending(true); setErr(null);
    const r = await requestDealerOtp(params.mobile);
    setResending(false);
    if (!r.ok) { setErr(r.message); return; }
    setTxnId(r.data.txnId); setOtp(''); setResendIn(r.data.resendInSec);
  };

  return (
    <AuthScaffold title="Enter OTP" subtitle={`Sent to ${maskMobile(params.mobile)}`}
      footer={<>
        <Button label={locked ? `Try again in ${mmss(cooldown)}` : 'Verify & log in'} icon="login" onPress={() => verify()} loading={loading} disabled={locked || otp.length !== 6} />
        <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Terms and eligibility conditions apply.</Text>
      </>}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Masked only: the full number never sits next to the mask on this screen. */}
        <Text variant="bodyStrong">{maskMobile(params.mobile)}</Text>
        <PressableScale onPress={() => nav.navigate('DealerLogin', { mobile: params.mobile })} accessibilityRole="link" accessibilityLabel="Edit mobile number"
          style={{ minHeight: touch.min, justifyContent: 'center', paddingLeft: space.md }}>
          <Text variant="bodyStrong" color={colors.primary}>Edit number</Text>
        </PressableScale>
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="label">6-digit OTP</Text>
        <OtpInput label="Dealer login OTP" value={otp} disabled={locked || loading} error={!!err}
          onChange={(v) => { setOtp(v); setErr(null); if (v.length === 6) verify(v); }} />
        {err ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">{err}</Text>
          : <Text variant="caption" color={colors.textSecondary}>Auto-fills from SMS. You can also paste the code.</Text>}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="caption" color={colors.textSecondary}>{locked ? 'Locked after 3 wrong attempts' : `${attemptsLeft} of ${MAX_OTP_ATTEMPTS} attempts left`}</Text>
        <PressableScale disabled={resendIn > 0 || resending || locked} onPress={resend} accessibilityRole="button" accessibilityLabel="Resend OTP" style={{ minHeight: touch.min, justifyContent: 'center', paddingLeft: space.md }}>
          <Text variant="bodyStrong" color={resendIn > 0 || locked ? colors.textSecondary : colors.primary}>{resending ? 'Sending…' : resendIn > 0 ? `Resend in ${mmss(resendIn)}` : 'Resend OTP'}</Text>
        </PressableScale>
      </View>
      {locked && <Banner tone="danger" icon="lock-clock" title="Login temporarily locked" body={`For your security, wait ${mmss(cooldown)} before trying again, or request a new OTP after the cooldown.`} />}
    </AuthScaffold>
  );
}
