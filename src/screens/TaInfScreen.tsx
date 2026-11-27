import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { JourneyScreen } from '../components/Screen';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Sheet } from '../components/Sheet';
import { Slider } from '../components/Slider';
import { copyUtr, useToast } from '../components/Toast';
import { Chip, ExampleTag, inrShort } from '../components/business';
import { Button, Card, Field, Icon, Pill, PressableScale, ReadOnlyRow, Segmented, Skeleton, Text } from '../components/ui';
import {
  applyDisburse, applyRepay, applyRepayAmount, availableOf, planRepay, RepayPlan, canDisburse, FacilityType, daysFromToday, dueAfter, drawdownInterest, DRAWDOWN_STEP, dueIn30, fmtDate, Limit, MIN_DRAWDOWN,
  payTranches, requestDrawdown, sumOf, taInfFor, Tranche, TrancheStatus,
} from '../services/business';
import { useApp } from '../state/AppState';
import { saveWcApplication, updateTaInf, useTaInf, useWcApplication } from '../state/stores';
import { ApplySheet, AvailLimit, EnhanceChip, EnhanceSheet, type EnhanceVoice } from '../components/TaInfForms';
import { colors, radius, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { inr } from '../utils/finance';
import { AUTO_ADVANCE_MS } from '../voice/autoAdvance';
import { useAutoAdvance, useVoiceStep } from '../voice/useAutoAdvance';
import { askVoiceConfirm, voiceSay } from '../voice/voiceAsk';
import { useUndoSource } from '../voice/voiceUndo';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { clearVoiceFields, setVoiceFields } from '../voice/voiceOptions';

/** Floating Zippy sits bottom-right: keep the last rows (and their Pay buttons) scrollable clear of it. */
const ZIPPY_CLEARANCE = 96;
const plural = (n: number) => `${n} tranche${n === 1 ? '' : 's'}`;

type Done = { kind: 'disburse' | 'repay'; amount: number; utr: string; count?: number };

/**
 * The dealer's ONE facility (example data): Trade Advance (disburse + repay) or Inventory Funding
 * (OEM draws it on invoice, so repay only). Balances and tranches live in taInfStore, shared with Home.
 */
export default function TaInfScreen() {
  const { profile, session } = useApp();
  const dealerId = session?.dealerId;
  const limit = useTaInf(dealerId, () => taInfFor(profile));
  const { toast, show } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const [enhanceOpen, setEnhanceOpen] = useState(false);
  /** v1.4.5 S2.3: the new limit / reason spoken with "I need an enhancement of 15 lakhs" (filled when the sheet opens). */
  const [enhanceVoice, setEnhanceVoice] = useState<EnhanceVoice>(null);
  /** v1.4.5 voice repay ("pay 80000" → Confirm): the amount-based plan the repay sheet shows (null = tranche picks). */
  const [voicePlan, setVoicePlan] = useState<RepayPlan | null>(null);

  // v1.4.5 voice: utilised / outstanding as the repay field (CONTRACT.md 2.1) so "pay 5 lakh" can offer the full amount.
  const utilised = limit ? limit.utilised : null;
  useFocusEffect(useCallback(() => {
    if (utilised === null) return undefined;
    const token = setVoiceFields([{ id: 'ta-repay', kind: 'amount', label: 'Repay amount', utilised }], 'TaInf');
    return () => clearVoiceFields(token);
  }, [utilised]));

  // v1.4.5 voice: a CONFIRMED TA_REPAY opens the repay sheet pre-filled with the plan (oldest / overdue first,
  // part-payment shown); ENHANCE_TA_LIMIT opens the Enhance sheet. Paying stays a Pay tap or a spoken "yes".
  const draft = useVoiceDraft();
  const focused = useIsFocused();
  useEffect(() => {
    if (!draft || !focused || !limit || (draft.filter !== 'repay' && draft.filter !== 'enhance')) return;
    const d = voiceDraft.consume();
    if (!d) return;
    if (d.filter === 'enhance') {
      if (limit.enhancement) { voiceSay(`An enhancement to ${inr(limit.enhancement.requested)} is already pending.`); return; }
      const v = { ...(d.slots.enhanceAmount !== undefined ? { amount: d.slots.enhanceAmount } : {}), ...(d.slots.enhanceReasonId ? { reasonId: d.slots.enhanceReasonId } : {}) };
      setEnhanceVoice(Object.keys(v).length ? v : null);
      setEnhanceOpen(true);
      return;
    }
    const want = d.slots.repayAll ? 'full' : d.slots.repayAmount;
    if (want === undefined) return;
    const plan = planRepay(limit.tranches, want);
    if (plan.amount <= 0) { voiceSay('Nothing to repay.'); return; }
    setSelected([]);
    setVoicePlan(plan);
    setRepayOpen(true);
  }, [draft, focused, limit]);

  if (limit === null) return <AvailScreen dealerId={dealerId} dealerName={session?.name ?? ''} />;
  const title = limit?.name ?? (profile?.facilityType === 'INF' ? 'Inventory Funding' : 'Trade Advance');
  if (!limit) {
    return (
      <JourneyScreen title={title} assistant="tainf" showTerms={false}>
        <Skeleton h={32} w="60%" />
        <Skeleton h={220} r={radius.lg} />
        <Skeleton h={260} r={radius.lg} />
      </JourneyScreen>
    );
  }

  const isTA = canDisburse(limit);
  const avail = availableOf(limit);
  const unpaidIds = new Set(limit.tranches.filter((t) => t.status !== 'paid').map((t) => t.id));
  const sel = selected.filter((id) => unpaidIds.has(id));
  const selTranches = limit.tranches.filter((t) => sel.includes(t.id));
  const selTotal = sumOf(selTranches);
  const toggle = (id: string) => { haptic.select(); setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const payOne = (id: string) => { setVoicePlan(null); setSelected([id]); setRepayOpen(true); };

  const footer = sel.length > 0 ? (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>{plural(sel.length)} selected</Text>
        <PressableScale onPress={() => setSelected([])} accessibilityRole="button" accessibilityLabel="Clear selection" style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.xs }}>
          <Text variant="label" color={colors.primary}>Clear</Text>
        </PressableScale>
      </View>
      <Button label={`Repay ${plural(sel.length)} · ${inr(selTotal)}`} icon="cash-check" onPress={() => { setVoicePlan(null); setRepayOpen(true); }} />
    </View>
  ) : isTA ? (
    <View style={{ gap: space.xs }}>
      <Button label={`Disburse · ${inr(avail)} available`} icon="bank-transfer-out" disabled={avail < MIN_DRAWDOWN} onPress={() => setDisburseOpen(true)}
        accessibilityHint="Draw down funds from your Trade Advance" />
      {avail < MIN_DRAWDOWN && <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Minimum drawdown is {inr(MIN_DRAWDOWN)}. Repay a tranche to free up funds.</Text>}
    </View>
  ) : undefined;

  return (
    <JourneyScreen title={title} titleInBody assistant="tainf" showTerms={false} footer={footer} toast={toast?.text} toastTone={toast?.tone}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">{limit.name}</Text>
        <ZippyAvoid weight="soft" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          <Text variant="body" color={colors.textSecondary}>{isTA ? 'Trade Advance with IDFC FIRST' : 'Inventory Funding with IDFC FIRST · drawn by your OEM'}</Text>
        </ZippyAvoid>
        <ExampleTag />
      </View>
      {done && (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={22} color={colors.success} />
            <Text variant="bodyStrong" color={colors.success} style={{ flex: 1 }}>
              {done.kind === 'disburse' ? `${inr(done.amount)} disbursed` : `${plural(done.count ?? 1)} repaid · ${inr(done.amount)}`}
            </Text>
            <PressableScale onPress={() => setDone(null)} accessibilityRole="button" accessibilityLabel="Dismiss" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </PressableScale>
          </View>
          <UtrRow utr={done.utr} onCopy={() => copyUtr(done.utr, show)} />
        </Card>
      )}
      <LimitCard l={limit} onEnhance={() => { setEnhanceVoice(null); setEnhanceOpen(true); }} />
      <TrancheList l={limit} selected={sel} onToggle={toggle} onPay={payOne}
        onSelectDue={() => { haptic.select(); setSelected(dueIn30(limit).map((t) => t.id)); }} />
      <View style={{ height: ZIPPY_CLEARANCE }} />

      {isTA && <DisburseSheet visible={disburseOpen} l={limit} account={`${session?.name ?? 'Dealer'} · IDFC FIRST ••4321`} onClose={() => setDisburseOpen(false)}
        onDone={async (amount) => {
          const { utr } = await requestDrawdown(amount);
          updateTaInf(dealerId, (l) => applyDisburse(l, amount).limit);
          haptic.success();
          setDone({ kind: 'disburse', amount, utr });
          return utr;
        }} />}
      <EnhanceSheet visible={enhanceOpen} l={limit} voice={enhanceVoice} onClose={() => { setEnhanceOpen(false); setEnhanceVoice(null); }}
        onSubmitted={(r) => updateTaInf(dealerId, (l) => (l.enhancement ? l : { ...l, enhancement: r }))} />
      <RepaySheet visible={repayOpen} tranches={selTranches} plan={voicePlan} onClose={() => { setRepayOpen(false); setVoicePlan(null); }}
        onConfirm={async (method) => {
          if (voicePlan) {
            // Voice amount plan: same payment call, then the part-payment aware update.
            const ids = voicePlan.lines.map((x) => x.id);
            const { utr } = await payTranches(ids, method);
            let total = 0;
            updateTaInf(dealerId, (l) => { const r = applyRepayAmount(l, voicePlan); total = r.total; return r.limit; });
            haptic.success();
            setVoicePlan(null);
            setRepayOpen(false);
            setDone({ kind: 'repay', amount: total, utr, count: ids.length });
            return;
          }
          const ids = selTranches.map((t) => t.id);
          const { utr } = await payTranches(ids, method);
          let total = 0;
          updateTaInf(dealerId, (l) => { const r = applyRepay(l, ids); total = r.total; return r.limit; });
          haptic.success();
          setSelected([]);
          setRepayOpen(false);
          setDone({ kind: 'repay', amount: total, utr, count: ids.length });
        }} />
    </JourneyScreen>
  );
}

