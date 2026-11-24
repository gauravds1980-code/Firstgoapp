import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { JourneyScreen } from '../components/Screen';
import { Chip, DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, Icon, Pill, Text } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { Bucket, BUCKETS, bucketOf, casesFor, fmtDate } from '../services/business';
import { useApp } from '../state/AppState';
import { inRange, useDateRange } from '../state/stores';
import { colors, radius, space } from '../theme/tokens';
import { inr } from '../utils/finance';

const BUCKET_COLOR: Record<Bucket, string> = { Current: colors.successBright, '1–30': colors.cta, '31–60': '#E07B24', '61–90': colors.danger, '90+': colors.primaryDark };

/** Active portfolio sourced by the dealer: count, POS, DPD bucket split and cases (example data). */
export default function PortfolioScreen() {
  const { profile } = useApp();
  const [range] = useDateRange();
  const [bucket, setBucket] = useState<Bucket | 'All'>('All');
  const cases = useMemo(() => casesFor(profile), [profile]).filter((c) => inRange(c.disbursedOn, range));
  const pos = cases.reduce((t, c) => t + c.pos, 0);
  const split = BUCKETS.map((b) => { const cs = cases.filter((c) => bucketOf(c.dpd) === b); return { b, n: cs.length, pos: cs.reduce((t, c) => t + c.pos, 0) }; });
  const shown = bucket === 'All' ? cases : cases.filter((c) => bucketOf(c.dpd) === bucket);
  const overdue = split.filter((s) => s.b !== 'Current').reduce((t, s) => t + s.pos, 0);
  return (
    <JourneyScreen assistant="home" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Portfolio</Text>
        <Text variant="body" color={colors.textSecondary}>Active loans you sourced, by disbursal date</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <StatCard label="Active loans" value={String(cases.length)} sub="disbursed in range" />
        <StatCard label="Outstanding (POS)" value={inrShort(pos)} sub={`${pos ? Math.round((overdue / pos) * 100) : 0}% overdue`} />
      </View>
      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>DPD BUCKETS (BY POS)</Text>
        <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surfaceMuted }} accessibilityLabel={split.map((s) => `${s.b}: ${s.n} loans`).join(', ')}>
          {split.filter((s) => s.pos > 0).map((s) => <View key={s.b} style={{ flex: s.pos, backgroundColor: BUCKET_COLOR[s.b] }} />)}
        </View>
        {split.map((s) => (
          <View key={s.b} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: BUCKET_COLOR[s.b] }} />
            <Text variant="body" style={{ flex: 1 }}>{s.b === 'Current' ? 'Current (0 DPD)' : `${s.b} DPD`}</Text>
            <Text variant="label" color={colors.textSecondary}>{s.n} · {inrShort(s.pos)}</Text>
          </View>
        ))}
      </Card>
      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        <Chip label="All" on={bucket === 'All'} onPress={() => setBucket('All')} count={String(cases.length)} />
        {split.filter((s) => s.n > 0).map((s) => <Chip key={s.b} label={s.b} on={bucket === s.b} onPress={() => setBucket(s.b)} count={String(s.n)} />)}
      </View>
      <Card style={{ padding: 0 }}>
        {shown.length === 0 && <View style={{ padding: space.md }}><Text variant="body" color={colors.textSecondary}>No loans in this range.</Text></View>}
        {shown.map((c, i) => (
          <View key={c.lan} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderBottomWidth: i === shown.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={PRODUCTS[c.product].icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{c.customer}</Text>
              <Text variant="caption" color={colors.textSecondary}>{c.lan} · {c.vehicle} · {fmtDate(c.disbursedOn)}</Text>
              <Text variant="caption" color={colors.textSecondary}>POS {inr(c.pos)} of {inr(c.amount)}</Text>
            </View>
            <Pill label={c.dpd ? `${c.dpd} DPD` : 'CURRENT'} tone={c.dpd === 0 ? 'success' : c.dpd <= 30 ? 'warning' : 'danger'} />
          </View>
        ))}
      </Card>
    </JourneyScreen>
  );
}
