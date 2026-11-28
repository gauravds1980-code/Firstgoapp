import React from 'react';
import { Text } from '../ui';
import { ageingBand, ageingText, type BlockerOwner } from '../../theme/library';
import { colors } from '../../theme/tokens';

/**
 * Design library: the closed-list blocker label under a file ("RC copy pending · 6 days"). Caption, secondary ink
 * (danger when the file is overdue). Never a free-text ops comment, never a chip. `owner` is for the caller's CTA
 * decision and is not drawn.
 */
export function BlockerCaption({ label, days, owner: _owner }: { label?: string; days?: number; owner?: BlockerOwner }) {
  const parts = [label, days === undefined ? undefined : days === 1 ? '1 day' : `${days} days`].filter(Boolean);
  if (!parts.length) return null;
  const color = days === undefined ? colors.textSecondary : ageingText[ageingBand(days)];
  return <Text variant="caption" color={color} numberOfLines={2}>{parts.join(' · ')}</Text>;
}
