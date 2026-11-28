import React from 'react';
import { View } from 'react-native';
import { Sheet } from '../Sheet';
import { Button, PressableScale, Text } from '../ui';
import { ExampleTag } from '../business';
import { IconWell } from '../phosphor';
import { VoiceAnswerCard } from './VoiceAnswerCard';
import { inFlightWell } from '../../theme/library';
import { colors, space, touch } from '../../theme/tokens';
import { inr } from '../../utils/finance';
import { SEGMENT_LABEL, statusCaption, type StatusFile } from '../../services/loanStatus';

/**
 * Design library (feature 5, v1.4.9): "Which one?" when a spoken name matches more than one file across applications,
 * Money in flight and Cases. Compact tappable rows (product well, name, vehicle · segment or LAN, stage); the gold
 * button stays disabled — tapping a row, or saying the vehicle / LAN tail / full name, chooses. "proceed" never
 * guesses. Not destructive, so no Confirm. `inline`: drawn under the voice mic (VoiceHost), not in a Modal.
 */
export function ClarifySheet({ visible, name, question, answer, options, onChoose, onClose }: {
  visible: boolean; name: string; question?: string; answer: string; options: readonly StatusFile[];
  onChoose: (f: StatusFile) => void; onClose: () => void;
}) {
  return (
    <Sheet inline visible={visible} onClose={onClose} title="Which one?" subtitle={`You said “${name}”`}
      footer={<Button label="Choose a file" disabled accessibilityHint="Tap a file above, or say the vehicle or the full name" />}>
      <ExampleTag />
      <VoiceAnswerCard question={question} answer={answer} tone="info" />
      <View>
        {options.map((f, i) => {
          const showAmount = f.phase !== 'disbursed';
          return (
            <PressableScale key={f.lan} onPress={() => onChoose(f)} accessibilityRole="button"
              accessibilityLabel={`${f.customer}, ${f.vehicle}, ${statusCaption(f)}${showAmount ? `, ${inr(f.amount)}` : ''}`}
              style={{ flexDirection: 'row', gap: space.sm, paddingVertical: space.sm, minHeight: touch.min, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <IconWell name={f.product} bg={inFlightWell} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: space.xs }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{f.customer}</Text>
                  {showAmount ? <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>{inr(f.amount)}</Text> : null}
                </View>
                <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{`${f.vehicle.replace(/\s*\(.*\)$/, '')} · ${f.phase === 'disbursed' ? f.lan : SEGMENT_LABEL[f.segment]}`}</Text>
                <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{statusCaption(f)}</Text>
              </View>
            </PressableScale>
          );
        })}
      </View>
      <Text variant="caption" color={colors.textSecondary}>Say the vehicle, or the full name, to choose.</Text>
    </Sheet>
  );
}
