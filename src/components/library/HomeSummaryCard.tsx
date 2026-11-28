import React from 'react';
import { View } from 'react-native';
import { Card, Icon, PressableScale, Skeleton, Text } from '../ui';
import { ZippyAvoid } from '../assistant/zippyAvoid';
import { summaryTone } from '../../theme/library';
import { colors, fontScaleCap, radius, space, touch } from '../../theme/tokens';

export interface SummaryLine { text: string; tone: 'overdue' | 'calm' | 'credited' }

/**
 * Design library: a Home section card (overline + "View all", hero line, coloured sublines, optional AlertCard slot,
 * up to two preview rows, empty state). The whole card opens the list. Feature 1 = Money in flight; later Home habit
 * cards (videos, leads) reuse it.
 */
export function HomeSummaryCard({ overline, hero, lines, alert, rows, empty, onPress, onViewAll, loading, a11y }: {
  overline: string; hero?: string; lines?: SummaryLine[]; alert?: React.ReactNode; rows?: React.ReactNode; empty?: string;
  onPress: () => void; onViewAll?: () => void; loading?: boolean; a11y?: string;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch.min }}>
        <ZippyAvoid weight="soft" style={{ flexShrink: 1 }}>
          <Text variant="overline" color={summaryTone.overline} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{overline.toUpperCase()}</Text>
        </ZippyAvoid>
        {onViewAll ? (
          <ZippyAvoid style={{ flexShrink: 0 }}>
            <PressableScale onPress={onViewAll} accessibilityRole="link" accessibilityLabel={`View all ${overline}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: touch.min, paddingLeft: space.md }}>
              <Text variant="bodyStrong" color={summaryTone.link} maxFontSizeMultiplier={fontScaleCap.control}>View all</Text>
              <Icon name="chevron-right" size={20} color={summaryTone.link} />
            </PressableScale>
          </ZippyAvoid>
        ) : null}
      </View>
      <Card style={{ gap: space.sm }}>
        {loading ? (
          <View style={{ gap: space.xs }}><Skeleton w="70%" h={28} /><Skeleton w="50%" /><Skeleton h={56} r={radius.md} /></View>
        ) : empty ? (
          <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={empty} style={{ minHeight: touch.min, justifyContent: 'center' }}>
            <Text variant="body" color={colors.textSecondary}>{empty}</Text>
          </PressableScale>
        ) : (
          <>
            <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? [hero, ...(lines ?? []).map((l) => l.text)].filter(Boolean).join('. ')} style={{ gap: 2 }}>
              {hero ? <Text variant="h1" numberOfLines={2} maxFontSizeMultiplier={fontScaleCap.compact} style={{ fontVariant: ['tabular-nums'] }}>{hero}</Text> : null}
              {lines?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xs }}>
                  {lines.map((l, i) => (
                    <Text key={l.text} variant="label" color={summaryTone[l.tone]} maxFontSizeMultiplier={fontScaleCap.compact}>{i ? '· ' : ''}{l.text}</Text>
                  ))}
                </View>
              ) : null}
            </PressableScale>
            {alert}
            {rows ? <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>{rows}</View> : null}
          </>
        )}
      </Card>
    </View>
  );
}
