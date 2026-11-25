import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ADVANCE_FEE_PCT, ADVANCE_MIN, ADVANCE_STEP, advanceFee, advanceRange, recoverySchedule, transferAdvance } from '../services/business';
import { AdvanceRecord, recordAdvance } from '../state/stores';
import { colors, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { ZippyAvoid } from './assistant/zippyAvoid';
import { Chip, inrShort } from './business';
import { Sheet } from './Sheet';
import { Slider } from './Slider';
import { copyUtr } from './Toast';
import { Button, Card, Field, Icon, PressableScale, ReadOnlyRow, Text } from './ui';

export interface AdvanceState { months: { label: string; amt: number }[]; avg: number; limit: number; outstanding: number; available: number; records: AdvanceRecord[] }

const tab = { fontVariant: ['tabular-nums' as const] };

/**
 * Advance payout on the Payouts screen: transparent limit (3 × average of the chart's last 3 months),
 * minus outstanding, = available; slider + field + chips from ₹30,000 to available; Transfer funds opens
 * the confirm sheet. Example terms: the fee is illustrative, recovery nets off future payouts.
 */
export function AdvancePayoutCard({ dealerId, a, account }: { dealerId: string; a: AdvanceState; account: string }) {
  const avail = a.available;
  const { enabled, half } = advanceRange(avail);
  const [amount, setAmount] = useState(ADVANCE_MIN);
  const [text, setText] = useState(String(ADVANCE_MIN));
  const [open, setOpen] = useState(false);
  const set = (v: number) => { setAmount(v); setText(String(v)); };
  // Available dropped (an advance was just taken): keep the chosen amount inside the new range.
  useEffect(() => { if (amount > avail) set(Math.max(ADVANCE_MIN, avail)); }, [avail]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = enabled && Number.isInteger(amount) && amount >= ADVANCE_MIN && amount <= avail;
  const error = !enabled ? undefined : !text ? 'Enter an amount' : amount < ADVANCE_MIN ? `Minimum advance is ${inr(ADVANCE_MIN)}` : amount > avail ? `Only ${inr(avail)} is available` : undefined;
  const pick = (v: number) => { haptic.select(); set(v); };

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {/* Decorative icon: Zippy may rest on it only if nothing better is free (soft). */}
        <ZippyAvoid weight="soft" style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cash-fast" size={22} color={colors.primary} />
        </ZippyAvoid>
        {/* Two short lines so neither wraps mid-phrase at 360dp. The avoid-rect hugs the text (not the
            empty space to its right), so Zippy never covers it but can still use that whitespace. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <Text variant="label" color={colors.textSecondary}>ADVANCE PAYOUT</Text>
            <Text variant="caption" color={colors.textSecondary}>{'Take future payouts early.\nRecovered from later credits.'}</Text>
          </ZippyAvoid>
        </View>
      </View>

      <ZippyAvoid style={{ gap: space.xxs }}>
        <View style={{ backgroundColor: colors.primaryTint, borderRadius: radius.md, padding: space.sm, gap: 2 }}>
          <Text variant="caption" color={colors.textSecondary}>{a.months.map((m, i) => `${m.label}${i === 2 ? ' (to date)' : ''} ${inr(m.amt)}`).join(' · ')}</Text>
          <Text variant="bodyStrong" style={tab}>Avg of last 3 months {inr(a.avg)} × 3 = {inr(a.limit)} limit</Text>
        </View>
        <ReadOnlyRow label="Limit (3 × average)" value={inr(a.limit)} />
        {a.outstanding > 0 && <ReadOnlyRow label="Advance outstanding" value={`− ${inr(a.outstanding)}`} />}
        <ReadOnlyRow label="Available now" value={inr(avail)} strong />
      </ZippyAvoid>

      {enabled ? (
        <View style={{ gap: space.sm }}>
          <ZippyAvoid style={{ alignSelf: 'flex-start' }}><Text variant="display" style={tab} accessibilityLiveRegion="polite">{inr(amount)}</Text></ZippyAvoid>
          {avail > ADVANCE_MIN ? (
            <>
              <ZippyAvoid>
                <Slider label="Advance amount" value={Math.min(Math.max(amount, ADVANCE_MIN), avail)} min={ADVANCE_MIN} max={avail} step={ADVANCE_STEP}
                  onChange={(v) => set(v >= avail - ADVANCE_STEP / 2 ? avail : v)} />
              </ZippyAvoid>
              {/* Min / Max labels, the amount field and the quick chips are all avoid-rects (Max stays visible and tappable). */}
              <ZippyAvoid style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" color={colors.textSecondary}>Min {inrShort(ADVANCE_MIN)}</Text>
                <Text variant="caption" color={colors.textSecondary}>Max {inrShort(avail)}</Text>
              </ZippyAvoid>
              <ZippyAvoid>
                <Field label="Amount" prefix="₹" keyboardType="number-pad" value={text} maxLength={9} error={error}
                  onChangeText={(v) => { const d = v.replace(/\D/g, ''); setText(d); setAmount(d ? Number(d) : 0); }} />
              </ZippyAvoid>
              <ZippyAvoid style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                <Chip label="₹30k" on={amount === ADVANCE_MIN} onPress={() => pick(ADVANCE_MIN)} />
                {half !== null && <Chip label="50%" on={amount === half} onPress={() => pick(half)} />}
                <Chip label="Max" on={amount === avail} onPress={() => pick(avail)} />
              </ZippyAvoid>
            </>
          ) : (
            <Text variant="caption" color={colors.textSecondary}>Your available limit is exactly the {inr(ADVANCE_MIN)} minimum.</Text>
          )}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.sm }}>
          <Icon name="information-outline" size={18} color={colors.textSecondary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>Advance payout is available from {inr(ADVANCE_MIN)}. Your current limit is {inr(avail)}.</Text>
        </View>
      )}

      <ZippyAvoid>
        <Button label="Transfer funds" icon="bank-transfer-out" variant="brand" disabled={!valid} onPress={() => setOpen(true)} />
      </ZippyAvoid>
      <ZippyAvoid weight="soft"><Text variant="caption" color={colors.textSecondary}>Example terms. Recovered by netting off your future payouts.</Text></ZippyAvoid>

      <AdvanceSheet visible={open} amount={amount} a={a} account={account} dealerId={dealerId} onClose={() => setOpen(false)} />
    </Card>
  );
}

