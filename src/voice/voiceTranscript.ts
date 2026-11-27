/**
 * v1.4.2: the live transcript (double-tap the mic). Pure TS, no React Native (unit-tested in Node).
 *
 * IN MEMORY ONLY. Turns live in this module for the app session and are never written to AsyncStorage,
 * secure storage, disk, metrics or logs; there is no serializer. They are cleared on sign-out (VoiceHost)
 * and capped at MAX_ENTRIES.
 *
 * OTP SAFETY: every dealer line and Zippy row goes through `maskSpoken`. A line that mentions an OTP / PIN
 * (or was already masked by the voice hook on the OTP screen) has every digit — and every run of spoken
 * number words — replaced with dots and carries `hidden: true`, so the UI shows a "Hidden" chip.
 *
 * VoiceHost feeds it from the same live state the pill uses (useVoiceCommand's `live`): on-device partials,
 * the final text, Whisper / server corrections (source flips to 'server') and, when streaming lands
 * (earlyWhisper.ts / DA-30), whatever that path publishes into `live` — no extra wiring needed here.
 */
import { maskOtp } from './voiceLogic';

export type TranscriptSource = 'phone' | 'server' | 'typed';
export type DealerLine = { id: number; role: 'dealer'; turn: number; text: string; final: boolean; source: TranscriptSource; hidden: boolean };
export type ZippyRow = { id: number; role: 'zippy'; kind: 'reply' | 'action' | 'error'; text: string; hidden: boolean };
export type TranscriptEntry = DealerLine | ZippyRow;

export const MAX_ENTRIES = 40;

const OTP_WORD = /\b(otp|o\s?t\s?p|one[\s-]?time[\s-]?(?:password|code|pin)|pin|passcode|verification code)\b|ओटीपी|ओ टी पी/i;
const NUM_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|char|chaar|paanch|panch|chhe|cheh|saat|aath|nau|shunya)';
const NUM_WORD_RUN = new RegExp(`\\b${NUM_WORD}(?:[\\s,-]+${NUM_WORD}){2,}\\b`, 'gi');

/** Mask OTP digits in anything shown in the transcript. `hidden` = something was (or already is) masked. */
export function maskSpoken(text: string): { text: string; hidden: boolean } {
  const already = text.includes('•');
  if (!OTP_WORD.test(text) && !already) return { text, hidden: false };
  let out = text.replace(/\d[\d\s-]*\d|\d/g, (m) => maskOtp(m.replace(/\D/g, '').length));
  out = out.replace(NUM_WORD_RUN, (m) => maskOtp(m.trim().split(/[\s,-]+/).length));
  return { text: out, hidden: true };
}

/** The voice hook's live state (VoiceLive) as the transcript sees it. */
export type LiveInput = { text: string; final: boolean; source?: 'device' | 'server' | 'typed'; turn?: number } | null;

const toSource = (s?: 'device' | 'server' | 'typed'): TranscriptSource =>
  s === 'server' ? 'server' : s === 'typed' ? 'typed' : 'phone';

let entries: TranscriptEntry[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const set = (next: TranscriptEntry[]) => {
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  subs.forEach((l) => l());
};

export const voiceTranscript = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  entries: (): readonly TranscriptEntry[] => entries,

  /** Live words for a turn: interim (grey + caret) until `final`; a later server text corrects the line. */
  live(live: LiveInput) {
    if (!live || live.turn == null) return;
    const raw = live.text.trim().replace(/^“|”$/g, '');
    if (!raw) return;
    const { text, hidden } = maskSpoken(raw);
    const source = toSource(live.source);
    const i = entries.findIndex((e) => e.role === 'dealer' && e.turn === live.turn);
    if (i < 0) {
      set([...entries, { id: nextId++, role: 'dealer', turn: live.turn, text, final: live.final, source, hidden }]);
      return;
    }
    const cur = entries[i] as DealerLine;
    // A final line only goes back to interim for a brand-new partial of the same turn (never happens today).
    const final = cur.final || live.final;
    if (cur.text === text && cur.final === final && cur.source === source && cur.hidden === hidden) return;
    const next = entries.slice();
    next[i] = { ...cur, text, final, source, hidden: cur.hidden || hidden };
    set(next);
  },

  /** A Zippy reply (read-out / hint), an action that ran, or an error. */
  zippy(kind: ZippyRow['kind'], text: string) {
    const t = text.trim();
    if (!t) return;
    const last = entries[entries.length - 1];
    const m = maskSpoken(t);
    if (last && last.role === 'zippy' && last.kind === kind && last.text === m.text) return;
    set([...entries, { id: nextId++, role: 'zippy', kind, text: m.text, hidden: m.hidden }]);
  },

  /** A turn cancelled by the double-tap leaves no line behind. */
  dropTurn(turn: number | null | undefined) {
    if (turn == null) return;
    const next = entries.filter((e) => !(e.role === 'dealer' && e.turn === turn));
    if (next.length !== entries.length) set(next);
  },

  /** Sign-out / tests. */
  clear() { if (entries.length) set([]); },
};
