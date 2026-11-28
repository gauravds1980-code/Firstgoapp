import React from 'react';
import { View } from 'react-native';
import { Pill, PressableScale, Text } from '../ui';
import { IconWell } from '../phosphor';
import { ZippyAvoid } from '../assistant/zippyAvoid';
import { statementTone, type StatementToneName } from '../../theme/library';
import { colors, space } from '../../theme/tokens';
import { NB_HYPHEN } from '../../navigation/types';
import type { ProductId } from '../../config/products';

export type PayoutLineStatus = 'Short paid' | 'Paid' | 'Claimed' | 'Not claimed';
const PILL: Record<PayoutLineStatus, 'danger' | 'success' | 'info' | 'warning'> = { 'Short paid': 'danger', Paid: 'success', Claimed: 'info', 'Not claimed': 'warning' };

export interface PayoutLineRowModel {
  key: string; customer: string; vehicle?: string; lan: string; product?: ProductId;
  /** Right-hand amount (paid once posted, else expected). */
  amount: string; amountTone?: StatementToneName;
  /** "Exp ₹8,400 · Paid ₹4,200" and its tone (danger short, success matched, caption otherwise). */
  figures: string; figuresTone?: StatementToneName;
  status: PayoutLineStatus;
  /** Small caption: itemised deduction, "₹40 rounding", "Query PAY-0320 open". */
  note?: string; noteTone?: StatementToneName;
}

/**
 * Design library (v1.4.8, feature 3): one commission line on the payout statement. Product well, customer,
 * vehicle · LAN, expected vs paid, optional note; amount and status Pill on the right (Pill under the amount so
 * neither truncates at 360dp). Tapping opens the line sheet.
 */
export function PayoutLineRow({ row, onPress, last }: { row: PayoutLineRowModel; onPress?: () => void; last?: boolean }) {
  const a11y = [row.customer, row.vehicle, row.lan, row.figures, row.status, row.note].filter(Boolean).join(', ');
  return (
    <PressableScale onPress={onPress} disabled={!onPress} dimDisabled={false} accessibilityRole="button" accessibilityLabel={`${a11y}. Open line`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: statementTone.divider }}>
      <IconWell name={row.product ?? 'car'} bg={statementTone.rowWell} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{row.customer}</Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{row.vehicle ? `${row.vehicle} · ` : ''}{row.lan.replace('-', NB_HYPHEN)}</Text>
        <Text variant="caption" color={statementTone[row.figuresTone ?? 'caption']} numberOfLines={2} style={{ fontVariant: ['tabular-nums'] }}>{row.figures}</Text>
        {row.note ? <Text variant="caption" color={statementTone[row.noteTone ?? 'caption']} numberOfLines={2}>{row.note}</Text> : null}
      </View>
      <ZippyAvoid style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <Text variant="label" color={statementTone[row.amountTone ?? 'neutral']} style={{ fontVariant: ['tabular-nums'] }}>{row.amount}</Text>
        <Pill label={row.status} tone={PILL[row.status]} />
      </ZippyAvoid>
    </PressableScale>
  );
}
