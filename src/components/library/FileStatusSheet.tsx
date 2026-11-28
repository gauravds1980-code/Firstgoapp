import React from 'react';
import { View } from 'react-native';
import { Sheet } from '../Sheet';
import { Button, ReadOnlyRow, Text } from '../ui';
import { ExampleTag } from '../business';
import { Timeline } from './Timeline';
import { VoiceAnswerCard } from './VoiceAnswerCard';
import type { AnswerToneName } from '../../theme/library';
import { colors, space } from '../../theme/tokens';
import { inr, maskMobile } from '../../utils/finance';
import { SEGMENT_LABEL, stepTime, type StatusFile } from '../../services/loanStatus';

/**
 * Design library (feature 5, v1.4.9): one file's status after a voice question — VoiceAnswerCard at the top, amount /
 * stage / masked mobile / loan number, and the journey Timeline (KYC → Offer → Sanctioned → e-Sign → Mandate →
 * Credited; Money-in-flight stages for tracked files). Primary "Remind customer" when the customer has the next step
 * ("proceed" presses it); "Open in Money in flight" for a tracked file. `inline`: drawn under the voice mic.
 */
export function FileStatusSheet({ visible, file, question, answer, tone, reminded, onRemind, onOpenMif, onClose }: {
  visible: boolean; file: StatusFile; question?: string; answer: string; tone: AnswerToneName; reminded: boolean;
  onRemind: () => void; onOpenMif?: () => void; onClose: () => void;
}) {
  const items = file.steps.map((s) => ({
    key: s.key, title: s.title, state: s.state, ...(s.at ? { time: stepTime(s.at) } : {}),
    ...(s.detail ? { detail: s.detail, detailTone: s.state === 'current' ? colors.warning : undefined } : {}),
  }));
  const footer = (
    <>
      {file.remind ? <Button label={reminded ? 'Reminder sent' : 'Remind customer'} success={reminded} disabled={reminded} onPress={onRemind} /> : null}
      {onOpenMif ? <Button label="Open in Money in flight" variant="secondary" onPress={onOpenMif} /> : null}
    </>
  );
  return (
    <Sheet inline visible={visible} onClose={onClose} title={file.customer} subtitle={`${SEGMENT_LABEL[file.segment]} · ${file.vehicle.replace(/\s*\(.*\)$/, '')}`}
      footer={file.remind || onOpenMif ? footer : undefined}>
      <ExampleTag />
      <VoiceAnswerCard question={question} answer={answer} tone={tone} />
      <View>
        <ReadOnlyRow label={file.phase === 'applied' ? 'Loan amount' : 'Sanctioned amount'} value={inr(file.amount)} strong />
        {file.credited ? <ReadOnlyRow label="Credited" value={inr(file.credited)} /> : null}
        <ReadOnlyRow label="Stage" value={file.stage} />
        <ReadOnlyRow label="Mobile" value={maskMobile(file.mobile)} />
        <ReadOnlyRow label="Loan number" value={file.lan} />
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="label" color={colors.textSecondary}>Journey</Text>
        <Timeline items={items} />
      </View>
      <Text variant="caption" color={colors.textSecondary}>Updated just now</Text>
    </Sheet>
  );
}
