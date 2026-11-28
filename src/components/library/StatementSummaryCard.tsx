import React from 'react';
import { View } from 'react-native';
import { Card, Text } from '../ui';
import { ZippyAvoid } from '../assistant/zippyAvoid';
import { statementTone, type StatementToneName } from '../../theme/library';
import { fontScaleCap, space } from '../../theme/tokens';

export interface StatementFigure { label: string; value: string; tone?: StatementToneName }

/**
 * Design library (v1.4.8, feature 3): the period summary at the top of the payout statement. Period label, one hero
 * line (ready to claim → warning; a short-pay difference → danger; all caught up → success), an optional danger
 * caption, three figures (Expected · Paid · Difference), small notes (itemised deductions, rounding) and the
 * "not a tax invoice" footnote. Strings come pre-formatted from services/payoutStatement.ts.
 */
export function StatementSummaryCard({ period, hero, heroTone, caption, figures, notes, footnote = 'Statement of payouts, not a tax invoice.' }: {
  period: string; hero: string; heroTone: StatementToneName; caption?: string; figures: StatementFigure[]; notes?: string[]; footnote?: string;
}) {
  const a11y = [period, hero, caption, ...figures.map((f) => `${f.label} ${f.value}`), ...(notes ?? [])].filter(Boolean).join('. ');
  return (
    <Card style={{ gap: space.xs }}>
      <View accessible accessibilityRole="summary" accessibilityLabel={a11y} style={{ gap: space.xs }}>
        <Text variant="caption" color={statementTone.caption} maxFontSizeMultiplier={fontScaleCap.compact}>{period}</Text>
        <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          <Text variant="h1" color={statementTone[heroTone]} numberOfLines={2} maxFontSizeMultiplier={fontScaleCap.compact} style={{ fontVariant: ['tabular-nums'] }}>{hero}</Text>
        </ZippyAvoid>
        {caption ? <Text variant="label" color={statementTone.danger} maxFontSizeMultiplier={fontScaleCap.compact}>{caption}</Text> : null}
        <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xxs }}>
          {figures.map((f) => (
            <View key={f.label} style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="caption" color={statementTone.label} numberOfLines={1}>{f.label}</Text>
              <Text variant="h3" color={statementTone[f.tone ?? 'neutral']} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontVariant: ['tabular-nums'] }}>{f.value}</Text>
            </View>
          ))}
        </ZippyAvoid>
        {(notes ?? []).map((n) => <Text key={n} variant="caption" color={statementTone.caption}>{n}</Text>)}
        <Text variant="caption" color={statementTone.caption}>{footnote}</Text>
      </View>
    </Card>
  );
}
