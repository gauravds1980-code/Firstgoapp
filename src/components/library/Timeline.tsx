import React from 'react';
import { View } from 'react-native';
import { Icon, Text } from '../ui';
import { timelineColors as tc } from '../../theme/library';
import { colors, space } from '../../theme/tokens';

export type TimelineState = 'done' | 'current' | 'future';
export interface TimelineItem { key: string; title: string; detail?: string; time?: string; state: TimelineState; detailTone?: string }

/** Design library: vertical stage timeline (case sheet; later payout statement / TAT). Same language as Disbursal's. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <View accessibilityRole="list">
      {items.map((it, i) => <TimelineRow key={it.key} item={it} last={i === items.length - 1} nextDone={items[i + 1]?.state !== 'future'} />)}
    </View>
  );
}

export function TimelineRow({ item, last, nextDone }: { item: TimelineItem; last: boolean; nextDone: boolean }) {
  const dot = item.state === 'done'
    ? { bg: tc.doneBg, fg: tc.doneFg, icon: 'check' as const }
    : item.state === 'current' ? { bg: tc.currentBg, fg: tc.currentFg, icon: 'circle-medium' as const } : { bg: tc.futureBg, fg: tc.futureFg, icon: null };
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }} accessible accessibilityLabel={`${item.title}${item.state === 'current' ? ', current stage' : item.state === 'done' ? ', done' : ''}${item.detail ? `, ${item.detail}` : ''}${item.time ? `, ${item.time}` : ''}`}>
      <View style={{ alignItems: 'center', width: 32 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: dot.bg, alignItems: 'center', justifyContent: 'center', borderWidth: item.state === 'future' ? 1 : 0, borderColor: colors.border }}>
          {dot.icon ? <Icon name={dot.icon} size={item.state === 'current' ? 22 : 18} color={dot.fg} /> : null}
        </View>
        {!last && <View style={{ width: 2, flex: 1, minHeight: space.md, backgroundColor: item.state === 'done' && nextDone ? tc.connectorDone : tc.connector, opacity: item.state === 'done' && nextDone ? 0.35 : 1 }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : space.md, paddingTop: 5, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} color={item.state === 'future' ? colors.textSecondary : colors.text}>{item.title}</Text>
          {item.time ? <Text variant="label" color={item.state === 'current' ? tc.currentTime : colors.textSecondary} style={{ fontVariant: ['tabular-nums'] }}>{item.time}</Text> : null}
        </View>
        {item.detail ? <Text variant="caption" color={item.detailTone ?? colors.textSecondary}>{item.detail}</Text> : null}
      </View>
    </View>
  );
}
