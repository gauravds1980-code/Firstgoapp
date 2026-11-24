import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { useSwipeBack } from '../navigation/useSwipeBack';
import { useZippyTip } from '../components/assistant/tips';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Field, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { UPI_MANDATE_EMI_CAP } from '../config/phases';
import { ProductId, termsFor } from '../config/products';
import { WaiverMotion } from '../components/motion/WaiverMotion';
import { mandate } from '../services';
import type { MandateResponse, Result } from '../services/types';
import { rid } from '../services/mock';
import { MandateMode, useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { emi, inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { SHOW_DEV_UI } from '../config/devFlags';

/** Simulation: the customer "approves" in their UPI app this long after waiting starts (or on a hidden tap). */
const AUTO_APPROVE_MS = 6000;
/** Success beat before auto-advancing to e-sign. */
const SUCCESS_BEAT_MS = 1000;
/** Shown as the request validity on the waiting card. */
const REQUEST_VALID_S = 5 * 60;
/** Demo payer returned by the customer's PSP in Scan & Setup (no VPA typed by the dealer). */
const DEMO_PAYER_VPA = 'rahul.sharma@okidfc';

const EMI_NOTE: Record<ProductId, string> = {
  twoWheeler: 'Two-wheeler loan EMI',
  car: 'Car loan EMI',
  cv: 'Commercial vehicle loan EMI',
};

/** UPI AutoPay Scan & Setup sub-step: QR on screen → waiting for PIN approval → created (auto-advance). */
type UpiStep = 'qr' | 'waiting' | 'success';

export default function MandateScreen() {
  const nav = useNavigation();
  const { journey, product, update, features } = useApp();
  const t = termsFor(product, journey.condition);
  const monthly = Math.ceil(emi(journey.loan, t.annualRate, journey.tenure));
  const overCap = monthly > UPI_MANDATE_EMI_CAP;
  const mvp2 = features.debitCardMandate || features.netBankingMandate;
  const [mode, setMode] = useState<MandateMode>(overCap && mvp2 ? 'debitCard' : 'upi');
  const [vpa, setVpa] = useState(DEMO_PAYER_VPA);
  const [useVpa, setUseVpa] = useState(false); // secondary: collect request to a typed UPI ID
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [upiStep, setUpiStep] = useState<UpiStep>('qr');
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const maxAmt = Math.ceil((monthly * 1.5) / 100) * 100;
  const [{ start, end, ref }] = useState(() => {
    const s0 = new Date();
    const e0 = new Date(s0); e0.setMonth(e0.getMonth() + journey.tenure + 3);
    return { start: s0, end: e0, ref: rid('IDFCMDT', 10) };
  });
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const done = !!journey.mandate;
  const upiBlocked = mode === 'upi' && overCap;
  const upiFlow = mode === 'upi' && !overCap;
  const uri = useMemo(() => mandate.buildUpiMandateUri({ emi: monthly, maxAmount: maxAmt, start, end, note: EMI_NOTE[product], ref }), [monthly, maxAmt, start, end, product, ref]);

  // ETB waiver: an active mandate already covers this EMI → animate, record, auto-advance.
  const onFile = journey.offer.waivers.mandateOnFile;
  const covers = !!onFile && monthly <= onFile.maxAmount;
  const advanced = useRef(false);
  useZippyTip(onFile && covers && !journey.mandate ? '' : null);
  useZippyMood(loading || upiStep === 'waiting' ? 'thinking' : done ? 'happy' : null);
  useSwipeBack(!(onFile && covers && !journey.mandate)); // iOS: no swipe-back mid waiver animation
  const sec = useSectionTracker<'mode' | 'details'>('mode');
  const vpaBad = upiFlow && useVpa && !mandate.VPA_REGEX.test(vpa.trim());
  useZippyPending(done || (onFile && covers) || upiStep !== 'qr' ? [] : [
    ...(upiBlocked && !mvp2 ? [{ id: 'cap', label: 'EMI is above the UPI AutoPay cap', detail: 'Go back and extend tenure or lower the amount.', actionLabel: 'Change tenure', onAction: () => nav.navigate('Asset') }] : []),
    ...(vpaBad ? [{ id: 'vpa', label: "Customer's UPI ID", detail: 'Enter a valid UPI ID, e.g. name@okhdfc — or switch back to the QR.' }] : []),
    ...(upiFlow && !vpaBad ? [{ id: 'mandate', label: 'AutoPay mandate not set up yet', detail: 'Customer scans the QR (or you tap Open UPI app) and approves with their UPI PIN.' }] : []),
  ]);

  // Waiting: visible timer + simulated approval. The NPCI create call runs from the start of waiting.
  const pending = useRef<Promise<Result<MandateResponse>> | null>(null);
  const confirmed = useRef(false);
  const leaving = useRef(false);
  useEffect(() => {
    if (upiStep !== 'waiting') return;
    setElapsed(0);
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    const auto = setTimeout(() => { approve(); }, AUTO_APPROVE_MS);
    return () => { clearInterval(tick); clearTimeout(auto); };
  }, [upiStep]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(tm);
  }, [toast]);

  const finishOk = (data: MandateResponse, m: MandateMode) => {
    haptic.success(); update({ mandate: { ...data, mode: m } });
    if (m === 'upi') setUpiStep('success');
    setAdvancing(true);
    setTimeout(() => { if (!leaving.current) { leaving.current = true; nav.navigate('Esign'); } }, SUCCESS_BEAT_MS); // auto-advance — no Continue / Next (KFS goes with the e-sign link)
  };

  const beginWaiting = () => {
    setErr(''); confirmed.current = false;
    pending.current = mandate.createUpiMandate({ payerVpa: useVpa ? vpa.trim() : DEMO_PAYER_VPA, amountMax: maxAmt, frequency: 'MONTHLY', startDate: start.toISOString(), endDate: end.toISOString(), purpose: '14', loanApplicationNumber: journey.offer.loanApplicationNumber }, monthly);
    setUpiStep('waiting');
  };

  const approve = async () => {
    if (confirmed.current || !pending.current) return;
    confirmed.current = true;
    const r = await pending.current;
    if (!r.ok) { haptic.error(); setErr(r.message); setUpiStep('qr'); return; }
    finishOk(r.data, 'upi');
  };

  // v1.2.8: dealer-facing "Simulate successful mandate" on the Scan & Setup QR (every build, like
  // "Simulate successful scan"). Same NPCI create call as a real Scan & Setup, then the real approve /
  // finishOk path: success card renders, then the usual auto-advance to e-sign.
  const [simulating, setSimulating] = useState(false);
  const simulateMandate = async () => {
    if (simulating || done || upiBlocked) return;
    setSimulating(true); setErr(''); confirmed.current = false;
    pending.current = mandate.createUpiMandate({ payerVpa: DEMO_PAYER_VPA, amountMax: maxAmt, frequency: 'MONTHLY', startDate: start.toISOString(), endDate: end.toISOString(), purpose: '14', loanApplicationNumber: journey.offer.loanApplicationNumber }, monthly);
    try { await approve(); } finally { setSimulating(false); }
  };

  const openUpiApp = async () => {
    try {
      await Linking.openURL(uri);
      beginWaiting();
    } catch {
      haptic.error(); setToast('No UPI app on this phone. Ask the customer to scan the QR with their UPI app.');
    }
  };

  const createEnach = async () => {
    if (mode === 'upi') return;
    setLoading(true); setErr('');
    const r = await mandate.createEnachMandate(mode);
    setLoading(false);
    if (!r.ok) { haptic.error(); setErr(r.message); return; }
    finishOk(r.data, mode);
  };

  if (onFile && covers && !journey.mandate) {
    const finish = () => {
      if (advanced.current) return; advanced.current = true;
      update({ mandate: { umn: onFile.umn, status: 'ACTIVE', payerVpa: onFile.payerVpa, mode: 'upi', existing: true } });
      nav.navigate('Esign');
    };
    return (
      <JourneyScreen step="mandate" interstitial="Checking bank records" assistant="mandate" showTerms={false}>
        <WaiverMotion title="Mandate already active, step skipped"
          subtitle={`An existing UPI AutoPay mandate (up to ${inr(onFile.maxAmount)}/month) covers this EMI of ${inr(monthly)}.`}
          items={[{ icon: 'bank-check', title: 'AutoPay mandate on file', detail: `UMN ••${onFile.umn.split('@')[0]!.slice(-4)} · since ${onFile.registeredOn}` }]} onDone={finish} />
      </JourneyScreen>
    );
  }

  // Footer: never a Continue / Next on waiting or success — both auto-advance.
  const footer = done || upiStep !== 'qr' ? undefined
    : mode !== 'upi' ? <Button label="Set up e-mandate" icon="bank" onPress={createEnach} loading={loading} />
    : useVpa ? <Button label={err ? 'Send UPI AutoPay request again' : 'Send UPI AutoPay request'} icon="send" onPress={beginWaiting} disabled={upiBlocked || vpaBad} />
    : <Button label={err ? 'Try Scan & Setup again' : 'Start Scan & Setup'} icon="qrcode-scan" onPress={beginWaiting} disabled={upiBlocked}
        accessibilityHint="Customer has scanned the QR; waits for their UPI PIN approval" />;

  return (
    <JourneyScreen step="mandate" assistant="mandate" onScroll={sec.onScroll} footer={footer}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Repayment mandate</Text>
        <Text variant="body" color={colors.textSecondary}>Set up auto-debit for the monthly EMI of <Text variant="bodyStrong">{inr(monthly)}</Text>.</Text>
      </View>

      {upiStep === 'qr' && !done && (
        <View style={{ gap: space.sm }} onLayout={sec.at('mode')}>
          <ModeRow on={mode === 'upi'} icon="contactless-payment" title="UPI AutoPay" sub={overCap ? `Not available — EMI above ${inr(UPI_MANDATE_EMI_CAP)} cap` : `NPCI Scan & Setup · EMI up to ${inr(UPI_MANDATE_EMI_CAP)}`} disabled={overCap} onPress={() => setMode('upi')} />
          <ModeRow on={mode === 'debitCard'} icon="credit-card-outline" title="Debit card e-mandate" sub={features.debitCardMandate ? 'NPCI API e-NACH' : 'Coming soon'} disabled={!features.debitCardMandate} onPress={() => setMode('debitCard')} />
          <ModeRow on={mode === 'netBanking'} icon="bank-outline" title="Net banking e-mandate" sub={features.netBankingMandate ? 'NPCI API e-NACH' : 'Coming soon'} disabled={!features.netBankingMandate} onPress={() => setMode('netBanking')} />
        </View>
      )}

      {overCap && !mvp2 && (
        <Banner tone="danger" title="This EMI is above the UPI AutoPay limit"
          body={`EMI ${inr(monthly)} is above the ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay limit. Debit card / net banking e-mandates are coming soon — go back and extend the tenure or lower the amount to proceed today.`} />
      )}
      {overCap && !mvp2 && <Button label="Change tenure / amount" variant="secondary" icon="arrow-left" onPress={() => nav.navigate('Asset')} />}

      {err ? <Banner tone="danger" title="Mandate not created" body={err} /> : null}

      {upiFlow && !done && (
        <View onLayout={sec.at('details')} style={{ gap: space.lg }}>
          {/* 1. Summary */}
          <Card style={{ gap: space.xxs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="label" color={colors.textSecondary}>MANDATE SUMMARY</Text><Pill label="UPI AutoPay" tone="brand" />
            </View>
            <ReadOnlyRow label="Lender" value="IDFC FIRST Bank" />
            <ReadOnlyRow label="EMI amount" value={inr(monthly)} strong />
            <ReadOnlyRow label="Frequency" value="Monthly" />
            <ReadOnlyRow label="Start date" value={fmt(start)} />
            <ReadOnlyRow label="End date" value={fmt(end)} />
            <ReadOnlyRow label="Max debit amount" value={inr(maxAmt)} />
          </Card>

          {/* 2–3. Scan & Setup QR + Open UPI app */}
          {upiStep === 'qr' && !useVpa && (
            <Card style={{ gap: space.sm, alignItems: 'center' }}>
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="h3">Scan & Setup</Text>{SHOW_DEV_UI && <Pill label="Demo QR" tone="warning" />}
              </View>
              <Text variant="body" color={colors.textSecondary} style={{ alignSelf: 'stretch' }}>Customer scans this with any UPI app and approves AutoPay with their UPI PIN.</Text>
              <View accessible accessibilityRole="image" accessibilityLabel={`UPI AutoPay mandate QR. EMI ${inr(monthly)} monthly, up to ${inr(maxAmt)}.`}
                style={{ padding: space.sm, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, backgroundColor: '#fff' }}>
                <QRCode value={uri} size={208} color={colors.text} backgroundColor="#fff" ecl="M" />
              </View>
              {SHOW_DEV_UI && <Text variant="caption" color={colors.warning} style={{ textAlign: 'center' }}>Demo mandate QR · prototype only, not a live collect. Payee {mandate.DEMO_PAYEE_VPA}</Text>}
              <Button label="Open UPI app" variant="secondary" icon="cellphone-arrow-down" onPress={openUpiApp} style={{ alignSelf: 'stretch' }}
                accessibilityHint="Opens a UPI app on this phone with the same AutoPay mandate" />
              <Button label="Simulate successful mandate" variant="secondary" icon="check-decagram-outline" onPress={simulateMandate} loading={simulating} disabled={upiBlocked}
                style={{ alignSelf: 'stretch' }} accessibilityHint="Creates the AutoPay mandate as if the customer approved it with their UPI PIN" />
              {toast ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite"
                  style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.textStrong, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs }}>
                  <Icon name="information-outline" size={18} color="#fff" />
                  <Text variant="caption" color="#fff" style={{ flex: 1 }}>{toast}</Text>
                </View>
              ) : null}
            </Card>
          )}

          {upiStep === 'qr' && useVpa && (
            <Field label="Customer's UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="name@bank"
              error={vpa && !mandate.VPA_REGEX.test(vpa.trim()) ? 'Enter a valid UPI ID, e.g. name@okhdfc' : undefined}
              hint={`Sends a collect request to this UPI ID.${SHOW_DEV_UI ? " Demo: an ID starting with 'fail' is declined." : ''}`} />
          )}
          {upiStep === 'qr' && (
            <PressableScale onPress={() => { setUseVpa((v) => !v); setErr(''); }} accessibilityRole="button"
              accessibilityLabel={useVpa ? 'Show the Scan and Setup QR' : 'Send a request to a UPI ID instead'}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name={useVpa ? 'qrcode' : 'at'} size={20} color={colors.primary} />
              <Text variant="bodyStrong" color={colors.primary}>{useVpa ? 'Back to Scan & Setup QR' : 'Or send a request to a UPI ID'}</Text>
            </PressableScale>
          )}

          {/* 4. Waiting (hidden tap on the card = customer approved, for demos) */}
          {upiStep === 'waiting' && (
            <Pressable onPress={approve} accessible={false}>
              <Card style={{ gap: space.sm, alignItems: 'center', borderColor: colors.cta, backgroundColor: colors.ctaTint }}>
                <ActivityIndicator color={colors.primary} />
                <Text variant="h3" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">Waiting for approval in your UPI app</Text>
                <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Customer opens the AutoPay request and enters their UPI PIN.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }} accessible accessibilityLabel={`Waiting ${elapsed} seconds`}>
                  <Icon name="timer-sand" size={18} color={colors.ctaDark} />
                  <Text variant="bodyStrong" color={colors.ctaDark} style={{ fontVariant: ['tabular-nums'] }}>{mmss(elapsed)}</Text>
                  <Text variant="caption" color={colors.textSecondary}>· request valid {mmss(Math.max(0, REQUEST_VALID_S - elapsed))}</Text>
                </View>
              </Card>
            </Pressable>
          )}

          {/* 5. PIN + pre-debit note */}
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md, backgroundColor: colors.primaryTint }}>
            <Icon name="shield-lock-outline" size={22} color={colors.primary} />
            <Text variant="caption" style={{ flex: 1 }}>The customer approves once with their UPI PIN. They get a pre-debit notification 24 hours before each EMI.</Text>
          </View>
        </View>
      )}

      {mode !== 'upi' && !done && (
        <View onLayout={sec.at('details')}>
          <Card style={{ gap: space.xxs }}>
            <Text variant="label" color={colors.textSecondary}>MANDATE DETAILS</Text>
            <ReadOnlyRow label="Max debit amount" value={inr(maxAmt)} />
            <ReadOnlyRow label="Frequency" value="Monthly" />
            <ReadOnlyRow label="Valid from" value={fmt(start)} />
            <ReadOnlyRow label="Valid till" value={fmt(end)} />
            <ReadOnlyRow label="Purpose" value="Loan EMI" />
          </Card>
        </View>
      )}

      {done && journey.mandate && (
        <Card style={{ gap: space.xs, borderColor: colors.successBright, backgroundColor: colors.successSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-decagram" size={24} color={colors.success} />
            <Text variant="h3" color={colors.success} accessibilityLiveRegion="polite">{journey.mandate.existing ? 'Existing mandate linked' : 'Mandate created successfully'}</Text>
          </View>
          <ReadOnlyRow label={journey.mandate.mode === 'upi' ? 'UMRN' : 'Mandate ref'} value={journey.mandate.umn} />
          <ReadOnlyRow label="Payer" value={journey.mandate.payerVpa} />
          <Text variant="caption" color={colors.textSecondary}>Customer gets a pre-debit notification 24 hours before each EMI.</Text>
          <Text variant="caption" color={colors.textSecondary}>{advancing ? 'Opening e-sign…' : 'Next: e-sign.'} The KFS goes to the customer with the e-sign link.</Text>
        </Card>
      )}
    </JourneyScreen>
  );
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function ModeRow({ on, icon, title, sub, disabled, onPress }: { on: boolean; icon: React.ComponentProps<typeof Icon>['name']; title: string; sub: string; disabled?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} accessibilityLabel={`${title}. ${sub}`}
      style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface }}>
      <Icon name={on ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={on ? colors.primary : colors.textSecondary} />
      <Icon name={icon} size={24} color={colors.text} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color={disabled ? colors.textMuted : colors.textSecondary}>{sub}</Text>
      </View>
    </PressableScale>
  );
}
