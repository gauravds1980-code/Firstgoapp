import React, { useMemo } from 'react';
import { View } from 'react-native';
import { JourneyScreen } from '../components/Screen';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { DateFilterBar, ExampleTag, inrShort, StatCard } from '../components/business';
import { Card, EmptyState, Icon, Pill, Text } from '../components/ui';
import { useNavigation } from '@react-navigation/native';
import { PRODUCTS } from '../config/products';
import { casesFor, fmtDateShort } from '../services/business';
import { NB_HYPHEN } from '../navigation/types';
import { useApp } from '../state/AppState';
import { inRange, presetRange, useDateRange } from '../state/stores';
import { colors, radius, space } from '../theme/tokens';
import { inr } from '../utils/finance';

/** Cases done = loans disbursed in the selected range (example data). */
export default function CasesScreen() {
  const nav = useNavigation();
  const { profile, categories } = useApp();
  const [range, setRange] = useDateRange();
  const cases = useMemo(() => casesFor(profile), [profile]).filter((c) => inRange(c.disbursedOn, range));
  const amt = cases.reduce((t, c) => t + c.amount, 0);
  // "12 Two Wheeler · 3 Car · 2 Commercial Vehicle" — only when the dealer has more than one product.
  const mix = categories.length > 1 ? categories.map((p) => `${cases.filter((c) => c.product === p).length} ${PRODUCTS[p].label}`).join(' · ') : undefined;
  return (
    <JourneyScreen title="Cases done" titleInBody assistant="cases" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Cases done</Text>
        <Text variant="body" color={colors.textSecondary}>Loans disbursed through your dealership</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />
      <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <StatCard label="Cases disbursed" value={String(cases.length)} sub={cases.length ? mix : undefined} />
        <StatCard label="Amount disbursed" value={inrShort(amt)} sub={cases.length ? `avg ${inrShort(amt / cases.length)}` : undefined} />
      </ZippyAvoid>
      <Card style={{ padding: 0 }}>
        {cases.length === 0 && (
          <EmptyState icon="file-check-outline" title="No cases disbursed in this range"
            body={range.preset === 'thisMonth' ? 'Your first disbursal this month shows up here. Check last month, or start a new loan.' : 'Try a wider date range, or start a new loan.'}
            action={range.preset === 'thisMonth' ? { label: 'Show last month', icon: 'calendar-arrow-left', onPress: () => setRange(presetRange('lastMonth')) } : { label: 'Start a new loan', icon: 'qrcode-scan', onPress: () => nav.navigate('ScanQr') }} />
        )}
        {cases.map((c, i) => (
          <View key={c.lan} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderBottomWidth: i === cases.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={PRODUCTS[c.product].icon} size={20} color={colors.success} />
            </View>
            {/* v1.3.0: vehicle on its own line; ID + short date (no year in the current year) on the next. */}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodyStrong">{c.customer}</Text>
              <Text variant="caption" color={colors.textSecondary}>{c.vehicle}</Text>
              <Text variant="caption" color={colors.textSecondary}>{c.lan.replace('-', NB_HYPHEN)} · Disbursed {fmtDateShort(c.disbursedOn)}</Text>
            </View>
            <ZippyAvoid style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <Text variant="label">{inr(c.amount)}</Text>
              <Pill label="Disbursed" tone="success" />
            </ZippyAvoid>
          </View>
        ))}
      </Card>
    </JourneyScreen>
  );
}