function UtrRow({ utr, onCopy }: { utr: string; onCopy: () => void }) {
  return (
    <PressableScale onPress={onCopy} accessibilityRole="button" accessibilityLabel={`UTR ${utr}. Tap to copy`}
      style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Text variant="caption" color={colors.textSecondary}>UTR</Text>
      <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>{utr}</Text>
      <Icon name="content-copy" size={18} color={colors.primary} />
    </PressableScale>
  );
}

function LimitCard({ l, onEnhance }: { l: Limit; onEnhance: () => void }) {
  const reduce = useReducedMotion();
  const pct = l.sanctioned ? l.utilised / l.sanctioned : 0;
  const p = useSharedValue(reduce ? pct : 0);
  useEffect(() => { p.value = reduce ? pct : withDelay(200, withTiming(pct, { duration: 900, easing: Easing.out(Easing.cubic) })); }, [p, pct, reduce]);
  const bar = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  const tone = pct > 0.8 ? colors.danger : pct > 0.6 ? colors.cta : colors.successBright;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ZippyAvoid weight="soft" style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={l.key === 'TA' ? 'swap-horizontal-bold' : 'warehouse'} size={22} color={colors.primary} />
        </ZippyAvoid>
        {/* Facility title, sanctioned / utilised / available, Enhance: floating Zippy keeps off all of them.
            The title rect hugs the text, so the whitespace to its right stays usable. */}
        <View style={{ flex: 1 }}>
          <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <Text variant="h3">{l.name} ({l.key})</Text>
            <Text variant="caption" color={colors.textSecondary}>{l.tenor} · {l.roi}</Text>
          </ZippyAvoid>
        </View>
      </View>
      <ZippyAvoid style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Metric label="Sanctioned" value={inrShort(l.sanctioned)} />
        <Metric label="Utilised" value={inrShort(l.utilised)} />
        <Metric label="Available" value={inrShort(availableOf(l))} tone={colors.success} />
      </ZippyAvoid>
      <ZippyAvoid style={{ alignSelf: 'flex-start' }}><EnhanceChip l={l} onPress={onEnhance} /></ZippyAvoid>
      <View style={{ gap: 4 }} accessibilityLabel={`${Math.round(pct * 100)} percent utilised`}>
        <ZippyAvoid weight="soft" style={{ height: 12, borderRadius: 6, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 12, borderRadius: 6, backgroundColor: tone }, bar]} />
        </ZippyAvoid>
        <ZippyAvoid style={{ alignSelf: 'flex-start' }}><Text variant="caption" color={colors.textSecondary}>{Math.round(pct * 100)}% utilised</Text></ZippyAvoid>
      </View>
      {l.drawnBy === 'oem' && (
        <ZippyAvoid weight="soft" style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.primaryTint, borderRadius: radius.sm, padding: space.xs }}>
          <Icon name="factory" size={18} color={colors.primary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>Drawn by OEM on invoice. You repay each drawdown here.</Text>
        </ZippyAvoid>
      )}
    </Card>
  );
}

