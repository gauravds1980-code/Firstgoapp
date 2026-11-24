import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../theme/tokens';
import { Button, Icon, Text } from '../components/ui';
import { formatSlot, hasSlots, ROUTE_LABEL, SLOT_LABELS, type ApplyOutcome } from './applyCommand';
import type { CommandResponse, VoiceSlots } from './types';

const ASSISTANT_LABEL: Record<string, string> = {
  help: 'Read out help for this screen',
  list_commands: 'Read out what you can say',
  explain_screen: 'Explain this screen',
  repeat: 'Repeat my last answer',
  open: 'Stay here with Zippy',
};

function confirmLabel(plan: ApplyOutcome): string {
  if (plan.kind === 'navigated') return `Open ${ROUTE_LABEL[plan.route] ?? plan.route}`;
  if (plan.kind === 'assistant') return plan.action === 'open' ? 'OK' : 'Read it out';
  return 'Confirm';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.xxs }}>
      <Text variant="caption" color={colors.textSecondary}>{label}</Text>
      <Text variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/**
 * Staged preview of a voice command. NOTHING happens until Confirm: shows the transcript, matched
 * intent + score and any detected slots. UNKNOWN / blocked commands get no Confirm (Cancel only).
 * Drawn as an overlay inside the assistant sheet's Modal (no nested native modals on iOS).
 */
export function VoicePreviewSheet({ command, plan, onConfirm, onCancel }: {
  command: CommandResponse | null; plan: ApplyOutcome | null; onConfirm: () => void; onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!command || !plan) return null;
  const actionable = plan.kind === 'navigated' || plan.kind === 'assistant';
  const pct = Math.round(Math.max(0, Math.min(1, command.score)) * 100);
  const slots = hasSlots(command.slots) ? command.slots : undefined;
  const filter = command.action.type === 'navigate' ? command.action.filter : undefined;
  const what = plan.kind === 'navigated' ? `Go to ${ROUTE_LABEL[plan.route] ?? plan.route}${filter ? ` (${filter.replace(/_/g, ' ')})` : ''}`
    : plan.kind === 'assistant' ? ASSISTANT_LABEL[plan.action] ?? 'Zippy help'
    : plan.kind === 'blocked' ? plan.reason
    : 'I’m not sure what to do with that. Cancel and hold the mic to try again.';
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }} accessibilityViewIsModal>
      <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim }} onPress={onCancel} accessibilityLabel="Cancel voice command" />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, gap: space.md, maxHeight: '80%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Icon name="microphone" size={20} color={colors.primary} />
          <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">Did you say…</Text>
        </View>
        <ScrollView contentContainerStyle={{ gap: space.sm }}>
          <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: colors.aiUser, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: 4 }}>
            <Text variant="body" color={colors.onPrimary}>“{command.transcript}”</Text>
          </View>
          <View style={{ padding: space.sm, borderRadius: radius.lg, backgroundColor: actionable ? colors.aiThread : colors.surfaceMuted, gap: space.xxs }}>
            <Text variant="overline" color={colors.textSecondary}>WHAT I’LL DO</Text>
            <Text variant="bodyStrong">{what}</Text>
            <Row label="Intent" value={command.intent} />
            <Row label="Match" value={`${pct}%${command.matchedPhrase ? ` · “${command.matchedPhrase}”` : ''}`} />
          </View>
          {slots && (
            <View style={{ padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: space.xxs }}>
              <Text variant="overline" color={colors.textSecondary}>DETAILS I HEARD</Text>
              {(Object.keys(SLOT_LABELS) as (keyof VoiceSlots)[]).map((k) => slots[k] === undefined ? null : (
                <Row key={k} label={SLOT_LABELS[k]} value={formatSlot(k, slots[k])} />
              ))}
              <Text variant="caption" color={colors.textSecondary}>Saved as a draft on Confirm — check them on the next screen.</Text>
            </View>
          )}
        </ScrollView>
        <View style={{ gap: space.xs }}>
          {actionable && <Button label={confirmLabel(plan)} onPress={onConfirm} icon="check" />}
          <Button label="Cancel" variant={actionable ? 'ghost' : 'secondary'} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
