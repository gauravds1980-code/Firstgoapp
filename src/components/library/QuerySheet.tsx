import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Sheet } from '../Sheet';
import { Chip } from '../business';
import { Banner, Button, Field, Text } from '../ui';
import { useVoiceStep } from '../../voice/useAutoAdvance';
import { colors, space } from '../../theme/tokens';
import { haptic } from '../../utils/haptics';
import { QUERY_QUEUES, type QueryQueueId } from '../../services/queries';

export interface QueryReason { id: string; label: string }
export const QUERY_NOTE_MAX = 200;

/**
 * Design library: raise a query (feature 1 Money in flight → RM desk, QRY-…; v1.4.8 payout statement → payout-ops
 * queue, PAY-…). `queue` sets who receives it in the copy; `reasons` are the caller's. Reason chips (one required), optional
 * note (200 characters), then an explicit Confirm step before anything is sent (v1.4.6 rule: the query submit needs
 * Confirm). Voice: "proceed" / "aage chaliye" asks "Send this query to your RM?" and a spoken yes sends it (the
 * buttons stay). `openTicket` = a query is already open for this subject: it is shown and a second one is refused.
 */
export function QuerySheet({ visible, onClose, subject, reasons, preselect, onSubmit, openTicket, voiceRoute, queue = 'rm' }: {
  visible: boolean; onClose: () => void; subject: string; reasons: readonly QueryReason[]; preselect?: string;
  onSubmit: (reason: QueryReason, note: string) => Promise<{ ticketId: string }>; openTicket?: string; voiceRoute?: string; queue?: QueryQueueId;
}) {
  const q = QUERY_QUEUES[queue];
  const voiceKey = queue === 'rm' ? 'mif-query' : 'payout-query';
  const [reason, setReason] = useState<string | undefined>(preselect);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setReason(preselect); setNote(''); setStep('form'); setBusy(false); } }, [visible, preselect]);
  const picked = reasons.find((r) => r.id === reason);
  const send = async () => {
    if (!picked || busy || openTicket) return;
    setBusy(true);
    try { await onSubmit(picked, note.trim()); haptic.success(); } finally { setBusy(false); }
  };
  const sendRef = React.useRef(send);
  sendRef.current = send;
  useVoiceStep(visible && voiceRoute ? {
    route: voiceRoute, sheet: voiceKey, step: step,
    cta: { id: `${voiceKey}-send`, label: 'Send query', destructive: true, enabled: !!picked && !openTicket, hint: openTicket ? `Query ${openTicket} is already open.` : 'Choose a reason first.', confirmPrompt: `Send this query to ${q.to}?`, press: () => { void sendRef.current(); } },
  } : null);
  const footer = openTicket ? <Button label="Close" variant="secondary" onPress={onClose} />
    : step === 'form'
      ? <Button label="Submit query" icon="send" disabled={!picked} onPress={() => { haptic.select(); setStep('confirm'); }} />
      : (
        <>
          <Button label="Confirm and send" icon="check" loading={busy} onPress={send} />
          <Button label="Edit query" variant="ghost" onPress={() => setStep('form')} />
        </>
      );
  return (
    <Sheet visible={visible} onClose={onClose} title="Raise a query" subtitle={subject} footer={footer}>
      {openTicket ? (
        <Banner tone="info" title={`Query ${openTicket} is already open.`} body={`${queue === 'rm' ? 'Your RM' : 'Payout operations'} will reply in the app. You can raise another one after this is closed.`} />
      ) : step === 'form' ? (
        <>
          <Text variant="label">What's this about?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {reasons.map((r) => <Chip key={r.id} label={r.label} on={reason === r.id} onPress={() => { haptic.select(); setReason(r.id); }} />)}
          </View>
          <Field label="Note (optional)" value={note} onChangeText={(t) => setNote(t.slice(0, QUERY_NOTE_MAX))} placeholder={queue === 'rm' ? 'Anything the RM should know' : 'Anything payout operations should know'} multiline maxLength={QUERY_NOTE_MAX}
            hint={`${note.length}/${QUERY_NOTE_MAX}`} />
          <Text variant="caption" color={colors.textSecondary}>{q.promise}</Text>
        </>
      ) : (
        <>
          <Banner tone="warning" icon="send-check-outline" title={`Send this query to ${q.to}?`} body={`${picked?.label ?? ''}${note.trim() ? ` · “${note.trim()}”` : ''}`} />
          <Text variant="caption" color={colors.textSecondary}>Check the reason, then confirm. You'll get a ticket number once it is sent.</Text>
        </>
      )}
    </Sheet>
  );
}
