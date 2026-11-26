import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { JourneyScreen } from '../components/Screen';
import { copyUtr, useToast } from '../components/Toast';
import { Chip, DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, EmptyState, Icon, Pill, PressableScale, Text } from '../components/ui';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { casesFor, claimInvoice, fmtDate, invoicesFor, InvoiceStatus, payoutMonths } from '../services/business';
import { useApp } from '../state/AppState';
import { inRange, markInvoiceClaimed, presetRange, useAdvance, useDateRange, useInvoices } from '../state/stores';
import { AdvancePayoutCard } from '../components/AdvancePayout';
import { IconWell } from '../components/phosphor';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';

const STATUS: InvoiceStatus[] = ['Not claimed', 'Claimed', 'Paid'];
const TONE: Record<InvoiceStatus, 'warning' | 'info' | 'success'> = { 'Not claimed': 'warning', Claimed: 'info', Paid: 'success' };

/** Payout invoices with status filter chips, totals per status, per-case lines and a Claim action (example data). */
export default function PayoutsScreen() {
  const { profile, session } = useApp();
  const nav = useNavigation();
  const [range, setRange] = useDateRange();
  const dealerId = session?.dealerId ?? 'anon';
  const seed = useMemo(() => invoicesFor(casesFor(profile)), [profile]);
  // Shared with the Home Payouts tile: claims live in invoiceStore (persisted), not local state.
  const base = useInvoices(dealerId, seed);
  const [filter, setFilter] = useState<InvoiceStatus | 'All'>('All');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const utrToast = useToast();
  const all = base.filter((i) => inRange(i.date, range));
  const totals = STATUS.map((s) => ({ s, n: all.filter((i) => i.status === s).length, amt: all.filter((i) => i.status === s).reduce((t, i) => t + i.amount, 0) }));
  const shown = filter === 'All' ? all : all.filter((i) => i.status === filter);
  // Last three months; a bar is highlighted when its month overlaps the selected date range
  // (This month → Nov, Last month → Oct, a custom range → every month it touches).
  // Same month buckets as the Advance payout limit (payoutMonths), so the card and the bars always agree.
  const months = payoutMonths(base).map((m) => ({ ...m, on: m.start <= range.to && m.end >= range.from }));
  // Advance limit: 3 × average of these three months (not filtered by the date range), minus outstanding.
  const advance = useAdvance(dealerId, base);
  const maxM = Math.max(1, ...months.map((m) => m.amt));

  const toClaim = totals.find((t) => t.s === 'Not claimed')!;
  const sec = useSectionTracker<'summary' | 'invoices'>('summary');
  useZippyPending(toClaim.n ? [{ id: 'claim', label: `${toClaim.n} invoice${toClaim.n === 1 ? '' : 's'} not claimed`, detail: `${inr(toClaim.amt)} waiting — claim to get paid.`, actionLabel: 'Show unclaimed', onAction: () => setFilter('Not claimed') }] : []);

  const claim = async (id: string) => {
    setBusy(id); const r = await claimInvoice(id); setBusy(null);
    if (r.ok) { haptic.success(); markInvoiceClaimed(dealerId, id, r.ref); }
  };

  return (
    <JourneyScreen title="Payouts" titleInBody assistant="payouts" showTerms={false} onScroll={sec.onScroll} toast={utrToast.toast?.text} toastTone={utrToast.toast?.tone}>
      <View style={{ gap: space.xxs }} onLayout={sec.at('summary')}>
        <Text variant="h1">Payouts</Text>
        <Text variant="body" color={colors.textSecondary}>Dealer payout invoices for {session?.name ?? 'your dealership'}</Text>
        <ExampleTag />
      </View>
      {/* Hero figure: what's waiting to be claimed dominates the screen */}
      {/* design-a: white card on cream; the Payouts mustard lives only in the icon well (ink glyph, 7.4:1). */}
      <Card style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xxs }}>
          <IconWell name="payouts" bg={colors.tileMustard} />
          <Text variant="label" color={colors.textSecondary}>READY TO CLAIM</Text>
        </View>
        <ZippyAvoid style={{ alignSelf: 'flex-start' }}><Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>{inr(toClaim.amt)}</Text></ZippyAvoid>
        <Text variant="caption" color={colors.textSecondary}>{toClaim.n ? `${toClaim.n} invoice${toClaim.n === 1 ? '' : 's'} in this range · scroll to claim each invoice` : 'Nothing to claim in this range'}</Text>
      </Card>
      <DateFilterBar />

      {/* The whole chart (bars + their values) is an avoid-rect: Zippy never sits on the Nov bar or its amount. */}
      <ZippyAvoid>
      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>MONTHLY PAYOUT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md, height: 110 }}>
          {months.map((m) => (
            <View key={m.label} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 4 }} accessibilityLabel={`${m.label}: ${inrShort(m.amt)}${m.on ? ', in the selected range' : ''}`}>
              <Text variant="caption" color={m.on ? colors.text : colors.textSecondary} numberOfLines={1}>{inrShort(m.amt)}</Text>
              <View style={{ width: '70%', height: Math.max(6, (m.amt / maxM) * 64), borderRadius: 8, backgroundColor: m.on ? colors.primary : colors.primarySoft }} />
              <Text variant="label" color={m.on ? colors.primary : colors.textSecondary}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Card>
      </ZippyAvoid>

      <AdvancePayoutCard dealerId={dealerId} a={advance} account={`${session?.name ?? 'Dealer'} · IDFC FIRST ••4321`} />

      <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {totals.map((t) => <StatCard key={t.s} label={t.s} sub={`${t.n} invoice${t.n === 1 ? '' : 's'}`} value={inrShort(t.amt)} tone={t.s === 'Paid' ? colors.success : t.s === 'Claimed' ? colors.text : colors.warning} />)}
      </ZippyAvoid>

      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        <Chip label="All" count={String(all.length)} on={filter === 'All'} onPress={() => setFilter('All')} />
        {totals.map((t) => <Chip key={t.s} label={t.s} count={String(t.n)} on={filter === t.s} onPress={() => setFilter(t.s)} />)}
      </View>

      <View style={{ gap: space.sm }} onLayout={sec.at('invoices')}>
        {shown.length === 0 && (
          <Card>
            {all.length === 0 ? (
              <EmptyState icon="receipt-text-clock-outline" title="No payout invoices in this range"
                body="Invoices are raised weekly from your disbursed loans. Try last month, or start a new loan to earn your next payout."
                action={range.preset === 'thisMonth' ? { label: 'Show last month', icon: 'calendar-arrow-left', onPress: () => setRange(presetRange('lastMonth')) } : { label: 'Start a new loan', icon: 'qrcode-scan', onPress: () => nav.navigate('ScanQr') }} />
            ) : (
              <EmptyState icon="filter-variant-remove" title={`No ${filter === 'All' ? '' : `${filter.toLowerCase()} `}invoices`}
                body="Nothing matches this status in the selected range. Switch the filter to see the rest."
                action={{ label: 'Show all invoices', icon: 'filter-off-outline', onPress: () => setFilter('All') }} />
            )}
          </Card>
        )}
        {shown.map((inv, idx) => {
          const expanded = open === inv.id;
          return (
            <Animated.View key={inv.id} entering={FadeInDown.delay(Math.min(idx, 6) * 50)} layout={LinearTransition.springify().damping(18)}>
              <Card style={{ gap: space.xs, padding: space.md }}>
                <PressableScale onPress={() => setOpen(expanded ? null : inv.id)} accessibilityRole="button" accessibilityLabel={`Invoice ${inv.id}, ${inr(inv.amount)}, ${inv.status}. ${expanded ? 'Hide' : 'Show'} cases`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{inv.id}</Text>
                    <Text variant="caption" color={colors.textSecondary}>{fmtDate(inv.date)} · {inv.lines.length} case{inv.lines.length > 1 ? 's' : ''}</Text>
                    {inv.utr ? (
                      // Nested press target: copying the UTR must not toggle the invoice (stop the parent press).
                      <PressableScale haptics={false} onPress={(e) => { e?.stopPropagation?.(); void copyUtr(inv.utr, utrToast.show); }}
                        accessibilityRole="button" accessibilityLabel={`UTR ${inv.utr}. Tap to copy`} hitSlop={{ top: 8, bottom: 8 }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' }}>
                        <Text variant="caption" color={colors.textSecondary} numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1 }}>UTR {inv.utr}</Text>
                        <Icon name="content-copy" size={14} color={colors.primary} />
                      </PressableScale>
                    ) : null}
                  </View>
                  {/* Amount, then the status pill on its own line under it (sized to content, never clipped). */}
                  <ZippyAvoid style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
                    <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <Text variant="h2" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{inr(inv.amount)}</Text>
                      <Pill label={inv.status} tone={TONE[inv.status]} />
                    </View>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} />
                  </ZippyAvoid>
                </PressableScale>
                {expanded && inv.lines.map((l) => (
                  <View key={l.lan} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs, gap: space.sm }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="label">{l.lan} · {l.customer}</Text>
                      <Text variant="caption" color={colors.textSecondary}>Loan {inr(l.loan)} × {l.ratePct}%</Text>
                    </View>
                    <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>{inr(l.payout)}</Text>
                  </View>
                ))}
                {inv.status === 'Not claimed' && (
                  <ZippyAvoid>
                  {/* Busy = disabled: cool grey fill + dark-grey label (≥ 4.5:1), not a 50%-faded gold pill. */}
                  <PressableScale onPress={() => claim(inv.id)} disabled={busy === inv.id} dimDisabled={false} accessibilityRole="button" accessibilityLabel={`Claim ${inv.id}`}
                    style={{ minHeight: touch.min, borderRadius: radius.pill, backgroundColor: busy === inv.id ? colors.disabledBg : colors.cta, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                    <Icon name={busy === inv.id ? 'loading' : 'hand-coin-outline'} size={18} color={busy === inv.id ? colors.onDisabled : colors.onCta} />
                    <Text variant="label" color={busy === inv.id ? colors.onDisabled : colors.onCta}>{busy === inv.id ? 'Claiming…' : 'Claim payout'}</Text>
                  </PressableScale>
                  </ZippyAvoid>
                )}
              </Card>
            </Animated.View>
          );
        })}
      </View>
    </JourneyScreen>
  );
}
