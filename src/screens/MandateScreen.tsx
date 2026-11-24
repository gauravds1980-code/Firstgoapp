import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { useSwipeBack } from '../navigation/useSwipeBack';
import { useZippyTip } from '../components/assistant/tips';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Icon, Pill, ReadOnlyRow, Text } from '../components/ui';
import { UPI_MANDATE_EMI_CAP } from '../config/phases';
import { ProductId, termsFor } from '../config/products';
import { WaiverMotion } from '../components/motion/WaiverMotion';
import { mandate } from '../services';
import type { UpiMandateRequest } from '../services/mandate';
import type { MandateRequest, MandateResponse } from '../services/types';
import { rid } from '../services/mock';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { emi, inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { SHOW_DEV_UI } from '../config/devFlags';

/** Success beat before auto-advancing to e-sign. */
const SUCCESS_BEAT_MS = 1000;
/** How often the app asks the bank whether the customer approved the AutoPay request. */
const POLL_MS = 2000;
/** Demo payer returned by the customer's PSP in Scan & Setup (no VPA typed by the dealer). */
const DEMO_PAYER_VPA = 'rahul.sharma@okidfc';
const QR_SIZE = 208;

const EMI_NOTE: Record<ProductId, string> = {
  twoWheeler: 'Two-wheeler loan EMI',
  car: 'Car loan EMI',
  cv: 'Commercial vehicle loan EMI',
};

/**
 * v1.2.9: UPI AutoPay is the only mandate method. The Scan & Setup request (QR) is raised on mount and
 * the app waits for approval by itself (no Start button):
 *   creating → waiting (QR + live timer, polling) → success (~1 s beat, haptic) → e-sign.
 *   creating / waiting → error (declined / expired / create failed) → "Refresh QR" raises a new request.
 */
type QrState =
  | { kind: 'creating' }
  | { kind: 'waiting'; req: UpiMandateRequest }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export default function MandateScreen() {
  const nav = useNavigation();
  const focused = useIsFocused();
  const { journey, product, update } = useApp();
  const t = termsFor(product, journey.condition);
  const monthly = Math.ceil(emi(journey.loan, t.annualRate, journey.tenure));
  const overCap = monthly > UPI_MANDATE_EMI_CAP;
  const [toast, setToast] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [qr, setQr] = useState<QrState>({ kind: 'creating' });
  const [attempt, setAttempt] = useState(0); // bump → raise a fresh request (Refresh QR)
  const [now, setNow] = useState(() => Date.now());
  const maxAmt = Math.ceil((monthly * 1.5) / 100) * 100;
  const [{ start, end, ref }] = useState(() => {
    const s0 = new Date();
    const e0 = new Date(s0); e0.setMonth(e0.getMonth() + journey.tenure + 3);
    return { start: s0, end: e0, ref: rid('IDFCMDT', 10) };
  });
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const done = !!journey.mandate;
  const uri = useMemo(() => mandate.buildUpiMandateUri({ emi: monthly, maxAmount: maxAmt, start, end, note: EMI_NOTE[product], ref }), [monthly, maxAmt, start, end, product, ref]);

  // ETB waiver: an active mandate already covers this EMI → animate, record, auto-advance.
  const onFile = journey.offer.waivers.mandateOnFile;
  const covers = !!onFile && monthly <= onFile.maxAmount;
  const waiver = !!onFile && covers && !journey.mandate;
  /** The QR flow runs only when there is a mandate to set up and UPI AutoPay can cover the EMI. */
  const qrFlow = !done && !waiver && !overCap;
  const advanced = useRef(false);
  useZippyTip(waiver ? '' : null);
  useZippyMood(qrFlow && (qr.kind === 'creating' || qr.kind === 'waiting') ? 'thinking' : done ? 'happy' : null);
  useSwipeBack(!waiver); // iOS: no swipe-back mid waiver animation
  const sec = useSectionTracker<'qr' | 'summary'>('qr');
  useZippyPending(!qrFlow || qr.kind === 'success' ? (overCap && !done && !waiver ? [
    { id: 'cap', label: 'EMI is above the UPI AutoPay cap', detail: 'Go back and extend tenure or lower the amount.', actionLabel: 'Change tenure', onAction: () => nav.navigate('Asset') },
  ] : []) : qr.kind === 'error' ? [
    { id: 'qr', label: 'AutoPay QR needs a refresh', detail: qr.message, actionLabel: 'Refresh QR', onAction: () => refresh() },
  ] : [
    { id: 'mandate', label: 'Waiting for the customer to approve AutoPay', detail: 'Customer scans the QR (or you tap Open UPI app) and approves with their UPI PIN.' },
  ]);

  const mounted = useRef(true);
  const leaving = useRef(false);
  const finished = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { mounted.current = false; if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const mandateReq = useCallback((): MandateRequest => ({
    payerVpa: DEMO_PAYER_VPA, amountMax: maxAmt, frequency: 'MONTHLY', startDate: start.toISOString(), endDate: end.toISOString(), purpose: '14',
    loanApplicationNumber: journey.offer.loanApplicationNumber,
  }), [maxAmt, start, end, journey.offer.loanApplicationNumber]);

  const finishOk = (data: MandateResponse) => {
    if (finished.current) return; // one success per screen (poll + Simulate can race)
    finished.current = true;
    haptic.success(); update({ mandate: { ...data, mode: 'upi' } });
    setQr({ kind: 'success' });
    setAdvancing(true);
    // Auto-advance after the success beat — no Continue / Next (KFS goes with the e-sign link).
    advanceTimer.current = setTimeout(() => { if (mounted.current && !leaving.current) { leaving.current = true; nav.navigate('Esign'); } }, SUCCESS_BEAT_MS);
  };
  const finishRef = useRef(finishOk);
  finishRef.current = finishOk;

  // 1. Raise the Scan & Setup request as soon as the screen opens (and again on Refresh QR).
  useEffect(() => {
    if (!qrFlow) return;
    let cancelled = false;
    setQr({ kind: 'creating' });
    mandate.requestUpiMandate(mandateReq(), monthly).then((r) => {
      if (cancelled || finished.current) return;
      if (!r.ok) { haptic.error(); setQr({ kind: 'error', message: r.message }); return; }
      setQr({ kind: 'waiting', req: r.data });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFlow, attempt]);

  // 2. Wait for approval: poll while focused; stop on success / error / blur / unmount.
  const waitingReq = qr.kind === 'waiting' ? qr.req : null;
  const pollOnce = useCallback(async (req: UpiMandateRequest) => {
    const r = await mandate.pollUpiMandate(req.requestId);
    if (!mounted.current || finished.current) return;
    if (!r.ok) { haptic.error(); setQr((q) => (q.kind === 'waiting' && q.req.requestId === req.requestId ? { kind: 'error', message: r.message } : q)); return; }
    const st = r.data;
    if (st.status === 'ACTIVE') finishRef.current(st.mandate);
    else if (st.status !== 'PENDING') { haptic.error(); setQr((q) => (q.kind === 'waiting' && q.req.requestId === req.requestId ? { kind: 'error', message: st.message } : q)); }
  }, []);
  useEffect(() => {
    if (!waitingReq || !focused) return;
    let inFlight = false;
    const tick = () => { if (inFlight) return; inFlight = true; void pollOnce(waitingReq).finally(() => { inFlight = false; }); };
    const poll = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [waitingReq, focused, pollOnce]);

  const refresh = () => { if (finished.current) return; haptic.select(); setAttempt((a) => a + 1); };

  // v1.2.8+: dealer-facing "Simulate successful mandate" (every build, like "Simulate successful scan").
  // Marks the pending request approved, then runs the same poll → finishOk path as a real approval.
  const [simulating, setSimulating] = useState(false);
  const simulateMandate = async () => {
    if (simulating || done || overCap || finished.current) return;
    setSimulating(true);
    try {
      let req = qr.kind === 'waiting' ? qr.req : null;
      if (!req) { // QR still loading or failed: raise a request first
        const r = await mandate.requestUpiMandate(mandateReq(), monthly);
        if (!mounted.current || finished.current) return;
        if (!r.ok) { haptic.error(); setQr({ kind: 'error', message: r.message }); return; }
        req = r.data;
      }
      mandate.simulateUpiMandateApproval(req.requestId, DEMO_PAYER_VPA);
      await pollOnce(req);
    } finally { if (mounted.current) setSimulating(false); }
  };

  const openUpiApp = async () => {
    try {
      await Linking.openURL(uri); // the app is already waiting for approval
    } catch {
      haptic.error(); setToast('No UPI app on this phone. Ask the customer to scan the QR with their UPI app.');
    }
  };
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(tm);
  }, [toast]);

  if (waiver && onFile) {
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

  const elapsed = waitingReq ? Math.max(0, Math.floor((now - waitingReq.createdAt) / 1000)) : 0;
  const left = waitingReq ? Math.max(0, Math.ceil((waitingReq.expiresAt - now) / 1000)) : 0;

  // No footer: the QR flow waits and advances by itself. Controls live in the QR card.
  return (
    <JourneyScreen step="mandate" assistant="mandate" onScroll={sec.onScroll}>
      {qrFlow && qr.kind !== 'success' && (
        <View onLayout={sec.at('qr')}>
          <Card style={{ gap: space.sm, alignItems: 'center' }}>
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.xs }}>
              <Text variant="h3" style={{ flexShrink: 1 }}>UPI AutoPay QR</Text>{SHOW_DEV_UI && <Pill label="Demo QR" tone="warning" />}
            </View>
            <Text variant="body" color={colors.textSecondary} style={{ alignSelf: 'stretch' }}>Ask the customer to scan with any UPI app and approve AutoPay with their UPI PIN.</Text>
            <View accessible accessibilityRole="image"
              accessibilityLabel={qr.kind === 'waiting' ? `UPI AutoPay mandate QR. EMI ${inr(monthly)} monthly, up to ${inr(maxAmt)}.` : qr.kind === 'creating' ? 'Preparing the AutoPay QR' : 'AutoPay QR not available'}
              style={{ padding: space.sm, borderRadius: radius.lg, borderWidth: 2, borderColor: qr.kind === 'error' ? colors.danger : colors.primary, backgroundColor: '#fff' }}>
              {qr.kind === 'waiting' ? <QRCode value={uri} size={QR_SIZE} color={colors.text} backgroundColor="#fff" ecl="M" />
                : (
                  <View style={{ width: QR_SIZE, height: QR_SIZE, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
                    {qr.kind === 'creating'
                      ? <><ActivityIndicator color={colors.primary} /><Text variant="caption" color={colors.textSecondary}>Preparing QR…</Text></>
                      : <><Icon name="qrcode-remove" size={48} color={colors.danger} /><Text variant="caption" color={colors.danger}>QR not active</Text></>}
                  </View>
                )}
            </View>
            {qr.kind === 'waiting' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: space.xs }} accessible
                accessibilityLiveRegion="polite" accessibilityLabel={`Waiting for the customer's approval. QR valid for ${Math.ceil(left / 60)} more minutes`}>
                <ActivityIndicator size="small" color={colors.ctaDark} />
                <Text variant="bodyStrong" color={colors.ctaDark}>Waiting for approval</Text>
                <Text variant="caption" color={colors.textSecondary} style={{ fontVariant: ['tabular-nums'] }}>{mmss(elapsed)} · valid {mmss(left)}</Text>
              </View>
            )}
            {qr.kind === 'error' && (
              <>
                <Banner tone="danger" title="Mandate not created" body={qr.message} />
                <Button label="Refresh QR" icon="refresh" onPress={refresh} style={{ alignSelf: 'stretch' }} accessibilityHint="Raises a new AutoPay request and waits for approval again" />
              </>
            )}
            {SHOW_DEV_UI && <Text variant="caption" color={colors.warning} style={{ textAlign: 'center' }}>Demo mandate QR · prototype only, not a live collect. Payee {mandate.DEMO_PAYEE_VPA}</Text>}
            {qr.kind === 'waiting' && (
              <Button label="Open UPI app" variant="secondary" icon="cellphone-arrow-down" onPress={openUpiApp} style={{ alignSelf: 'stretch' }}
                accessibilityHint="Opens a UPI app on this phone with the same AutoPay mandate" />
            )}
            <Button label="Simulate successful mandate" variant="secondary" icon="check-decagram-outline" onPress={simulateMandate} loading={simulating}
              style={{ alignSelf: 'stretch' }} accessibilityHint="Creates the AutoPay mandate as if the customer approved it with their UPI PIN" />
            {toast ? (
              <View accessibilityRole="alert" accessibilityLiveRegion="polite"
                style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.textStrong, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs }}>
                <Icon name="information-outline" size={18} color="#fff" />
                <Text variant="caption" color="#fff" style={{ flex: 1 }}>{toast}</Text>
              </View>
            ) : null}
          </Card>
        </View>
      )}

      {done && journey.mandate && (
        <Card style={{ gap: space.xs, borderColor: colors.successBright, backgroundColor: colors.successSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-decagram" size={24} color={colors.success} />
            <Text variant="h3" color={colors.success} accessibilityLiveRegion="polite" style={{ flexShrink: 1 }}>{journey.mandate.existing ? 'Existing mandate linked' : 'Mandate created successfully'}</Text>
          </View>
          <ReadOnlyRow label="UMRN" value={journey.mandate.umn} />
          <ReadOnlyRow label="Payer" value={journey.mandate.payerVpa} />
          <Text variant="caption" color={colors.textSecondary}>Customer gets a pre-debit notification 24 hours before each EMI.</Text>
          <Text variant="caption" color={colors.textSecondary}>{advancing ? 'Opening e-sign…' : 'Next: e-sign.'} The KFS goes to the customer with the e-sign link.</Text>
        </Card>
      )}

      {overCap && !done && (
        <>
          <Banner tone="danger" title="This EMI is above the UPI AutoPay limit"
            body={`EMI ${inr(monthly)} is above the ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay limit. Go back and extend the tenure or lower the amount.`} />
          <Button label="Change tenure / amount" variant="secondary" icon="arrow-left" onPress={() => nav.navigate('Asset')} />
        </>
      )}

      {!done && (
        <View onLayout={sec.at('summary')} style={{ gap: space.lg }}>
          <Card style={{ gap: space.xxs }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.xs }}>
              <Text variant="label" color={colors.textSecondary} style={{ flexShrink: 1 }}>MANDATE SUMMARY</Text>
            </View>
            {/* Single method: a plain label, not a radio. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xxs }} accessible accessibilityLabel="Method: UPI AutoPay">
              <Icon name="contactless-payment" size={20} color={colors.primary} />
              <Text variant="bodyStrong">Method: UPI AutoPay</Text>
            </View>
            <ReadOnlyRow label="Lender" value="IDFC FIRST Bank" />
            <ReadOnlyRow label="EMI amount" value={inr(monthly)} strong />
            <ReadOnlyRow label="Frequency" value="Monthly" />
            <ReadOnlyRow label="Start date" value={fmt(start)} />
            <ReadOnlyRow label="End date" value={fmt(end)} />
            <ReadOnlyRow label="Max debit amount" value={inr(maxAmt)} />
          </Card>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md, backgroundColor: colors.primaryTint }}>
            <Icon name="shield-lock-outline" size={22} color={colors.primary} />
            <Text variant="caption" style={{ flex: 1 }}>The customer approves once with their UPI PIN. They get a pre-debit notification 24 hours before each EMI.</Text>
          </View>
        </View>
      )}
    </JourneyScreen>
  );
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
