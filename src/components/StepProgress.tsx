import React from 'react';
import { View } from 'react-native';
import { FINAL_STEP_NEXT, JOURNEY_STEPS, JourneyStep } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, fontScaleCap, space } from '../theme/tokens';
import { waiverPlan } from '../utils/waivers';
import { Icon, Text } from './ui';

/**
 * Journey progress (5 steps). Both labels stay on ONE line ("Step 3/5 · Mandate" · "Next: e‑sign"), so the
 * header keeps the same height on every step. Steps already on file with the bank (KYC / AutoPay
 * mandate for ETB customers) are drawn as gold segments labelled "✓ On file" and never offered as "Next".
 *
 * `interstitial` (the "checking bank records" beat between steps) shows that title with no step number.
 * A step that is not on the tracker (e.g. 'disbursal', the automatic final screen, or 'offer') renders nothing.
 * The last step's "Next:" is FINAL_STEP_NEXT ("Auto-disbursal").
 */
export function StepProgress({ step, interstitial }: { step: JourneyStep; interstitial?: string }) {
  const { journey, product } = useApp();
  const plan = waiverPlan(journey, product);
  const skipped = (k: JourneyStep) => (k === 'kyc' && plan.kyc) || (k === 'mandate' && plan.mandate);
  const idx = JOURNEY_STEPS.findIndex((s) => s.key === step);
  if (idx < 0) return null;
  const last = idx === JOURNEY_STEPS.length - 1;
  const next = last ? FINAL_STEP_NEXT : JOURNEY_STEPS.slice(idx + 1).find((s) => !skipped(s.key));
  const anySkipped = JOURNEY_STEPS.some((s) => skipped(s.key));
  const skippedLabels = JOURNEY_STEPS.filter((s) => skipped(s.key)).map((s) => s.label);
  const a11y = interstitial
    ? `${interstitial}${skippedLabels.length ? `. ${skippedLabels.join(' and ')} on file` : ''}`
    : `Step ${idx + 1} of ${JOURNEY_STEPS.length}: ${JOURNEY_STEPS[idx].label}${next ? `. Next: ${next.label}` : ''}${skippedLabels.length ? `. ${skippedLabels.join(' and ')} on file, skipped` : ''}`;
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: space.sm, gap: space.xs }} accessible accessibilityLabel={a11y}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="label" color={colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control} style={{ flex: 1, minWidth: 0 }}>
          {interstitial ?? `Step ${idx + 1}/${JOURNEY_STEPS.length} · ${JOURNEY_STEPS[idx].short}`}
        </Text>
        {!interstitial && next && (
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control} style={{ flexShrink: 1, maxWidth: '45%' }}>Next: {next.short}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: space.xxs }}>
        {JOURNEY_STEPS.map((s, i) => (
          <View key={s.key} style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: skipped(s.key) ? colors.accent : (interstitial ? i < idx : i <= idx) ? colors.primary : colors.border }} />
            {anySkipped && (
              skipped(s.key) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <Icon name="check" size={11} color={colors.ctaDark} />
                  <Text variant="caption" color={colors.ctaDark} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontSize: 10, lineHeight: 14, flexShrink: 1 }}>On file</Text>
                </View>
              ) : <View style={{ height: 14 }} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
