import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { JourneyScreen } from '../components/Screen';
import { Chip, DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, Icon, Pill, PressableScale, Text } from '../components/ui';
import { casesFor, claimInvoice, fmtDate, Invoice, invoicesFor, InvoiceStatus, TODAY } from '../services/business';
import { useApp } from '../state/AppState';
import { inRange, useDateRange } from '../state/stores';
import { colors, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';

const STATUS: InvoiceStatus[] = ['Not claimed', 'Claimed', 'Paid'];
const TONE: Record<InvoiceStatus, 'warning' | 'info' | 'success'> = { 'Not claimed': 'warning', Claimed: 'info', Paid: 'success' };

/** Payout invoices with status filter chips, totals per status, per-case lines and a Claim action (example data). */
export default function PayoutsScreen() {
  const { profile, session } = useApp();
  const [range] = useDateRange();
  const base = useMemo(() => invoicesFor(casesFor(profile)), [profile]);
  const [overrides, setOverrides] = useState<Record<string, Partial<Invoice>>>({});
  const [filter, setFilter] = useState<InvoiceStatus | 'All'>('All');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const all = base.map((i) => ({ ...i, ...overrides[i.id] })).filter((i) => inRange(i.date, range));
  const totals = STATUS.map((s) => ({ s, n: all.filter((i) => i.status === s).length, amt: all.filter((i) => i.status === s).reduce((t, i) => t + i.amount, 0) }));
  const shown = filter === 'All' ? all : all.filter((i) => i.status === filter);
  const months = [2, 1, 0].map((k) => { const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - k, 1); const inv = base.filter((i) => i.date.getMonth() === d.getMonth() && i.date.getFullYear() === d.getFullYear()); return { label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()], amt: inv.reduce((t, i) => t + i.amount, 0) }; });
  const maxM = Math.max(1, ...months.map((m) => m.amt));

  const claim = async (id: string) => {
    setBusy(id); const r = await claimInvoice(id); setBusy(null);
    if (r.ok) { haptic.success(); setOverrides((o) => ({ ...o, [id]: { status: 'Claimed' } })); }
  };

  return (
    <JourneyScreen assistant="home" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Payouts</Text>
        <Text variant="body" color={colors.textSecondary}>Dealer payout invoices for {session?.name ?? 'your dealership'}</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />

      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>MONTHLY PAYOUT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md, height: 110 }}>
          {months.map((m, i) => (
            <View key={m.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <Text variant="caption" color={colors.textSecondary}>{inrShort(m.amt)}</Text>
              <View style={{ width: '70%', height: Math.max(6, (m.amt / maxM) * 64), borderRadius: 8, backgroundColor: i === 2 ? colors.primary : colors.primarySoft }} />
              <Text variant="label">{m.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {totals.map((t) => <StatCard compact key={t.s} label={t.s} sub={`${t.n} invoice${t.n === 1 ? '' : 's'}`} value={inrShort(t.amt)} tone={t.s === 'Paid' ? colors.success : t.s === 'Claimed' ? colors.text : colors.warning} />)}
      </View>

      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        <Chip label="All" count={String(all.length)} on={filter === 'All'} onPress={() => setFilter('All')} />
        {totals.map((t) => <Chip key={t.s} label={t.s} count={String(t.n)} on={filter === t.s} onPress={() => setFilter(t.s)} />)}
      </View>

      <View style={{ gap: space.sm }}>
        {shown.length === 0 && <Card><Text variant="body" color={colors.textSecondary}>No invoices for this filter and date range.</Text></Card>}
        {shown.map((inv, idx) => {
          const expanded = open === inv.id;
          return (
            <Animated.View key={inv.id} entering={FadeInDown.delay(Math.min(idx, 6) * 50)} layout={LinearTransition.springify().damping(18)}>
              <Card style={{ gap: space.xs, padding: space.md }}>
                <PressableScale onPress={() => setOpen(expanded ? null : inv.id)} accessibilityRole="button" accessibilityLabel={`Invoice ${inv.id}, ${inr(inv.amount)}, ${inv.status}. ${expanded ? 'Hide' : 'Show'} cases`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{inv.id}</Text>
                    <Text variant="caption" color={colors.textSecondary}>{fmtDate(inv.date)} · {inv.lines.length} case{inv.lines.length > 1 ? 's' : ''}{inv.utr ? ` · UTR ${inv.utr}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text variant="h3">{inr(inv.amount)}</Text>
                    <Pill label={inv.status.toUpperCase()} tone={TONE[inv.status]} />
                  </View>
                  <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} />
                </PressableScale>
                {expanded && inv.lines.map((l) => (
                  <View key={l.lan} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs, gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="label">{l.lan} · {l.customer}</Text>
                      <Text variant="caption" color={colors.textSecondary}>Loan {inr(l.loan)} × {l.ratePct}%</Text>
                    </View>
                    <Text variant="label">{inr(l.payout)}</Text>
                  </View>
                ))}
                {inv.status === 'Not claimed' && (
                  <PressableScale onPress={() => claim(inv.id)} disabled={busy === inv.id} accessibilityRole="button" accessibilityLabel={`Claim ${inv.id}`}
                    style={{ minHeight: touch.min, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                    <Icon name={busy === inv.id ? 'loading' : 'hand-coin-outline'} size={18} color={colors.text} />
                    <Text variant="label">{busy === inv.id ? 'Claiming…' : 'Claim payout'}</Text>
                  </PressableScale>
                )}
              </Card>
            </Animated.View>
          );
        })}
      </View>
    </JourneyScreen>
  );
}
