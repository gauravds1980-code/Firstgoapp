import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Chip, ExampleTag, inrShort } from './business';
import { Sheet } from './Sheet';
import { Slider } from './Slider';
import { Button, Card, Field, Icon, PressableScale, ReadOnlyRow, Text } from './ui';
import {
  APPLY_MAX, APPLY_MIN, applyForFacility, ENHANCE_REASONS, ENHANCE_STEP, enhanceCap, EnhanceReason, FacilityType, Limit, LimitRequest,
  enhanceAmountError, requestEnhancement, WcApplication,
} from '../services/business';
import { colors, radius, space, touch } from '../theme/tokens';
import { copyToClipboard } from '../utils/clipboard';
import { haptic } from '../utils/haptics';
import { inr } from '../utils/finance';
import { AUTO_ADVANCE_MS } from '../voice/autoAdvance';
import { useAutoAdvance, useVoiceStep } from '../voice/useAutoAdvance';
import { voiceSay } from '../voice/voiceAsk';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { clearVoiceFields, clearVoiceOptions, setVoiceFields, setVoiceOptions } from '../voice/voiceOptions';
import { useUndoSource } from '../voice/voiceUndo';

const FACILITY_NAME: Record<FacilityType, string> = { TA: 'Trade Advance', INF: 'Inventory Funding' };
const digits = (v: string) => v.replace(/\D/g, '');

/** Tap-to-copy reference number. The confirmation shows inline (screen toasts sit under a sheet). */
export function RefRow({ value }: { value: string }) {
  const [note, setNote] = useState<string | null>(null);
  const copy = async () => {
    const ok = await copyToClipboard(value);
    if (ok) haptic.success(); else haptic.error();
    setNote(ok ? 'Reference copied' : "Couldn't copy the reference");
  };
  return (
    <View>
      <PressableScale onPress={copy} accessibilityRole="button" accessibilityLabel={`Reference ${value}. Tap to copy`}
        style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Text variant="caption" color={colors.textSecondary}>Ref</Text>
        <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>{value}</Text>
        <Icon name="content-copy" size={18} color={colors.primary} />
      </PressableScale>
      {note && <Text variant="caption" color={colors.success} accessibilityLiveRegion="polite">{note}</Text>}
    </View>
  );
}

/** "Enhance my limit" bubble near the limit metrics, or the pending state once a request is in. */
export function EnhanceChip({ l, onPress }: { l: Limit; onPress: () => void }) {
  const r = l.enhancement;
  if (r) {
    return (
      <View accessibilityLabel={`Enhancement requested to ${inr(r.requested)}, pending. Reference ${r.ref}`}
        style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.warningSoft }}>
        <Icon name="clock-outline" size={18} color={colors.warning} />
        <Text variant="label" color={colors.warning}>Enhancement requested · {inrShort(r.requested)} · pending</Text>
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel="Enhance my limit"
      style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.primaryTint, borderWidth: 1.5, borderColor: colors.primarySoft }}>
      <Icon name="trending-up" size={18} color={colors.primary} />
      <Text variant="label" color={colors.primary}>Enhance my limit</Text>
    </PressableScale>
  );
}

/** Voice values the sheet opens with (ENHANCE_TA_LIMIT "I need an enhancement of 15 lakhs"). */
export type EnhanceVoice = { amount?: number; reasonId?: string } | null;

const REASON_FOR_ID = (id: string | undefined): EnhanceReason | null => {
  if (!id) return null;
  const k = ENHANCE_REASONS.find((r) => r.key === id);
  if (k) return k.key;
  // Server concepts (no chips sent / older registration): stock → inventory, oem → newOem.
  return ({ stock: 'inventory', inventory: 'inventory', festive: 'festive', oem: 'newOem', newOem: 'newOem', other: 'other' } as Record<string, EnhanceReason>)[id] ?? null;
};

/**
 * Request a higher sanctioned limit (mock). The limit itself stays as is until the bank approves.
 * v1.4.5 S2.3 hands-off: two steps. AMOUNT (Proceed stays visible): a valid new limit (above the current limit, up to
 * the cap, on the ₹50,000 step) moves on by itself 900 ms after the last edit, at once for a voice amount; an edit /
 * drag cancels the countdown; a tap or voice "proceed" during it advances once (AutoAdvancer). Invalid values never
 * advance and the reason is said. REASON: chips (spoken too), docs, "Send request" — a spoken confirm.
 */
