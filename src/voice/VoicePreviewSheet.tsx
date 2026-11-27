import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, touch } from '../theme/tokens';
import { Button, Field, Icon, Pill, Text } from '../components/ui';
import { KeyboardRevealProvider, useKeyboardForm } from '../components/keyboard';
import { hasSlots, ROUTE_LABEL, slotDetailRows, VOICE_EXAMPLES, type ApplyOutcome } from './applyCommand';
import type { CommandResponse, IntentCandidate, NormalizedField, VoiceExpect, VoiceSlots } from './types';
import { candidateLabel, displayFields, FIELD_TYPE_FOR_EXPECT, fillLabel, hideFieldForSelect, isDestructiveCommand, isOtpCommand, safeTranscript, typedField } from './voiceLogic';

const ASSISTANT_LABEL: Record<string, string> = {
  help: 'Read out help for this screen',
  list_commands: 'Read out what you can say',
  explain_screen: 'Explain this screen',
  repeat: 'Repeat my last answer',
  open: 'Stay here with Zippy',
};

const FIELD_LABEL: Record<string, string> = { VEHICLE_REG: 'RC number', PHONE: 'Mobile', AMOUNT: 'Amount', OTP: 'OTP', DIGITS: 'Number' };
const fieldLabel = (t: string) => FIELD_LABEL[t] ?? 'Number';
const MAX_LEN: Record<string, number> = { PHONE: 10, OTP: 6, AMOUNT: 9 };

