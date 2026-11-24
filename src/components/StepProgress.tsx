import React from 'react';
import { View } from 'react-native';
import { JOURNEY_STEPS, JourneyStep } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, space } from '../theme/tokens';
import { waiverPlan } from '../utils/waivers';
import { Text } from './ui';

/**
 * Journey progress. Steps already on file with the bank (KYC / AutoPay mandate for ETB customers)
 * are drawn as gold "skipped" segments and never offered as "Next", so the stepper matches the
 * screens the dealer actually sees.
 */
export function StepProgress({ step }: { step: JourneyStep }) {
  const { journey, product } = useApp();
  const plan = waiverPlan(journey, product);
  const skipped = (k: JourneyStep) => (k === 'kyc' && plan.kyc) || (k === 'mandate' && plan.mandate);
  const idx = Math.max(0, JOURNEY_STEPS.findIndex((s) => s.key === step));
  const next = JOURNEY_STEPS.slice(idx + 1).find((s) => !skipped(s.key));
  const skippedLabels = JOURNEY_STEPS.filter((s) => skipped(s.key)).map((s) => (s.key === 'kyc' ? 'KYC' : 'Mandate'));
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: space.sm, gap: space.xs }}
      accessibilityLabel={`Step ${idx + 1} of ${JOURNEY_STEPS.length}: ${JOURNEY_STEPS[idx].label}${skippedLabels.length ? `. ${skippedLabels.join(' and ')} on file, skipped` : ''}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text variant="label" color={colors.primary} style={{ flexShrink: 1 }}>Step {idx + 1} of {JOURNEY_STEPS.length} · {JOURNEY_STEPS[idx].label}</Text>
        {next && <Text variant="caption" color={colors.textSecondary}>Next: {next.label}</Text>}
      </View>
      <View style={{ flexDirection: 'row', gap: space.xxs }}>
        {JOURNEY_STEPS.map((s, i) => (
          <View key={s.key} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: skipped(s.key) ? colors.accent : i <= idx ? colors.primary : colors.border }} />
        ))}
      </View>
      {skippedLabels.length > 0 && <Text variant="caption" color={colors.textSecondary}>{skippedLabels.join(' + ')} on file with bank · step skipped</Text>}
    </View>
  );
}
