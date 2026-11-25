import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Chip, ExampleTag, inrShort } from './business';
import { Sheet } from './Sheet';
import { Slider } from './Slider';
import { Button, Card, Field, Icon, PressableScale, ReadOnlyRow, Text } from './ui';
import {
  APPLY_MAX, APPLY_MIN, applyForFacility, ENHANCE_REASONS, ENHANCE_STEP, enhanceCap, EnhanceReason, FacilityType, Limit, LimitRequest,
  requestEnhancement, WcApplication,
} from '../services/business';
import { colors, radius, space, touch } from '../theme/tokens';
import { copyToClipboard } from '../utils/clipboard';
import { haptic } from '../utils/haptics';
import { inr } from '../utils/finance';

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

/** Request a higher sanctioned limit (mock). The limit itself stays as is until the bank approves. */
export function EnhanceSheet({ visible, l, onClose, onSubmitted }: { visible: boolean; l: Limit; onClose: () => void; onSubmitted: (r: LimitRequest) => void }) {
  const min = l.sanctioned + ENHANCE_STEP;
  const cap = enhanceCap(l.sanctioned);
  const start = Math.min(cap, Math.round((l.sanctioned * 1.5) / ENHANCE_STEP) * ENHANCE_STEP);
  const [amount, setAmount] = useState(start);
  const [text, setText] = useState(String(start));
  const [reason, setReason] = useState<EnhanceReason | null>(null);
  const [note, setNote] = useState('');
  const [docs, setDocs] = useState(0);
  const [done, setDone] = useState<LimitRequest | null>(null);
  useEffect(() => { if (visible) { setAmount(start); setText(String(start)); setReason(null); setNote(''); setDocs(0); setDone(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: number) => { setAmount(v); setText(String(v)); };
  const amountError = !text ? 'Enter the new limit' : amount <= l.sanctioned ? `Must be above your current ${inr(l.sanctioned)}` : amount > cap ? `Up to ${inr(cap)} in this example` : undefined;
  const valid = !amountError && !!reason && (reason !== 'other' || note.trim().length >= 3);
  const pickDocs = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsMultipleSelection: true });
      if (!res.canceled) { haptic.select(); setDocs((d) => d + res.assets.length); }
    } catch { /* picker unavailable: documents stay optional */ }
  };
  const submit = async () => {
    if (!reason) return;
    const r = await requestEnhancement({ current: l.sanctioned, requested: amount, reason, note: reason === 'other' ? note.trim() : undefined, docs });
    haptic.success();
    onSubmitted(r);
    setDone(r);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={done ? 'Request sent' : 'Enhance my limit'} subtitle={done ? undefined : `${l.name} · illustrative example`}
      footer={done ? <Button label="Done" onPress={onClose} /> : <Button label="Send request" icon="send" disabled={!valid} onPress={submit} />}>
      {done ? (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1 }}>Request sent · RM will call within 48 hrs</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>New limit requested: {inr(done.requested)} (current {inr(done.current)}). Your limit stays the same until it is approved.</Text>
          <RefRow value={done.ref} />
        </Card>
      ) : (
        <>
          <ReadOnlyRow label="Current sanctioned limit" value={inr(l.sanctioned)} strong />
          <View style={{ gap: space.xs }}>
            <Text variant="label">Requested new limit</Text>
            <Text variant="display" accessibilityLiveRegion="polite">{inr(amount)}</Text>
            <Slider label="Requested new limit" value={Math.min(Math.max(amount, min), cap)} min={min} max={cap} step={ENHANCE_STEP} onChange={set} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color={colors.textSecondary}>Min {inrShort(min)}</Text>
              <Text variant="caption" color={colors.textSecondary}>Up to {inrShort(cap)} (example cap)</Text>
            </View>
          </View>
          <Field label="New limit" prefix="₹" keyboardType="number-pad" value={text} maxLength={10} error={amountError}
            onChangeText={(v) => { const d = digits(v); setText(d); setAmount(d ? Number(d) : 0); }} />
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
