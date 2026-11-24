import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { JourneyScreen } from '../components/Screen';
import { ExampleTag, inrShort } from '../components/business';
import { Banner, Card, Icon, ReadOnlyRow, Text } from '../components/ui';
import { fmtDate, Limit, taInfFor, TODAY } from '../services/business';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { inr } from '../utils/finance';

/** Trade Advance and Inventory Funding limits — shown only for dealers that have them (example data). */
export default function TaInfScreen() {
  const { profile } = useApp();
  if (!profile?.hasTaInf) {
    return (
      <JourneyScreen title="TA / INF limits" assistant="tainf" showTerms={false}>
        <Banner tone="info" title="No TA / INF limits" body="Your dealership doesn't have Trade Advance or Inventory Funding with IDFC FIRST. Contact your relationship manager to apply." />
      </JourneyScreen>
    );
  }
  const limits = taInfFor(profile);
  return (
    <JourneyScreen title="TA / INF limits" assistant="tainf" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">TA / INF limits</Text>
        <Text variant="body" color={colors.textSecondary}>Trade Advance and Inventory Funding with IDFC FIRST</Text>
        <ExampleTag />
      </View>
      {limits.map((l, i) => <LimitCard key={l.key} l={l} index={i} />)}
    </JourneyScreen>
  );
}

function LimitCard({ l, index }: { l: Limit; index: number }) {
  const reduce = useReducedMotion();
  const pct = l.utilised / l.sanctioned;
  const p = useSharedValue(reduce ? pct : 0);
  useEffect(() => { if (!reduce) p.value = withDelay(200 + index * 200, withTiming(pct, { duration: 900, easing: Easing.out(Easing.cubic) })); }, [p, pct, index, reduce]);
  const bar = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  const tone = pct > 0.8 ? colors.danger : pct > 0.6 ? colors.cta : colors.successBright;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={l.key === 'TA' ? 'swap-horizontal-bold' : 'warehouse'} size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{l.name} ({l.key})</Text>
          <Text variant="caption" color={colors.textSecondary}>{l.tenor} · {l.roi}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Metric label="Sanctioned" value={inrShort(l.sanctioned)} />
        <Metric label="Utilised" value={inrShort(l.utilised)} />
        <Metric label="Available" value={inrShort(l.sanctioned - l.utilised)} tone={colors.success} />
      </View>
      <View style={{ gap: 4 }} accessibilityLabel={`${Math.round(pct * 100)} percent utilised`}>
        <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 12, borderRadius: 6, backgroundColor: tone }, bar]} />
        </View>
        <Text variant="caption" color={colors.textSecondary}>{Math.round(pct * 100)}% utilised</Text>
      </View>
      <Text variant="label" color={colors.textSecondary}>UPCOMING DUES</Text>
      {l.dues.map((d) => {
        const days = Math.round((d.due.getTime() - TODAY.getTime()) / 864e5);
        return (
          <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs }}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{d.label}</Text>
              <Text variant="caption" color={days <= 5 ? colors.danger : colors.textSecondary}>Due {fmtDate(d.due)} · in {days} day{days === 1 ? '' : 's'}</Text>
            </View>
            <Text variant="label">{inr(d.amount)}</Text>
          </View>
        );
      })}
      <ReadOnlyRow label="Total due next 30 days" value={inr(l.dues.reduce((t, d) => t + d.amount, 0))} strong />
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