export function EnhanceSheet({ visible, l, onClose, onSubmitted, voice }: { visible: boolean; l: Limit; onClose: () => void; onSubmitted: (r: LimitRequest) => void; voice?: EnhanceVoice }) {
  const min = l.sanctioned + ENHANCE_STEP;
  const cap = enhanceCap(l.sanctioned);
  const start = Math.min(cap, Math.round((l.sanctioned * 1.5) / ENHANCE_STEP) * ENHANCE_STEP);
  const [step, setStep] = useState<'amount' | 'reason'>('amount');
  const [amount, setAmount] = useState(start);
  const [text, setText] = useState(String(start));
  const [reason, setReason] = useState<EnhanceReason | null>(null);
  const [note, setNote] = useState('');
  const [docs, setDocs] = useState(0);
  const [done, setDone] = useState<LimitRequest | null>(null);
  const focused = useIsFocused();
  const advancer = useAutoAdvance(() => setStep('reason'));
  const valueOk = (v: number, t: string = String(v)) => !enhanceAmountError(v, t, l.sanctioned);
  useEffect(() => {
    if (!visible) return;
    const v = voice?.amount !== undefined ? Math.round(voice.amount) : start;
    setAmount(v); setText(String(v)); setReason(REASON_FOR_ID(voice?.reasonId)); setNote(''); setDocs(0); setDone(null);
    setStep('amount'); advancer.reset();
    // Opened by voice with a complete valid amount: go on to the reason step at once; invalid → say why.
    if (voice?.amount !== undefined) {
      const err = enhanceAmountError(v, String(v), l.sanctioned);
      if (err) voiceSay(`${err}. Say or type the new limit.`, 'error'); else advancer.voice(true);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: number) => { setAmount(v); setText(String(v)); };
  const amountError = enhanceAmountError(amount, text, l.sanctioned);
  const reasonHint = !reason ? 'Pick a reason first: more inventory, festive demand, new OEM or other.' : reason === 'other' && note.trim().length < 3 ? 'Add a short note for Other.' : undefined;
  const valid = !amountError && !reasonHint;
  const pickDocs = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsMultipleSelection: true });
      if (!res.canceled) { haptic.select(); setDocs((d) => d + res.assets.length); }
    } catch { /* picker unavailable: documents stay optional */ }
  };
  const sending = useRef(false);
  const submit = async () => {
    if (!reason || !valid || sending.current) return;
    sending.current = true;
    try {
      const r = await requestEnhancement({ current: l.sanctioned, requested: amount, reason, note: reason === 'other' ? note.trim() : undefined, docs });
      haptic.success();
      onSubmitted(r);
      setDone(r);
    } finally { sending.current = false; }
  };
  const proceed = () => { if (!amountError) advancer.press(); };
  const editAmount = () => { setStep('amount'); advancer.reset(); };

  // Typed / dragged: debounce, then advance (valid) or say why not (a complete-looking wrong value, never "15").
  const typed = (v: number, t: string) => { set(v); setText(t); advancer.typed(valueOk(v, t)); };
  useEffect(() => {
    if (!visible || done || step !== 'amount' || !amountError || !text || amount < min / 10) return undefined;
    const h = setTimeout(() => voiceSay(`${amountError}.`, 'error'), AUTO_ADVANCE_MS);
    return () => clearTimeout(h);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // v1.4.5 voice: the new-limit field and the reason chips (CONTRACT.md S2.0), only while the sheet is open.
  const open = visible && !done && focused;
  useEffect(() => {
    if (!open) return undefined;
    const f = setVoiceFields([{ id: 'enhance-amount', kind: 'amount', label: 'New limit', min, max: cap, step: ENHANCE_STEP, value: amount, current: l.sanctioned }], 'TaInf');
    const o = setVoiceOptions(ENHANCE_REASONS.map((r) => ({ id: r.key, kind: 'reason', label: r.label, value: r.key })), 'TaInf');
    return () => { clearVoiceFields(f); clearVoiceOptions(o); };
  }, [open, amount, min, cap, l.sanctioned]);
  // Spoken fills: new limit (+ reason) and reason chips. A complete valid voice amount advances at once.
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!open || !draft) return;
    const s = draft.slots;
    if (s.enhanceAmount !== undefined) {
      const v = voiceDraft.take('enhanceAmount');
      const go = voiceDraft.take('enhanceAdvance');
      if (v !== undefined && Number.isFinite(v)) {
        const n = Math.round(v);
        set(n);
        haptic.select();
        const err = enhanceAmountError(n, String(n), l.sanctioned);
        if (err) { advancer.cancel(); voiceSay(`${err}.`, 'error'); } else if (go !== false && step === 'amount') advancer.voice(true);
      }
    }
    if (s.enhanceReasonId !== undefined) {
      const r = REASON_FOR_ID(voiceDraft.take('enhanceReasonId'));
      if (r) { setReason(r); haptic.select(); }
    }
  }, [draft, open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Undo of a voice fill puts the amount / reason back (and the amount step, so nothing moves on).
  useUndoSource('enhance', () => ({ amount, step }), (p: { amount: number; step: 'amount' | 'reason' }) => { set(p.amount); setStep(p.step); if (p.step === 'amount') advancer.reset(); }, open);
  useUndoSource('reason', () => reason, (r: EnhanceReason | null) => setReason(r), open);

  // What voice ADVANCE presses: Proceed on the amount step, the voice-confirmed Send request on the reason step.
  const sendCta = { id: 'enhance-send', label: 'Send request', destructive: true, enabled: valid, hint: amountError ?? reasonHint,
    confirmPrompt: `Send the request for a new limit of ${inr(amount)}?`, press: () => { void submit(); } };
  useVoiceStep(open ? (step === 'amount'
    ? { route: 'TaInf', sheet: 'enhance', step: 'amount', extra: { amount },
      cta: { id: 'enhance-proceed', label: 'Proceed', destructive: false, enabled: !amountError, hint: amountError ? `${amountError}.` : undefined, press: proceed },
      alts: [{ ...sendCta, enabled: false, hint: amountError ? `${amountError}.` : 'Say proceed, then pick a reason.' }] }
    : { route: 'TaInf', sheet: 'enhance', step: 'reason', extra: { amount }, cta: sendCta }) : null);

  const footer = done ? <Button label="Done" onPress={onClose} />
    : step === 'amount' ? <Button label="Proceed" iconRight="arrow-right" disabled={!!amountError} onPress={proceed} accessibilityHint="Moves on by itself once the new limit is valid" />
      : (
        <View style={{ gap: space.xs }}>
          <Button label="Send request" icon="send" disabled={!valid} onPress={() => { void submit(); }} />
          <Button label="Change amount" variant="ghost" onPress={editAmount} />
        </View>
      );
  return (
    <Sheet visible={visible} onClose={onClose} title={done ? 'Request sent' : 'Enhance my limit'} subtitle={done ? undefined : `${l.name} · illustrative example`} footer={footer}>
      {done ? (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1 }}>Request sent · RM will call within 48 hrs</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>New limit requested: {inr(done.requested)} (current {inr(done.current)}). Your limit stays the same until it is approved.</Text>
          <RefRow value={done.ref} />
        </Card>
      ) : step === 'amount' ? (
        <>
          <ReadOnlyRow label="Current sanctioned limit" value={inr(l.sanctioned)} strong />
          <View style={{ gap: space.xs }}>
            <Text variant="label">Requested new limit</Text>
            <Text variant="display" accessibilityLiveRegion="polite">{inr(amount)}</Text>
            <Slider label="Requested new limit" value={Math.min(Math.max(amount, min), cap)} min={min} max={cap} step={ENHANCE_STEP} onChange={(v) => typed(v, String(v))} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color={colors.textSecondary}>Min {inrShort(min)}</Text>
              <Text variant="caption" color={colors.textSecondary}>Up to {inrShort(cap)} (example cap)</Text>
            </View>
          </View>
          <Field label="New limit" prefix="₹" keyboardType="number-pad" value={text} maxLength={10} error={amountError}
            onChangeText={(v) => { const d = digits(v); typed(d ? Number(d) : 0, d); }} />
          <Text variant="caption" color={colors.textSecondary}>Say “enhance my limit to 15 lakh”, or type it. Moves on by itself once it is valid.</Text>
        </>
      ) : (
        <>
          <ReadOnlyRow label="New limit requested" value={inr(amount)} strong />
          <View style={{ gap: space.xs }}>
            <Text variant="label">Reason</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {ENHANCE_REASONS.map((r) => <Chip key={r.key} label={r.label} on={reason === r.key} onPress={() => { haptic.select(); setReason(r.key); }} />)}
            </View>
            {reason === 'other' && <Field label="Tell us briefly" value={note} onChangeText={setNote} maxLength={120} placeholder="e.g. opening a second showroom" />}
          </View>
          <View style={{ gap: space.xs }}>
            <Button label={docs ? `${docs} document${docs === 1 ? '' : 's'} added · add more` : 'Add documents (optional)'} variant="secondary" icon="paperclip" onPress={pickDocs} />
            <Text variant="caption" color={colors.textSecondary}>Example only: e.g. stock statement or GST returns. Nothing is uploaded in this prototype.</Text>
          </View>
          <Text variant="caption" color={colors.textSecondary}>Say “send request” and then “yes”, or tap Send request.</Text>
        </>
      )}
    </Sheet>
  );
}

