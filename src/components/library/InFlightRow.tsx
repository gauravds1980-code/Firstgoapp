import React from 'react';
import { View } from 'react-native';
import { PressableScale, Text } from '../ui';
import { IconWell } from '../phosphor';
import { ZippyAvoid } from '../assistant/zippyAvoid';
import { StageChip } from './StageChip';
import { AgeingPill } from './AgeingPill';
import { BlockerCaption } from './BlockerCaption';
import { inFlightWell, type MifStage } from '../../theme/library';
import { colors, space } from '../../theme/tokens';
import { NB_HYPHEN } from '../../navigation/types';
import type { ProductId } from '../../config/products';

export interface InFlightRowModel {
  key: string; customer: string; vehicle: string; lan: string; product: ProductId; amount: string; stage: MifStage;
  /** Uncredited: blocker label + days in stage (drives the AgeingPill). Credited: `note` (e.g. "Credited today, 9:43 AM"). */
  blocker?: string; days?: number; note?: string;
}

/**
 * Design library: one Money-in-flight file (list rows and the Home card preview). Product well, customer, vehicle · LAN,
 * blocker + days (or the credit note), amount, StageChip and AgeingPill (uncredited only). Pills sit under the amount so
 * neither is ever truncated at 360dp.
 */
export function InFlightRow({ row, onPress, last, compact }: { row: InFlightRowModel; onPress?: () => void; last?: boolean; compact?: boolean }) {
  const credited = row.stage === 'credited';
  const a11y = [row.customer, row.vehicle, row.amount, row.stage === 'credited' ? 'credited' : row.blocker, row.days !== undefined && !credited ? `${row.days} days in stage` : row.note].filter(Boolean).join(', ');
  return (
    <PressableScale onPress={onPress} disabled={!onPress} dimDisabled={false} accessibilityRole="button" accessibilityLabel={`${a11y}. Open file`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: compact ? 0 : space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <IconWell name={row.product} bg={inFlightWell} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{row.customer}</Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{row.vehicle} · {row.lan.replace('-', NB_HYPHEN)}</Text>
        {credited ? (row.note ? <Text variant="caption" color={colors.success} numberOfLines={1}>{row.note}</Text> : null)
          : <BlockerCaption label={row.blocker} days={row.days} />}
      </View>
      <ZippyAvoid style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>{row.amount}</Text>
        <StageChip stage={row.stage} />
        {!credited && row.days !== undefined ? <AgeingPill days={row.days} /> : null}
      </ZippyAvoid>
    </PressableScale>
  );
}
