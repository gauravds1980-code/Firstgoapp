import React, { useMemo } from 'react';
import { View } from 'react-native';
import { JourneyScreen } from '../components/Screen';
import { DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, Icon, Pill, Text } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { casesFor, fmtDate } from '../services/business';
import { useApp } from '../state/AppState';
import { inRange, useDateRange } from '../state/stores';
import { colors, radius, space } from '../theme/tokens';
import { inr } from '../utils/finance';

/** Cases done = loans disbursed in the selected range (example data). */
export default function CasesScreen() {
  const { profile } = useApp();
  const [range] = useDateRange();
  const cases = useMemo(() => casesFor(profile), [profile]).filter((c) => inRange(c.disbursedOn, range));
  const amt = cases.reduce((t, c) => t + c.amount, 0);
  const tw = cases.filter((c) => c.product === 'twoWheeler').length;
  return (
    <JourneyScreen assistant="home" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Cases done</Text>
        <Text variant="body" color={colors.textSecondary}>Loans disbursed through your dealership</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <StatCard label="Cases disbursed" value={String(cases.length)} sub={tw && tw !== cases.length ? `${tw} two-wheeler · ${cases.length - tw} car` : undefined} />
        <StatCard label="Amount disbursed" value={inrShort(amt)} sub={cases.length ? `avg ${inrShort(amt / cases.length)}` : undefined} />
      </View>
      <Card style={{ padding: 0 }}>
        {cases.length === 0 && <View style={{ padding: space.md }}><Text variant="body" color={colors.textSecondary}>No cases in this range.</Text></View>}
        {cases.map((c, i) => (
          <View key={c.lan} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderBottomWidth: i === cases.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={PRODUCTS[c.product].icon} size={20} color={colors.success} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{c.customer}</Text>
              <Text variant="caption" color={colors.textSecondary}>{c.lan} · {c.vehicle}</Text>
              <Text variant="caption" color={colors.textSecondary}>Disbursed {fmtDate(c.disbursedOn)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text variant="label">{inr(c.amount)}</Text>
              <Pill label="DISBURSED" tone="success" />
            </View>
          </View>
        ))}
      </Card>
    </JourneyScreen>
  );
}