const COMPARE: { label: string; ta: string; inf: string }[] = [
  { label: 'What it is', ta: 'Working capital against stock you buy', inf: 'Funding against your OEM invoice' },
  { label: 'Who draws it', ta: 'You, from this app', inf: 'Your OEM, on invoice' },
  { label: 'Can you disburse?', ta: 'Yes, in tranches', inf: 'No, OEM-drawn' },
  { label: 'Repayment', ta: 'Per tranche, in full', inf: 'Per tranche, in full' },
  { label: 'Suits', ta: 'Dealers who buy inventory themselves', inf: 'Dealers whose OEM pulls funding on invoice' },
  { label: 'Typical tenure', ta: 'e.g. 30-day rolling', inf: 'e.g. 60 days per drawdown' },
  { label: 'Interest-free days', ta: 'Set at sanction (if any)', inf: 'Set at sanction (if any)' },
];

/** No TA / INF yet: compare the two and register interest. */
export function AvailLimit({ app }: { app: WcApplication | null | undefined }) {
  return (
    <>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Avail a limit from IDFC FIRST</Text>
        <Text variant="body" color={colors.textSecondary}>Working capital for your stock, repaid tranche by tranche. Choose what fits how you buy inventory.</Text>
        <ExampleTag />
      </View>
      {app && (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="clock-check-outline" size={24} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1 }}>Application submitted · {FACILITY_NAME[app.facility]}</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>Requested {inr(app.requested)} on {app.submittedOn}. Your relationship manager will contact you within 48 hrs.</Text>
          <RefRow value={app.ref} />
        </Card>
      )}
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="swap-horizontal-bold" size={20} color={colors.primary} />
            <Text variant="bodyStrong" style={{ flexShrink: 1 }}>Trade Advance (TA)</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="warehouse" size={20} color={colors.primary} />
            <Text variant="bodyStrong" style={{ flexShrink: 1 }}>Inventory Funding (INF)</Text>
          </View>
        </View>
        {COMPARE.map((r) => (
          <View key={r.label} style={{ gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs }}
            accessible accessibilityLabel={`${r.label}. Trade Advance: ${r.ta}. Inventory Funding: ${r.inf}`}>
            <Text variant="caption" color={colors.textSecondary}>{r.label.toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Text variant="body" style={{ flex: 1 }}>{r.ta}</Text>
              <Text variant="body" style={{ flex: 1 }}>{r.inf}</Text>
            </View>
          </View>
        ))}
        <Text variant="caption" color={colors.textSecondary}>Illustrative only. Tenure, pricing, interest-free days and eligibility are set by IDFC FIRST at sanction.</Text>
      </Card>
    </>
  );
}

