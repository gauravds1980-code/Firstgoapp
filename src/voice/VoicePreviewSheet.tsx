import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, touch } from '../theme/tokens';
import { Button, Field, Icon, Pill, Text } from '../components/ui';
import { formatSlot, hasSlots, ROUTE_LABEL, SLOT_LABELS, VOICE_EXAMPLES, type ApplyOutcome } from './applyCommand';
import type { CommandResponse, IntentCandidate, NormalizedField, VoiceExpect, VoiceSlots } from './types';
import { candidateLabel, displayFields, FIELD_TYPE_FOR_EXPECT, fillLabel, hideFieldForSelect, safeTranscript, typedField } from './voiceLogic';

const ASSISTANT_LABEL: Record<string, string> = {
  help: 'Read out help for this screen',
  list_commands: 'Read out what you can say',
  explain_screen: 'Explain this screen',
  repeat: 'Repeat my last answer',
  open: 'Stay here with Zippy',
};

const FIELD_LABEL: Record<string, string> = { PHONE: 'Mobile', AMOUNT: 'Amount', OTP: 'OTP', DIGITS: 'Number' };
const fieldLabel = (t: string) => FIELD_LABEL[t] ?? 'Number';
const MAX_LEN: Record<string, number> = { PHONE: 10, OTP: 6, AMOUNT: 9 };