const STATUS: Record<TrancheStatus, { label: string; tone: 'danger' | 'warning' | 'neutral' | 'success' }> = {
  overdue: { label: 'Overdue', tone: 'danger' }, dueSoon: { label: 'Due soon', tone: 'warning' }, upcoming: { label: 'Upcoming', tone: 'neutral' }, paid: { label: 'Paid', tone: 'success' },
};
const dueText = (t: Tranche) => {
  if (t.status === 'paid') return `Paid${t.paidOn ? ` ${fmtDate(t.paidOn)}` : ''}`;
  const d = daysFromToday(t.due);
  return `Due ${fmtDate(t.due)} · ${d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}`;
};

function TrancheList({ l, selected, onToggle, onPay, onSelectDue }: { l: Limit; selected: string[]; onToggle: (id: string) => void; onPay: (id: string) => void; onSelectDue: () => void }) {
  // Unpaid first (by due date), paid at the end.
  const rows = useMemo(() => [...l.tranches].sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || a.due.getTime() - b.due.getTime()), [l.tranches]);
  const due = dueIn30(l);
  const allDueOn = due.length > 0 && due.every((t) => selected.includes(t.id));
  return (
    <Card style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <ZippyAvoid weight="soft"><Text variant="label" color={colors.textSecondary}>TRANCHES</Text></ZippyAvoid>
        {due.length > 0 && (
          <ZippyAvoid>
            <PressableScale onPress={onSelectDue} disabled={allDueOn} accessibilityRole="button" accessibilityLabel={`Select all due, ${plural(due.length)}`}
              style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.xs, opacity: allDueOn ? 0.5 : 1 }}>
              <Text variant="label" color={colors.primary}>Select all due ({due.length})</Text>
            </PressableScale>
          </ZippyAvoid>
        )}
      </View>
      {rows.map((t) => {
        const paid = t.status === 'paid';
        const on = selected.includes(t.id);
        const st = STATUS[t.status];
        const accent = t.status === 'overdue' ? colors.danger : t.status === 'dueSoon' ? colors.warning : colors.textSecondary;
        return (
          <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs, opacity: paid ? 0.7 : 1 }}>
            {paid ? (
              <View style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Paid">
                <Icon name="check-circle" size={24} color={colors.success} />
              </View>
            ) : (
              <ZippyAvoid>
                <PressableScale onPress={() => onToggle(t.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  accessibilityLabel={`Select ${t.label}, ${inr(t.amount)}, ${dueText(t)}`}
                  style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? colors.primary : colors.textSecondary} />
                </PressableScale>
              </ZippyAvoid>
            )}
            <ZippyAvoid weight="soft" style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{t.label}</Text>
              <Text variant="caption" color={paid ? colors.textSecondary : accent}>{dueText(t)}</Text>
              <View style={{ flexDirection: 'row' }}><Pill label={st.label} tone={st.tone} /></View>
            </ZippyAvoid>
            {/* Tranche amount + Pay: an avoid-rect, so Zippy never cuts the figure or covers Pay. */}
            <ZippyAvoid style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text variant="label" style={paid ? { textDecorationLine: 'line-through' } : undefined}>{inr(t.amount)}</Text>
              {!paid && (
                <PressableScale onPress={() => onPay(t.id)} accessibilityRole="button" accessibilityLabel={`Pay ${t.label}, ${inr(t.amount)}`}
                  style={{ minHeight: touch.min, minWidth: touch.min, justifyContent: 'center', alignItems: 'flex-end' }}>
                  <Text variant="label" color={colors.primary}>Pay</Text>
                </PressableScale>
              )}
            </ZippyAvoid>
          </View>
        );
      })}
      <ZippyAvoid><ReadOnlyRow label="Total due next 30 days" value={inr(sumOf(due))} strong /></ZippyAvoid>
    </Card>
  );
}