/** Short interest form for TA or INF; the RM follows up. */
export function ApplySheet({ facility, dealerName, onClose, onSubmitted }: { facility: FacilityType | null; dealerName: string; onClose: () => void; onSubmitted: (a: WcApplication) => void }) {
  const [name, setName] = useState(dealerName);
  const [limitText, setLimitText] = useState('');
  const [turnover, setTurnover] = useState('');
  const [done, setDone] = useState<WcApplication | null>(null);
  useEffect(() => { if (facility) { setName(dealerName); setLimitText(''); setTurnover(''); setDone(null); } }, [facility]); // eslint-disable-line react-hooks/exhaustive-deps
  const requested = limitText ? Number(limitText) : 0;
  const limitError = limitText && (requested < APPLY_MIN || requested > APPLY_MAX) ? `Enter ${inrShort(APPLY_MIN)} to ${inrShort(APPLY_MAX)} for this example` : undefined;
  const valid = !!facility && name.trim().length >= 2 && !!limitText && !limitError;
  const submit = async () => {
    if (!facility) return;
    const a = await applyForFacility({ facility, name: name.trim(), requested, turnover: turnover ? Number(turnover) : undefined });
    haptic.success();
    onSubmitted(a);
    setDone(a);
  };
  const fname = facility ? FACILITY_NAME[facility] : '';
  return (
    <Sheet visible={!!facility} onClose={onClose} title={done ? 'Application submitted' : `Apply for ${fname}`} subtitle={done ? undefined : 'Takes a minute · your RM follows up'}
      footer={done ? <Button label="Done" onPress={onClose} /> : <Button label="Submit application" icon="send" disabled={!valid} onPress={submit} />}>
      {done ? (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1 }}>Application sent · RM will contact you within 48 hrs</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>{fname} · requested {inr(done.requested)}.</Text>
          <RefRow value={done.ref} />
        </Card>
      ) : (
        <>
          <ReadOnlyRow label="Facility" value={fname} strong />
          <Field label="Dealership name" value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
          <Field label="Limit you need" prefix="₹" keyboardType="number-pad" value={limitText} maxLength={9} placeholder="e.g. 1000000" error={limitError}
            hint={limitText && !limitError ? inr(requested) : undefined} onChangeText={(v) => setLimitText(digits(v))} />
          <Field label="Monthly turnover (optional)" prefix="₹" keyboardType="number-pad" value={turnover} maxLength={10} onChangeText={(v) => setTurnover(digits(v))}
            hint={turnover ? inr(Number(turnover)) : undefined} />
          <Text variant="caption" color={colors.textSecondary}>Example form. No credit check is run; eligibility is assessed by IDFC FIRST.</Text>
        </>
      )}
    </Sheet>
  );
}