function confirmLabel(plan: ApplyOutcome): string {
  if (plan.kind === 'navigated') return `Open ${ROUTE_LABEL[plan.route] ?? plan.route}`;
  if (plan.kind === 'assistant') return plan.action === 'open' ? 'OK' : 'Read it out';
  if (plan.kind === 'filled') return fillLabel(plan.fields);
  if (plan.kind === 'selected') return `Select ${plan.label}`;
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

type Edit = { index: number; type: NormalizedField['type'] };

/**
 * Staged preview of a voice command. NOTHING happens until Confirm: shows the transcript, matched
 * intent + score, any detected slots and spoken numbers. UNKNOWN / blocked / retry / reprompt commands
 * get no Confirm (Cancel only) until the dealer picks a candidate or types the value.
 *
 * OTP: rows come from `displayFields` (the server's masked copy, re-masked here) so digits are never
 * shown; typing an OTP uses a secure input. Drawn as an absolute overlay by VoiceHost (inside
 * VoiceHost's own transparent Modal while Zippy's help sheet is open).
 */
export function VoicePreviewSheet({ command, plan, expect, onConfirm, onCancel, onChoose, onEditField }: {
  command: CommandResponse | null; plan: ApplyOutcome | null; expect?: VoiceExpect;
  onConfirm: () => void; onCancel: () => void;
  onChoose?: (c: IntentCandidate) => void;
  onEditField?: (index: number, type: NormalizedField['type'], text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [typed, setTyped] = useState('');
  const [typedErr, setTypedErr] = useState<string | undefined>();
  // A new utterance closes any open editor.
  const transcript = command?.transcript;
  useEffect(() => { setEdit(null); setTyped(''); setTypedErr(undefined); }, [transcript]);

  if (!command || !plan) return null;
  const status = command.status ?? 'ok';
  const candidates = status === 'clarify' ? (command.candidates ?? []).slice(0, 2) : [];
  const clarify = candidates.length >= 2;
  const fields = displayFields(command);
  // A select never shows an Amount row (a model number like 125 / 350 is not money).
  const shownFields = fields.map((f) => !hideFieldForSelect(command, f));
  const anyShown = shownFields.some(Boolean);
  const actionable = plan.kind === 'navigated' || plan.kind === 'assistant' || plan.kind === 'filled' || plan.kind === 'selected';
  const pct = Math.round(Math.max(0, Math.min(1, command.score)) * 100);
  const slots = plan.kind !== 'selected' && hasSlots(command.slots) ? command.slots : undefined;
  const serverText = command.responseText?.trim() || command.readBack?.trim() || '';
  const filter = command.action.type === 'navigate' ? command.action.filter : undefined;
  const firstInvalid = fields.findIndex((f) => !f.valid);
  const expectType = expect ? FIELD_TYPE_FOR_EXPECT[expect] : undefined;
  const offerType = firstInvalid >= 0 ? fields[firstInvalid].type : expectType ?? fields[0]?.type;
  const showTypeCta = status === 'reprompt' && !edit && !!offerType && (!!command.offerKeyboard || (command.repromptCount ?? 0) >= 2);

  const title = clarify ? 'Did you mean…?'
    : status === 'retry' ? 'Sorry, say that again.'
    : status === 'reprompt' ? 'Say that number again.'
    : 'Did you say…';
  const what = plan.kind === 'navigated' ? `Go to ${ROUTE_LABEL[plan.route] ?? plan.route}${filter ? ` (${filter.replace(/_/g, ' ')})` : ''}`
    : plan.kind === 'assistant' ? ASSISTANT_LABEL[plan.action] ?? 'Zippy help'
    : plan.kind === 'selected' ? `Select ${plan.label}`
    : plan.kind === 'filled' ? `Fill the ${fieldLabel(plan.fields[0]?.type ?? '').toLowerCase()} on this screen (you still tap Verify / Continue yourself)`
    : plan.kind === 'blocked' ? plan.reason
    : clarify ? 'Pick one, then confirm.'
    : status === 'retry' ? (serverText || 'Hold the mic and try one of these:')
    : status === 'reprompt' ? (fields[firstInvalid]?.error ?? 'I did not catch the whole number.')
    : 'I’m not sure what to do with that. Cancel and hold the mic to try again.';

  const openEditor = (index: number, type: NormalizedField['type']) => { setEdit({ index, type }); setTyped(''); setTypedErr(undefined); };
  const applyTyped = () => {
    if (!edit) return;
    const f = typedField(edit.type, typed);
    if (!f.valid) { setTypedErr(f.error); return; }
    onEditField?.(edit.index, edit.type, typed);
    setEdit(null); setTyped(''); setTypedErr(undefined);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }} accessibilityViewIsModal>
      <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim }} onPress={onCancel} accessibilityLabel="Cancel voice command" />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, gap: space.md, maxHeight: '85%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Icon name={status === 'retry' || status === 'reprompt' ? 'microphone-question' : 'microphone'} size={20} color={colors.primary} />
          <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">{title}</Text>
        </View>
        <ScrollView contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
          {!!command.transcript.trim() && (
            <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: colors.aiUser, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: 4 }}>
              <Text variant="body" color={colors.onPrimary}>“{safeTranscript(command)}”</Text>
            </View>
          )}
          <View style={{ padding: space.sm, borderRadius: radius.lg, backgroundColor: actionable ? colors.aiThread : colors.surfaceMuted, gap: space.xxs }}>
            <Text variant="overline" color={colors.textSecondary}>WHAT I’LL DO</Text>
            <Text variant="bodyStrong">{what}</Text>
            {status === 'ok' && command.intent !== 'UNKNOWN' && (
              <>
                <Row label="Intent" value={command.intent} />
                <Row label="Match" value={`${pct}%${command.matchedPhrase ? ` · “${command.matchedPhrase}”` : ''}`} />
              </>
            )}
            {plan.kind === 'selected' && (
              <Text variant="caption" color={colors.textSecondary}>Selects this option on the current screen. You still tap Continue yourself.</Text>
            )}
            {status === 'retry' && !serverText && VOICE_EXAMPLES.map((ex) => (
              <Text key={ex} variant="body" color={colors.textSecondary}>• “{ex}”</Text>
            ))}
          </View>
          {clarify && (
            <View style={{ gap: space.xs }}>
              {candidates.map((c, i) => (
                <Button key={`${c.intent}-${i}`} label={candidateLabel(c)} variant={i === 0 ? 'brand' : 'secondary'} onPress={() => onChoose?.(c)} />
              ))}
            </View>
          )}
          {anyShown && (
            <View style={{ padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: space.xs }}>
              <Text variant="overline" color={colors.textSecondary}>NUMBERS I HEARD</Text>
              {fields.map((f, i) => !shownFields[i] ? null : (
                <View key={i} style={{ gap: space.xxs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                    <Text variant="caption" color={colors.textSecondary}>{fieldLabel(f.type)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
                      {f.valid
                        ? <Text variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }} accessibilityLabel={f.type === 'OTP' ? 'OTP captured, hidden' : undefined}>{f.display || f.value}</Text>
                        : <Pill label="Say again" tone="danger" />}
                    </View>
                  </View>
                  {!f.valid && f.error ? <Text variant="caption" color={colors.danger}>{f.error}</Text> : null}
                  {!f.valid && edit?.index !== i && (
                    <Pressable onPress={() => openEditor(i, f.type)} accessibilityRole="button" accessibilityLabel={`Type the ${fieldLabel(f.type).toLowerCase()} instead`}
                      style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                      <Icon name="keyboard-outline" size={18} color={colors.primary} />
                      <Text variant="label" color={colors.primary}>Type it instead</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {plan.kind === 'filled' && <Text variant="caption" color={colors.textSecondary}>Fills the field on Confirm. Nothing is submitted for you.</Text>}
            </View>
          )}
          {showTypeCta && offerType && (
            <Button label="Type it instead" variant="secondary" icon="keyboard-outline"
              onPress={() => openEditor(firstInvalid >= 0 ? firstInvalid : -1, offerType)} />
          )}
          {edit && (
            <View style={{ gap: space.xs }}>
              <Field
                label={`Type the ${fieldLabel(edit.type).toLowerCase()}`}
                value={typed}
                onChangeText={(t) => { setTyped(t.replace(/\D/g, '').slice(0, MAX_LEN[edit.type] ?? 12)); setTypedErr(undefined); }}
                keyboardType="number-pad"
                maxLength={MAX_LEN[edit.type] ?? 12}
                autoFocus
                secureTextEntry={edit.type === 'OTP'}
                textContentType={edit.type === 'OTP' ? 'oneTimeCode' : undefined}
                autoComplete="off"
                importantForAutofill="no"
                prefix={edit.type === 'PHONE' ? '+91' : edit.type === 'AMOUNT' ? '₹' : undefined}
                error={typedErr}
                hint={edit.type === 'OTP' ? 'Hidden as you type. Confirm still needed before it fills.' : 'Confirm still needed before it fills.'}
                onSubmitEditing={applyTyped}
              />
              <Button label="Check" variant="secondary" icon="check" onPress={applyTyped} disabled={!typed} />
            </View>
          )}
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
    </KeyboardAvoidingView>
  );
}