function Metric({ label, value, tone = colors.text }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color={colors.textSecondary}>{label}</Text>
      <Text variant="h3" color={tone}>{value}</Text>
    </View>
  );
}

const CHIPS = [50000, 100000, 200000];

/**
 * TA drawdown: amount (slider, field, chips) → confirm → success with UTR.
 * v1.4.5 S2.5 hands-off: the amount step registers the `drawdown-amount` field; a valid amount moves on to the
 * confirm step by itself (900 ms after the last edit, at once for a voice amount; edit / drag cancels; one advance per
 * step, so a Continue tap or voice "continue" during the countdown never double-moves). Invalid amounts never move on
 * and the reason is said. The confirm step asks "Disburse ₹2,00,000? Say yes to disburse." — a spoken yes presses the
 * same "Confirm · disburse ₹X" button (which stays).
 */
function DisburseSheet({ visible, l, account, onClose, onDone }: {
  visible: boolean; l: Limit; account: string; onClose: () => void; onDone: (amount: number) => Promise<string>;
}) {
  // The screen toast sits under the modal, so the copy confirmation shows inside the sheet.
  const [copied, setCopied] = useState<string | null>(null);
  const avail = availableOf(l);
  const [step, setStep] = useState<'amount' | 'confirm' | 'done'>('amount');
  const [amount, setAmount] = useState(MIN_DRAWDOWN);
  const [text, setText] = useState(String(MIN_DRAWDOWN));
  const [utr, setUtr] = useState<string | null>(null);
  const advancer = useAutoAdvance(() => setStep('confirm'));
  const focused = useIsFocused();
  useEffect(() => { if (visible) { setStep('amount'); setAmount(Math.min(100000, avail)); setText(String(Math.min(100000, avail))); setUtr(null); setCopied(null); advancer.reset(); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: number) => { setAmount(v); setText(String(v)); };
  const errorFor = (v: number, t: string) => (!t ? 'Enter an amount' : v < MIN_DRAWDOWN ? `Minimum drawdown is ${inr(MIN_DRAWDOWN)}` : v > avail ? `Only ${inr(avail)} is available` : !Number.isInteger(v) ? 'Enter whole rupees' : undefined);
  const error = errorFor(amount, text);
  const valid = !error;
  const typed = (v: number, t: string = String(v)) => { setAmount(v); setText(t); advancer.typed(!errorFor(v, t)); };
  const interest = drawdownInterest(l, amount);
  const close = () => { setStep('amount'); advancer.reset(); onClose(); };
  const goConfirm = () => { if (valid) advancer.press(); };
  const changeAmount = () => { setStep('amount'); advancer.reset(); };
  const disbursing = useRef(false);
  const confirm = async () => {
    if (disbursing.current || step !== 'confirm') return;
    disbursing.current = true;
    try { const u = await onDone(amount); setUtr(u); setStep('done'); } finally { disbursing.current = false; }
  };
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  // A complete-looking invalid typed amount is explained once the dealer stops typing ("Only ₹4,50,000 is available").
  useEffect(() => {
    if (!visible || step !== 'amount' || !error || !text || amount < MIN_DRAWDOWN / 10) return undefined;
    const h = setTimeout(() => voiceSay(`${error}.`, 'error'), AUTO_ADVANCE_MS);
    return () => clearTimeout(h);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  // Voice: the amount field while the amount step is open; a voice amount fills and moves on at once.
  const amountOpen = visible && step === 'amount' && focused;
  useEffect(() => {
    if (!amountOpen) return undefined;
    const token = setVoiceFields([{ id: 'drawdown-amount', kind: 'amount', label: 'Drawdown amount', min: MIN_DRAWDOWN, max: avail, step: DRAWDOWN_STEP, value: amount }], 'TaInf');
    return () => clearVoiceFields(token);
  }, [amountOpen, avail, amount]);
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!amountOpen || draft?.slots.drawdownAmount === undefined) return;
    const v = voiceDraft.take('drawdownAmount');
    voiceDraft.take('drawdownAdvance');
    if (v === undefined || !Number.isFinite(v)) return;
    const n = Math.round(v);
    set(n);
    haptic.select();
    const err = errorFor(n, String(n));
    if (err) { advancer.cancel(); voiceSay(`${err}.`, 'error'); } else advancer.voice(true);
  }, [draft, amountOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useUndoSource('drawdown', () => ({ amount, step }), (p: { amount: number; step: 'amount' | 'confirm' | 'done' }) => {
    if (step === 'done') return; set(p.amount); setStep(p.step === 'done' ? 'amount' : p.step); advancer.reset();
  }, visible && focused);
  // What voice ADVANCE presses: Continue (plain) on the amount step, the voice-confirmed disburse on the confirm step.
  const confirmPrompt = `Disburse ${inr(amount)}?`;
  useVoiceStep(visible && focused && step !== 'done' ? (step === 'amount'
    ? { route: 'TaInf', sheet: 'disburse', step: 'amount', extra: { drawdownAmount: amount },
      cta: { id: 'disburse-continue', label: 'Continue', destructive: false, enabled: valid, hint: error ? `${error}.` : undefined, press: goConfirm } }
    : { route: 'TaInf', sheet: 'disburse', step: 'confirm', extra: { drawdownAmount: amount },
      cta: { id: 'disburse-confirm', label: `Confirm · disburse ${inr(amount)}`, destructive: true, enabled: true, confirmPrompt, press: () => { void confirmRef.current(); } } }) : null);
  // Reaching the confirm step asks by voice at once (hands-off): "Disburse ₹2,00,000? Say yes to disburse."
  useEffect(() => {
    if (!visible || step !== 'confirm' || !focused) return undefined;
    return askVoiceConfirm({ prompt: `Disburse ${inr(amount)}? Say yes to disburse.`, yesWords: ['disburse', 'confirm', 'send'], onYes: () => { void confirmRef.current(); } });
  }, [visible, step, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const footer = step === 'amount' ? <Button label="Continue" iconRight="arrow-right" disabled={!valid} onPress={goConfirm} accessibilityHint="Moves on by itself once the amount is valid" />
    : step === 'confirm' ? (
      <View style={{ gap: space.xs }}>
        <Button label={`Confirm · disburse ${inr(amount)}`} icon="check" onPress={() => { void confirm(); }} />
        <Button label="Change amount" variant="ghost" onPress={changeAmount} />
      </View>
    ) : <Button label="Done" onPress={close} />;

  return (
    <Sheet visible={visible} onClose={close} title={step === 'done' ? 'Disbursed' : 'Disburse from Trade Advance'} subtitle={step === 'done' ? undefined : `${inr(avail)} available`} footer={footer}>
      {step === 'amount' && (
        <>
          <Text variant="display" accessibilityLiveRegion="polite">{inr(amount)}</Text>
          <Slider label="Drawdown amount" value={Math.min(Math.max(amount, MIN_DRAWDOWN), avail)} min={MIN_DRAWDOWN} max={avail} step={DRAWDOWN_STEP}
            onChange={(v) => typed(v >= avail - DRAWDOWN_STEP / 2 ? avail : v)} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" color={colors.textSecondary}>Min {inrShort(MIN_DRAWDOWN)}</Text>
            <Text variant="caption" color={colors.textSecondary}>Max {inrShort(avail)}</Text>
          </View>
          <Field label="Amount" prefix="₹" keyboardType="number-pad" value={text} maxLength={9} error={error}
            onChangeText={(v) => { const d = v.replace(/\D/g, ''); typed(d ? Number(d) : 0, d); }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {CHIPS.filter((c) => c <= avail).map((c) => <Chip key={c} label={inrShort(c)} on={amount === c} onPress={() => { haptic.select(); typed(c); }} />)}
            <Chip label={`Max ${inrShort(avail)}`} on={amount === avail} onPress={() => { haptic.select(); typed(avail); }} />
          </View>
        </>
      )}
      {step === 'confirm' && (
        <View style={{ gap: space.xxs }}>
          <ReadOnlyRow label="Amount" value={inr(amount)} strong />
          <ReadOnlyRow label="Tenure" value={`${l.tenorDays} days · due ${fmtDate(dueAfter(l.tenorDays))}`} />
          <ReadOnlyRow label={`Interest (${l.roiPct}% p.a.)`} value={inr(interest)} />
          <ReadOnlyRow label="Repay at due date" value={inr(amount + interest)} />
          <ReadOnlyRow label="Credited to" value={account} />
          <Text variant="caption" color={colors.textSecondary}>Example figures. Interest is charged on the drawdown for the tenure.</Text>
        </View>
      )}
      {step === 'done' && utr && (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1 }}>{inr(amount)} sent</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>To {account}. A new tranche is due {fmtDate(dueAfter(l.tenorDays))}.</Text>
          <UtrRow utr={utr} onCopy={() => copyUtr(utr, (t) => setCopied(t))} />
          {copied && <Text variant="caption" color={colors.success} accessibilityLiveRegion="polite">{copied}</Text>}
        </Card>
      )}
    </Sheet>
  );
}

/**
 * Confirm full repayment of the selected tranches (line items, total, mock UPI / net banking). v1.4.5: or a voice
 * amount plan (oldest / overdue first, the last tranche part-paid), which also asks a SPOKEN confirm: "Pay ₹80,000
 * now? Say yes to pay." A voice "yes" runs the same onConfirm as the Pay button; "no" closes the sheet.
 */
function RepaySheet({ visible, tranches, plan, onClose, onConfirm }: {
  visible: boolean; tranches: Tranche[]; plan?: RepayPlan | null; onClose: () => void; onConfirm: (method: 'upi' | 'netbanking') => Promise<void>;
}) {
  const [method, setMethod] = useState<'upi' | 'netbanking'>('upi');
  const [paying, setPaying] = useState(false);
  const total = plan ? plan.amount : sumOf(tranches);
  const open = visible && (plan ? plan.amount > 0 : tranches.length > 0);
  const payingRef = useRef(false);
  const pay = async (m: 'upi' | 'netbanking') => {
    if (payingRef.current) return;
    payingRef.current = true; setPaying(true);
    try { await onConfirm(m); } finally { payingRef.current = false; setPaying(false); }
  };
  const latest = useRef({ pay, method, onClose });
  latest.current = { pay, method, onClose };
  useEffect(() => {
    if (!open || !plan) return undefined;
    return askVoiceConfirm({
      prompt: `Pay ${inr(plan.amount)} now? Say yes to pay.`,
      yesWords: ['pay', 'repay', 'chuka', 'jama'],
      onYes: () => { void latest.current.pay(latest.current.method); },
      onNo: () => latest.current.onClose(),
    });
  }, [open, plan]);
  // v1.4.5 S2.5: "pay" / "yes" / "proceed" on the open repay sheet = the voice-confirmed Pay (the button stays).
  const focusedSheet = useIsFocused();
  useVoiceStep(open && focusedSheet ? { route: 'TaInf', sheet: 'repay', extra: { repayAmount: total },
    cta: { id: 'repay-pay', label: `Pay ${inr(total)}`, destructive: true, enabled: !paying, confirmPrompt: `Pay ${inr(total)} now?`, press: () => { void latest.current.pay(latest.current.method); } } } : null);
  const rows = plan
    ? plan.lines.map((x) => ({ id: x.id, label: x.label, t: { due: x.due, status: x.status } as Tranche, amount: x.pay, note: x.part ? `Part payment of ${inr(x.pay)} · ${inr(x.owed - x.pay)} left` : undefined }))
    : tranches.map((t) => ({ id: t.id, label: t.label, t, amount: t.amount, note: undefined as string | undefined }));
  return (
    <Sheet visible={open} onClose={onClose} title={plan ? `Repay ${inr(plan.amount)}` : `Repay ${plural(tranches.length)}`}
      subtitle={plan ? (plan.full ? 'Full repayment of every unpaid tranche' : 'Oldest and overdue tranches first') : 'Full repayment of each tranche'}
      footer={<Button label={`Pay ${inr(total)}`} icon="lock-outline" disabled={!rows.length || paying} loading={paying} onPress={() => { void pay(method); }} />}>
      <View style={{ gap: space.xs }}>
        {rows.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: space.xs }}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{r.label}</Text>
              <Text variant="caption" color={r.t.status === 'overdue' ? colors.danger : r.t.status === 'dueSoon' ? colors.warning : colors.textSecondary}>{dueText(r.t)}</Text>
              {r.note && <Text variant="caption" color={colors.primary}>{r.note}</Text>}
            </View>
            <Text variant="label">{inr(r.amount)}</Text>
          </View>
        ))}
        <ReadOnlyRow label="Total" value={inr(total)} strong />
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="label">Pay with</Text>
        <Segmented value={method} onChange={setMethod} options={[{ value: 'upi', label: 'UPI', icon: 'qrcode' }, { value: 'netbanking', label: 'Net banking', icon: 'bank-outline' }]} />
        <Text variant="caption" color={colors.textSecondary}>{method === 'upi' ? 'Example: approve the collect request in your UPI app.' : 'Example: pay from your IDFC FIRST current account ••4321.'}</Text>
        {plan && <Text variant="caption" color={colors.textSecondary}>Say “yes” to pay, or tap Pay.</Text>}
      </View>
    </Sheet>
  );
}

/** No TA / INF yet: "Avail a limit" comparison with Apply for TA / INF (one pending application at a time). */
function AvailScreen({ dealerId, dealerName }: { dealerId: string | undefined; dealerName: string }) {
  const app = useWcApplication(dealerId);
  const [applying, setApplying] = useState<FacilityType | null>(null);
  const footer = app === null || applying ? (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button label="Apply for TA" style={{ flex: 1 }} onPress={() => setApplying('TA')} accessibilityHint="Register interest in Trade Advance" />
      <Button label="Apply for INF" variant="secondary" style={{ flex: 1 }} onPress={() => setApplying('INF')} accessibilityHint="Register interest in Inventory Funding" />
    </View>
  ) : undefined;
  return (
    <JourneyScreen title="Get working capital" assistant="tainf" showTerms={false} footer={footer}>
      <AvailLimit app={app} />
      <View style={{ height: ZIPPY_CLEARANCE }} />
      <ApplySheet facility={applying} dealerName={dealerName} onClose={() => setApplying(null)} onSubmitted={(a) => saveWcApplication(dealerId, a)} />
    </JourneyScreen>
  );
}