function confirmLabel(plan: ApplyOutcome, command?: CommandResponse): string {
  // v1.4.5: the repay sheet / Enhance sheet / loan slider / a customer row, in their own words.
  if (command?.intent === 'TA_REPAY' && plan.kind === 'navigated') return 'Confirm';
  if (command?.intent === 'ENHANCE_TA_LIMIT' && plan.kind === 'navigated') return 'Open the enhance form';
  if (plan.kind === 'selected' && plan.optionKind === 'amount') return `Set ${plan.label}`;
  if (plan.kind === 'selected' && plan.optionKind === 'customer') return `Open ${plan.label}`;
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
 * v1.4.0 draft transcript: low confidence (or Whisper disagreeing with the phone) reads "Did you mean:
 * <command>?" with a one-tap pick (the tap is the confirm, except for destructive commands, which stage the
 * normal Confirm), up to two alternatives and "Say again". The heard text is editable: fix it and Zippy
 * matches it again.
 *
 * OTP: rows come from `displayFields` (the server's masked copy, re-masked here) so digits are never
 * shown; typing an OTP uses a secure input. Drawn as an absolute overlay by VoiceHost (inside
 * VoiceHost's own transparent Modal while Zippy's help sheet is open).
 */
export function VoicePreviewSheet({ command, plan, expect, onConfirm, onCancel, onChoose, onEditField, onSayAgain, onEditTranscript, embedded = false }: {
  command: CommandResponse | null; plan: ApplyOutcome | null; expect?: VoiceExpect;
  /**
   * v1.4.2: drawn as a card inside the live transcript sheet (no scrim, no own sheet, no own scroller) so the
   * dealer sees one surface. Same content, same Confirm / "Did you mean" / Cancel behaviour.
   */
  embedded?: boolean;
  onConfirm: () => void; onCancel: () => void;
  onChoose?: (c: IntentCandidate) => void;
  onEditField?: (index: number, type: NormalizedField['type'], text: string) => void;
  /** v1.4.0 */
  onSayAgain?: () => void;
  onEditTranscript?: (text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  // v1.3.1: the typed-field editor and Confirm / Cancel lift above the keyboard (may sit inside a Modal).
  const { height: winH } = useWindowDimensions();
  const kb = useKeyboardForm({ assumeHeight: winH });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [typed, setTyped] = useState('');
  const [typedErr, setTypedErr] = useState<string | undefined>();
  // A new utterance closes any open editor.
  const transcript = command?.transcript;
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState('');
  useEffect(() => { setEdit(null); setTyped(''); setTypedErr(undefined); setFixing(false); setFixed(''); }, [transcript]);

  if (!command || !plan) return null;
  const status = command.status ?? 'ok';
  // Clarify: "Did you mean <top>?" + up to two alternatives. Retry: the same picks, offered under "Say again".
  const candidates = status === 'clarify' || status === 'retry' ? (command.candidates ?? []).filter((c) => c.intent !== 'UNKNOWN').slice(0, 3) : [];
  const clarify = status === 'clarify' && candidates.length >= 1;
  const top = candidates[0];
  const canFix = !!onEditTranscript && !isOtpCommand(command) && !!command.transcript.trim() && command.transcript !== '[otp utterance]';
  const fields = displayFields(command);
  // A select never shows an Amount row (a model number like 125 / 350 is not money).
  const shownFields = fields.map((f) => !hideFieldForSelect(command, f));
  const anyShown = shownFields.some(Boolean);
  const actionable = plan.kind === 'navigated' || plan.kind === 'assistant' || plan.kind === 'filled' || plan.kind === 'selected';
  const pct = Math.round(Math.max(0, Math.min(1, command.score)) * 100);
  const slotRows = plan.kind !== 'selected' && hasSlots(command.slots) ? slotDetailRows(command.slots) : [];
  const slots = slotRows.length ? command.slots : undefined;
  const serverText = command.responseText?.trim() || command.readBack?.trim() || '';
  const filter = command.action.type === 'navigate' ? command.action.filter : undefined;
  const firstInvalid = fields.findIndex((f) => !f.valid);
  const expectType = expect ? FIELD_TYPE_FOR_EXPECT[expect] : undefined;
  const offerType = firstInvalid >= 0 ? fields[firstInvalid].type : expectType ?? fields[0]?.type;
  const showTypeCta = status === 'reprompt' && !edit && !!offerType && (!!command.offerKeyboard || (command.repromptCount ?? 0) >= 2);

  const title = clarify && top ? `Did you mean: “${candidateLabel(top)}”?`
    : status === 'retry' ? 'Sorry, say that again.'
    : status === 'reprompt' ? 'Say that number again.'
    : 'Did you say…';
  const what = plan.kind === 'navigated' ? `Go to ${ROUTE_LABEL[plan.route] ?? plan.route}${filter ? ` (${filter.replace(/_/g, ' ')})` : ''}`
    : plan.kind === 'assistant' ? ASSISTANT_LABEL[plan.action] ?? 'Zippy help'
    : plan.kind === 'selected' ? `Select ${plan.label}`
    : plan.kind === 'filled' ? `Fill the ${fieldLabel(plan.fields[0]?.type ?? '').toLowerCase()} on this screen (payments and final submits still ask you first)`
    : plan.kind === 'blocked' ? plan.reason
    : clarify ? 'Tap the right one. Destructive steps (sign, pay, mandate, upload) still ask you to confirm.'
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

  const bodyContent = (
    <>
          {!embedded && !!command.transcript.trim() && !fixing && (
            <View style={{ alignSelf: 'flex-end', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <View style={{ flexShrink: 1, backgroundColor: colors.aiUser, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: 4 }}>
                <Text variant="body" color={colors.onPrimary}>“{safeTranscript(command)}”</Text>
              </View>
              {canFix && (
                <Pressable onPress={() => { setFixing(true); setFixed(command.transcript); }} accessibilityRole="button" accessibilityLabel="Correct what Zippy heard" hitSlop={8}
                  style={{ minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="pencil-outline" size={20} color={colors.primary} />
                </Pressable>
              )}
            </View>
          )}
          {fixing && (
            <View style={{ gap: space.xs }}>
              <Field label="What you said" value={fixed} onChangeText={setFixed} autoFocus autoCapitalize="none" autoCorrect={false}
                returnKeyType="go" onSubmitEditing={() => fixed.trim() && onEditTranscript?.(fixed)} hint="Fix the words and Zippy will match them again." />
              <Button label="Use this" variant="secondary" icon="check" disabled={!fixed.trim()} onPress={() => onEditTranscript?.(fixed)} />
            </View>
          )}
          {!(embedded && clarify) && <View style={{ padding: space.sm, borderRadius: radius.lg, backgroundColor: actionable ? colors.aiThread : colors.surfaceMuted, gap: space.xxs }}>
            {!embedded && <Text variant="overline" color={colors.textSecondary}>WHAT I’LL DO</Text>}
            <Text variant={embedded ? 'body' : 'bodyStrong'}>{what}</Text>
            {status === 'ok' && command.intent !== 'UNKNOWN' && (
              <>
                <Row label="Intent" value={command.intent} />
                <Row label="Match" value={`${pct}%${command.matchedPhrase ? ` · “${command.matchedPhrase}”` : ''}`} />
              </>
            )}
            {plan.kind === 'selected' && (
              <Text variant="caption" color={colors.textSecondary}>Selects this option on the current screen. Payments and final submits still ask you first.</Text>
            )}
            {status === 'retry' && !serverText && VOICE_EXAMPLES.map((ex) => (
              <Text key={ex} variant="body" color={colors.textSecondary}>• “{ex}”</Text>
            ))}
          </View>}
          {candidates.length > 0 && (
            <View style={{ gap: space.xs }}>
              {status === 'retry' && <Text variant="caption" color={colors.textSecondary}>Or did you mean:</Text>}
              {candidates.map((c, i) => (
                <Button key={`${c.intent}-${i}`} label={clarify && i === 0 ? `Yes, ${candidateLabel(c).replace(/^./, (ch) => ch.toLowerCase())}` : candidateLabel(c)}
                  variant={clarify && i === 0 ? 'brand' : 'secondary'} onPress={() => onChoose?.(c)}
                  icon={isDestructiveCommand({ ...command, intent: c.intent, action: { type: 'none' } }) ? 'shield-check-outline' : undefined} />
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
              {slotRows.map((r) => <Row key={r.key} label={r.label} value={r.value} />)}
              <Text variant="caption" color={colors.textSecondary}>Saved as a draft on Confirm — check them on the next screen.</Text>
            </View>
          )}
    </>
  );
  const titleRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Icon name={status === 'retry' || status === 'reprompt' ? 'microphone-question' : 'microphone'} size={20} color={colors.primary} />
      <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">{title}</Text>
    </View>
  );
  const body = (
    <KeyboardRevealProvider value={kb.api}>
      {bodyContent}
    </KeyboardRevealProvider>
  );
  const buttons = (
    <View style={{ gap: space.xs }}>
      {actionable && <Button label={confirmLabel(plan, command)} onPress={onConfirm} icon="check" />}
      {actionable && <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Or hold the mic and say “yes”.</Text>}
      {!actionable && onSayAgain && <Button label="Say again" variant="secondary" icon="microphone" onPress={onSayAgain} />}
      <Button label={embedded ? 'Not this' : 'Cancel'} variant={actionable || onSayAgain ? 'ghost' : 'secondary'} onPress={onCancel} />
    </View>
  );
  if (embedded) {
    return (
      <View testID="voice-preview-embedded" style={{ padding: space.md, gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        {titleRow}
        <View style={{ gap: space.sm }}>{body}</View>
        {buttons}
      </View>
    );
  }

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', paddingBottom: kb.lift, paddingTop: insets.top }} accessibilityViewIsModal>
      <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim }} onPress={onCancel} accessibilityLabel="Cancel voice command" />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, gap: space.md, maxHeight: '85%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        {titleRow}
        <ScrollView ref={kb.scrollRef} onScroll={kb.onScroll} scrollEventThrottle={32} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
        {buttons}
      </View>
    </View>
  );
}
