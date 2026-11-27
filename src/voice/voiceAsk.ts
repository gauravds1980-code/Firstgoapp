/**
 * v1.4.5 generic SPOKEN confirm ("Pay ₹80,000 now? Say yes to pay.") — reusable for any final submit.
 *
 * A screen asks one yes / no question with askVoiceConfirm(); the voice session (useVoiceCommand) speaks the prompt,
 * shows it, and reads the dealer's NEXT turn first: "yes" / "haan" / "pay" runs `onYes` — the SAME code path as the
 * screen's button — and "no" / "cancel" / "nahi" runs `onNo`. Anything else is a normal command (the question stays
 * until it expires or the screen withdraws it). The on-screen button always keeps working.
 *
 * The same yes / no reading answers an open voice Confirm card (VoicePreviewSheet): "yes" = Confirm, "no" = Cancel.
 *
 * Screens can also make the voice session SAY something (voiceSay: "That OTP didn't work. Say the 6 digits again.").
 * Pure module (no React Native imports): unit-tested in Node.
 */

export type YesNo = 'yes' | 'no';

export interface VoiceQuestion {
  id: number;
  /** Shown and spoken: "Pay ₹80,000 now? Say yes to pay." Never an OTP. */
  prompt: string;
  onYes: () => void;
  onNo?: () => void;
  /** Extra words that also mean yes for this question ("pay", "sign"). */
  yesWords?: readonly string[];
  askedAt: number;
  ttlMs: number;
}

export type VoiceAskEvent = { kind: 'ask'; q: VoiceQuestion } | { kind: 'clear'; id: number } | { kind: 'say'; text: string; cue?: 'confirm' | 'error' | 'acted' };

const DEFAULT_TTL_MS = 2 * 60 * 1000;
let current: VoiceQuestion | null = null;
let nextId = 1;
const listeners = new Set<(e: VoiceAskEvent) => void>();
const emit = (e: VoiceAskEvent) => listeners.forEach((l) => { try { l(e); } catch { /* listener gone */ } });
const now = () => Date.now();

/** Ask a spoken yes / no question. Returns a withdraw function (call it when the sheet closes / unmounts). */
export function askVoiceConfirm(q: { prompt: string; onYes: () => void; onNo?: () => void; yesWords?: readonly string[]; ttlMs?: number }): () => void {
  const asked: VoiceQuestion = { id: nextId++, prompt: q.prompt, onYes: q.onYes, onNo: q.onNo, yesWords: q.yesWords, askedAt: now(), ttlMs: q.ttlMs ?? DEFAULT_TTL_MS };
  current = asked;
  emit({ kind: 'ask', q: asked });
  return () => { if (current?.id === asked.id) { current = null; emit({ kind: 'clear', id: asked.id }); } };
}

/** The open question, if it has not expired. */
export function pendingQuestion(at: number = now()): VoiceQuestion | null {
  if (current && at - current.askedAt > current.ttlMs) current = null;
  return current;
}

/** Make the voice session say a line (masked, never an OTP). */
export function voiceSay(text: string, cue: 'confirm' | 'error' | 'acted' = 'confirm'): void { emit({ kind: 'say', text, cue }); }

export function subscribeVoiceAsk(l: (e: VoiceAskEvent) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const YES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ya', 'yah', 'haan', 'haa', 'han', 'ha', 'haanji', 'ji', 'jee', 'ok', 'okay', 'okk', 'sure', 'confirm', 'confirmed',
  'correct', 'right', 'done', 'go', 'ahead', 'proceed', 'theek', 'thik', 'thick', 'sahi', 'bilkul', 'chalo', 'karo', 'kar', 'do', 'de', 'dijiye',
  'हाँ', 'हां', 'हा', 'जी', 'ठीक', 'है', 'सही', 'बिल्कुल', 'करो', 'कर', 'दो', 'ओके',
].map((w) => w.normalize('NFC')));
const NO = new Set([
  'no', 'nope', 'nah', 'nahi', 'nahin', 'nai', 'na', 'cancel', 'stop', 'wait', 'mat', 'dont', "don't", 'not', 'never', 'abort', 'ruko', 'rukiye', 'back',
  'नहीं', 'नही', 'ना', 'मत', 'रुको', 'रुकिए', 'कैंसल',
].map((w) => w.normalize('NFC')));
const FILLER = new Set(['hai', 'please', 'now', 'it', 'the', 'that', 'this', 'sir', 'madam', 'bhai', 'ji', 'is', 'then', 'go', 'and', 'abhi', 'ab', 'please.', 'अभी']);

/**
 * "yes" / "haan ji" / "yes pay" / "ok do it" → 'yes'; "no" / "cancel" / "nahi" / "don't pay" → 'no'; anything else
 * (a command, a sentence, numbers) → null. Short utterances only (≤ 5 words); a no word always wins.
 */
export function parseYesNo(text: string, yesWords: readonly string[] = []): YesNo | null {
  const toks = (text ?? '').normalize('NFC').toLowerCase().replace(/[.,!?।]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 5) return null;
  const extra = new Set(yesWords.map((w) => w.toLowerCase()));
  let yes = false;
  let no = false;
  for (const t of toks) {
    if (NO.has(t)) { no = true; continue; }
    if (YES.has(t) || extra.has(t)) { yes = true; continue; }
    if (FILLER.has(t)) continue;
    return null; // another word: a real command, not an answer
  }
  if (no) return 'no';
  // "do" / "kar" / "karo" alone are verbs, not an answer.
  if (yes && toks.every((t) => ['do', 'de', 'kar', 'karo', 'करो', 'कर', 'दो', 'है', 'go'].includes(t) || FILLER.has(t))) return null;
  return yes ? 'yes' : null;
}

/**
 * Answer the open question with what the dealer said. Returns the answer when it was consumed, else null.
 * `alsoYes` (v1.4.5 S2.2): the caller's own yes reading, e.g. an advance phrase ("aage chaliye") = yes to the open
 * question, like the server's voice-confirm.
 */
export function answerPending(text: string, at: number = now(), alsoYes?: (text: string) => boolean): YesNo | null {
  const q = pendingQuestion(at);
  if (!q) return null;
  const a = parseYesNo(text, q.yesWords) ?? (alsoYes?.(text) ? 'yes' : null);
  if (!a) return null;
  current = null;
  emit({ kind: 'clear', id: q.id });
  if (a === 'yes') q.onYes(); else q.onNo?.();
  return a;
}
