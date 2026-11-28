import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { BackHandler, View } from 'react-native';
import { ClarifySheet, FileStatusSheet, VoiceAnswerCard } from '../components/library';
import { gutter } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { navRef } from '../navigation/navRef';
import { speakStatusAnswer } from './piper';
import { answerForChoice, CLARIFY_HINT, getStatusVoiceContext, statusUi } from './statusVoice';
import { replyModeFor } from './voiceCues';
import { getVoiceSettings } from './voiceSettings';
import { clearVoiceStep, setVoiceStep } from './voiceStep';
import type { StatusFile } from '../services/loanStatus';

/** How long a stay-put VoiceAnswerCard stays up (the spoken answer is longer than a toast). */
const CARD_MS = 10000;

/**
 * v1.4.9 feature 5: the on-screen half of a voice status answer, drawn by VoiceHost over whatever screen is open (and
 * under the voice mic, so the dealer can answer the ClarifySheet by voice):
 *  - VoiceAnswerCard under the header (counts stay on the current screen — Gaurav #2; gated / unknown lines);
 *  - ClarifySheet ("Which one?"); "proceed" is registered as a disabled step → "Pehle file choose karo.";
 *  - FileStatusSheet; "proceed" presses Remind customer (or closes a sheet with nothing to press).
 */
export function StatusVoiceLayer({ route, top, toastUp }: { route?: string; top: number; toastUp: boolean }) {
  const s = useSyncExternalStore(statusUi.subscribe, statusUi.get, statusUi.get);
  const [reminded, setReminded] = useState<Record<string, true>>({});

  // A route change closes the answer (but not the card shown with the navigation that caused it).
  useEffect(() => {
    const cur = statusUi.get();
    if (route === 'DealerLogin') { statusUi.clear(); setReminded({}); return; }
    if (cur && Date.now() - cur.id > 1500) statusUi.clear(cur.id);
  }, [route]);
  useEffect(() => {
    if (s?.kind !== 'card') return undefined;
    const t = setTimeout(() => statusUi.clear(s.id), CARD_MS);
    return () => clearTimeout(t);
  }, [s]);
  useEffect(() => {
    if (!s || s.kind === 'card') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { statusUi.clear(); return true; });
    return () => sub.remove();
  }, [s]);

  const file = s?.kind === 'file' ? s.file : null;
  const remind = (f: StatusFile) => { if (reminded[f.lan]) return; haptic.success(); setReminded((r) => ({ ...r, [f.lan]: true })); };
  // ADVANCE on the sheets (voiceStep): never guess on Clarify; Remind customer (or close) on the file sheet.
  useEffect(() => {
    if (!route || !s || s.kind === 'card') return undefined;
    const token = s.kind === 'clarify'
      ? setVoiceStep({ route, sheet: 'status-clarify', cta: { id: 'choose-file', label: 'Choose a file', destructive: false, enabled: false, hint: CLARIFY_HINT, press: () => {} } })
      : file && file.remind
        ? setVoiceStep({ route, sheet: 'file-status', cta: { id: 'remind-customer', label: 'Remind customer', destructive: false, enabled: !reminded[file.lan], hint: 'Reminder already sent.', press: () => remind(file) } })
        : setVoiceStep({ route, sheet: 'file-status', cta: { id: 'close-status', label: 'Close', destructive: false, press: () => statusUi.clear() } });
    return () => clearVoiceStep(token);
  }, [route, s, reminded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  if (s.kind === 'card') {
    return (
      <View pointerEvents="box-none" style={{ position: 'absolute', top: top + (toastUp ? 64 : 0), left: gutter.screen, right: gutter.screen, zIndex: 84 }}>
        <VoiceAnswerCard question={s.question} answer={s.say} tone={s.tone} onClose={() => statusUi.clear(s.id)} />
      </View>
    );
  }
  if (s.kind === 'clarify') {
    const choose = (f: StatusFile) => {
      const a = answerForChoice(f, getStatusVoiceContext(), s.money);
      statusUi.show({ kind: 'file', question: s.question, say: a.say, tone: a.tone, file: f });
      haptic.select();
      if (replyModeFor('status', getVoiceSettings().spokenReplies) === 'speech') void speakStatusAnswer(a.say);
    };
    return <ClarifySheet visible name={s.name} question={s.question} answer={s.say} options={s.options} onChoose={choose} onClose={() => statusUi.clear(s.id)} />;
  }
  const f = s.file;
  return (
    <FileStatusSheet visible file={f} question={s.question} answer={s.say} tone={s.tone} reminded={!!reminded[f.lan]}
      onRemind={() => remind(f)}
      onOpenMif={f.inMif ? () => { statusUi.clear(s.id); if (navRef.isReady()) navRef.navigate('MoneyInFlight', { lan: f.lan, at: Date.now() }); } : undefined}
      onClose={() => statusUi.clear(s.id)} />
  );
}
