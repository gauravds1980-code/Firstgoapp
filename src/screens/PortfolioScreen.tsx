import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { JourneyScreen } from '../components/Screen';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Chip, DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, EmptyState, Pill, PressableScale, Text } from '../components/ui';
import { CaseDetailSheet, useCaseRows } from '../components/CaseDetailSheet';
import { IconWell } from '../components/phosphor';
import { presetRange } from '../state/stores';
import { Bucket, BUCKETS, bucketOf, casesFor, fmtDate } from '../services/business';
import { useApp } from '../state/AppState';
import { inRange, useDateRange } from '../state/stores';
import { colors, space } from '../theme/tokens';
import { inr } from '../utils/finance';

const BUCKET_COLOR: Record<Bucket, string> = { Current: colors.successBright, '1–30': colors.cta, '31–60': '#E07B24', '61–90': colors.danger, '90+': colors.primaryDark };

/** Active portfolio sourced by the dealer: count, POS, DPD bucket split and cases (example data). */
export default function PortfolioScreen() {
  const { profile } = useApp();
  const [range, setRange] = useDateRange();
  const [bucket, setBucket] = useState<Bucket | 'All'>('All');
  const all = useMemo(() => casesFor(profile), [profile]);
  const cases = useMemo(() => all.filter((c) => inRange(c.disbursedOn, range)), [all, range]);
  const pos = cases.reduce((t, c) => t + c.pos, 0);
  const split = BUCKETS.map((b) => { const cs = cases.filter((c) => bucketOf(c.dpd) === b); return { b, n: cs.length, pos: cs.reduce((t, c) => t + c.pos, 0) }; });
  const shown = useMemo(() => (bucket === 'All' ? cases : cases.filter((c) => bucketOf(c.dpd) === bucket)), [cases, bucket]);
  // v1.4.5 S2.7: rows open the loan (tap or voice "open Rahul Sharma"); the rows on screen are the voice options.
  const rows = useCaseRows('Portfolio', shown);
  const overdue = split.filter((s) => s.b !== 'Current').reduce((t, s) => t + s.pos, 0);
  return (
    <JourneyScreen title="Portfolio" titleInBody assistant="portfolio" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Portfolio</Text>
        <Text variant="body" color={colors.textSecondary}>Active loans you sourced, by disbursal date</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />
      <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <StatCard label="Active loans" value={String(cases.length)} sub="disbursed in range" />
        <StatCard label="Outstanding (POS)" value={inrShort(pos)} sub={`${pos ? Math.round((overdue / pos) * 100) : 0}% overdue`} />
      </ZippyAvoid>
      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>DPD BUCKETS (BY POS)</Text>
        <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surfaceMuted }} accessibilityLabel={split.map((s) => `${s.b}: ${s.n} loans`).join(', ')}>
          {split.filter((s) => s.pos > 0).map((s) => <View key={s.b} style={{ flex: s.pos, backgroundColor: BUCKET_COLOR[s.b] }} />)}
        </View>
        {split.map((s) => (
          <View key={s.b} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {/* Legend swatch + bucket name: an avoid-rect hugging the text, like the value column. */}
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              <ZippyAvoid style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: BUCKET_COLOR[s.b] }} />
                <Text variant="body">{s.b === 'Current' ? 'Current (0 DPD)' : `${s.b} DPD`}</Text>
              </ZippyAvoid>
            </View>
            {/* Value column is an avoid-rect, so floating Zippy never covers "21 · ₹…". */}
            <ZippyAvoid><Text variant="label" color={colors.textSecondary}>{s.n} · {inrShort(s.pos)}</Text></ZippyAvoid>
          </View>
        ))}
      </Card>
      {/* Bucket filter chips: an avoid-rect, so floating Zippy never covers a chip. */}
      <ZippyAvoid style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        <Chip label="All" on={bucket === 'All'} onPress={() => setBucket('All')} count={String(cases.length)} />
        {split.filter((s) => s.n > 0).map((s) => <Chip key={s.b} label={s.b} on={bucket === s.b} onPress={() => setBucket(s.b)} count={String(s.n)} />)}
      </ZippyAvoid>
      <Card style={{ padding: 0 }}>
        {shown.length === 0 && (cases.length === 0
          ? <EmptyState icon="chart-donut" title="No active loans in this range" body="Loans you source appear here after disbursal. Widen the date range to see older loans."
              action={range.preset === 'thisMonth' ? { label: 'Show last month', icon: 'calendar-arrow-left', onPress: () => setRange(presetRange('lastMonth')) } : undefined} />
          : <EmptyState tone="success" icon="check-decagram-outline" title={`No loans in ${bucket} DPD`} body="Nobody in this bucket right now. Tap All to see every loan."
              action={{ label: 'Show all loans', icon: 'filter-off-outline', onPress: () => setBucket('All') }} />)}
        {shown.map((c, i) => (
          <PressableScale key={c.lan} onPress={() => rows.openLan(c.lan)} accessibilityRole="button" accessibilityLabel={`${c.customer}, ${c.vehicle}, ${c.dpd ? `${c.dpd} days past due` : 'current'}. Open loan`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderBottomWidth: i === shown.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            {/* design-a: Phosphor fill glyph in the Portfolio (teal) well, white glyph ≥ 7.4:1. */}
            <IconWell name={c.product} bg={colors.tileTeal} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodyStrong">{c.customer}</Text>
              <Text variant="caption" color={colors.textSecondary}>{c.lan} · {c.vehicle} · {fmtDate(c.disbursedOn)}</Text>
              <Text variant="caption" color={colors.textSecondary}>POS {inr(c.pos)} of {inr(c.amount)}</Text>
            </View>
            <ZippyAvoid><Pill label={c.dpd ? `${c.dpd} DPD` : 'Current'} tone={c.dpd === 0 ? 'success' : c.dpd <= 30 ? 'warning' : 'danger'} /></ZippyAvoid>
          </PressableScale>
        ))}
      </Card>
      <CaseDetailSheet c={rows.open} onClose={() => rows.openLan(null)} />
    </JourneyScreen>
  );
}