/** Confirm (amount, illustrative fee, net, account, recovery) → explicit Confirm → mock transfer → UTR. */
function AdvanceSheet({ visible, amount, a, account, dealerId, onClose }: { visible: boolean; amount: number; a: AdvanceState; account: string; dealerId: string; onClose: () => void }) {
  const [step, setStep] = useState<'confirm' | 'done'>('confirm');
  const [done, setDone] = useState<{ amount: number; net: number; utr: string } | null>(null);
  // The screen toast sits under the modal, so the copy confirmation shows inside the sheet.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (visible) { setStep('confirm'); setDone(null); setCopied(null); } }, [visible]);
  const fee = advanceFee(amount);
  const net = amount - fee;
  // Projected against the TOTAL outstanding after this advance; earlier advances are recovered first.
  const schedule = recoverySchedule(a.outstanding + amount, a.avg);

  const confirm = async () => {
    const r = await transferAdvance(amount, a.records.length + 1);
    haptic.success();
    recordAdvance(dealerId, { amount, fee, net, utr: r.utr });
    setDone({ amount, net, utr: r.utr });
    setStep('done');
  };

  const footer = step === 'confirm' ? (
    <View style={{ gap: space.xs }}>
      <Button label={`Confirm · transfer ${inr(net)}`} icon="check" onPress={confirm} />
      <Button label="Change amount" variant="ghost" onPress={onClose} />
    </View>
  ) : <Button label="Done" onPress={onClose} />;

  return (
    <Sheet visible={visible} onClose={onClose} title={step === 'done' ? 'Advance transferred' : 'Confirm advance payout'} subtitle={step === 'done' ? undefined : 'Check the details before you confirm'} footer={footer}>
      {step === 'confirm' && (
        <>
          <View style={{ gap: space.xxs }}>
            <ReadOnlyRow label="Advance amount" value={inr(amount)} strong />
            <ReadOnlyRow label={`Fee (${ADVANCE_FEE_PCT}%) · Illustrative`} value={`− ${inr(fee)}`} />
            <ReadOnlyRow label="Net credit" value={inr(net)} strong />
            <ReadOnlyRow label="Credit account" value={account} />
            <Text variant="caption" color={colors.warning}>Example — not IDFC pricing. Fee shown at an example {ADVANCE_FEE_PCT}% of the advance.</Text>
          </View>
          <View style={{ gap: space.xxs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm }}>
            <Text variant="label" color={colors.textSecondary}>RECOVERY · EXAMPLE SCHEDULE</Text>
            {schedule.map((m) => <ReadOnlyRow key={m.label} label={`${m.label} payout`} value={`− ${inr(m.netted)}`} />)}
            <Text variant="caption" color={colors.textSecondary}>
              Future payouts will be netted until the outstanding {inr(a.outstanding + amount)} is cleared. Projected at your 3-month average of {inr(a.avg)} a month.
            </Text>
          </View>
        </>
      )}
      {step === 'done' && done && (
        <Card tone={colors.successSoft} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Text variant="h3" color={colors.success} style={{ flex: 1, ...tab }}>{inr(done.net)} credited</Text>
          </View>
          <Text variant="body" color={colors.textSecondary}>To {account}. Advance of {inr(done.amount)} will be recovered from your next payouts.</Text>
          <PressableScale onPress={() => copyUtr(done.utr, (t) => setCopied(t))} accessibilityRole="button" accessibilityLabel={`UTR ${done.utr}. Tap to copy`}
            style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Text variant="caption" color={colors.textSecondary}>UTR</Text>
            <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>{done.utr}</Text>
            <Icon name="content-copy" size={18} color={colors.primary} />
          </PressableScale>
          {copied && <Text variant="caption" color={colors.success} accessibilityLiveRegion="polite">{copied}</Text>}
        </Card>
      )}
    </Sheet>
  );
}
