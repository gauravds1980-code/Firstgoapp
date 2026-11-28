import React from 'react';
import { View } from 'react-native';
import { Pill, Text } from '../ui';
import { AGEING_LABEL, ageingBand, ageingText, ageingTone } from '../../theme/library';
import { space } from '../../theme/tokens';

/**
 * Design library: ageing of an UNCREDITED file (hide it for credited files). 0–1 day On time, 2–3 Ageing, 4+ Overdue.
 * `showDays` puts "6 days" beside the pill (caption, danger when overdue).
 */
export function AgeingPill({ days, showDays = false }: { days: number; showDays?: boolean }) {
  const band = ageingBand(days);
  const pill = <Pill label={AGEING_LABEL[band]} tone={ageingTone[band]} />;
  if (!showDays) return pill;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Text variant="caption" color={ageingText[band]}>{days === 1 ? '1 day' : `${days} days`}</Text>
      {pill}
    </View>
  );
}
