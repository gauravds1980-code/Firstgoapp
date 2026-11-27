/**
 * v1.4.5 OTP parsing on the phone (pure TS, unit-tested in Node). Adapted from the fix-esign-otp leftover.
 *
 * On an OTP turn (expect 'otp': Esign, DealerOtp, SearchMobile / DealerLogin stage otp, consent) the phone reads the
 * spoken code itself, so it works offline and the code never needs to leave the phone:
 *   "1 2 3 4 5 6", "123456", "1-2-3-4-5-6", "12 34 56", "123 456", "१२३४५६", zero / oh / o, "double five",
 *   "triple five", "twelve thirty four fifty six", Hinglish "ek do teen char paanch chhe", Devanagari
 *   "एक दो तीन चार पांच छह", डबल / ट्रिपल, fillers ("OTP is", "mera OTP", "है" …).
 * EXACTLY 6 digits in ONE turn. Any other count fills nothing: masked "Say all 6 digits or type them.".
 *
 * REQUIREMENT CHANGE (Gaurav, v1.4.5): the e-sign OTP step is fully hands-off. Exactly 6 digits on Esign → the
 * boxes are filled AND verified at once (no confirm card, no "Did you mean", no tap), with only the masked line
 * "OTP entered, verifying". Other OTP screens fill only (the dealer taps Verify).
 * The digits are a secret: never logged, never shown (••••••), never spoken, never in the offline /log queue.
 */
import type { CommandResponse, NormalizedField } from './types';
import { maskOtp } from './voiceLogic';

/** All three OTP screens verify exactly 6 digits. */
export const OTP_LENGTH = 6;

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, nought: 0, shunya: 0, sunya: 0, shoonya: 0, 'शून्य': 0, 'सुन्य': 0,
  one: 1, ek: 1, 'एक': 1,
  two: 2, do: 2, doo: 2, 'दो': 2,
  three: 3, teen: 3, tin: 3, 'तीन': 3,
  four: 4, char: 4, chaar: 4, 'चार': 4,
  five: 5, paanch: 5, panch: 5, paach: 5, 'पांच': 5, 'पाँच': 5, 'पाच': 5,
  six: 6, chhe: 6, chhah: 6, chah: 6, che: 6, chha: 6, cheh: 6, chhey: 6, 'छह': 6, 'छः': 6, 'छे': 6, 'छ': 6,
  seven: 7, saat: 7, sat: 7, 'सात': 7,
  eight: 8, aath: 8, ath: 8, aat: 8, 'आठ': 8,
  nine: 9, nau: 9, nao: 9, no: 9, 'नौ': 9, 'नो': 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULT: Record<string, number> = { double: 2, dubble: 2, 'डबल': 2, triple: 3, treble: 3, tripple: 3, 'ट्रिपल': 3 };
/** Words that are also ordinary words: digits only when the rest of the utterance is digits too. */
const AMBIGUOUS = new Set(['no', 'o', 'oh', 'do', 'doo', 'sat', 'che', 'tin', 'ath', 'aat', 'दो', 'नो', 'छ', 'छे']);
const FILLERS = new Set([
  'otp', 'the', 'my', 'is', 'its', "it's", 'it', 'code', 'number', 'pin', 'password', 'passcode', 'verification', 'customer',
  "customer's", 'please', 'ok', 'okay', 'so', 'and', 'sir', 'ji', 'hai', 'he', 'h', 'hain', 'ka', 'ki', 'ke', 'mera', 'meri',
  'yeh', 'ye', 'woh', 'wo', 'aur', 'here', 'this', 'esign', 'e-sign', 'sign',
  'है', 'हैं', 'मेरा', 'मेरी', 'ओटीपी', 'कोड', 'नंबर', 'का', 'की', 'के', 'यह', 'ये', 'और', 'जी', 'पिन',
]);
const DEVANAGARI_DIGIT = /[०-९]/g;

export type OtpParse =
  /** Exactly `expected` digits. `digits` is a secret: never log or render it. */
  | { kind: 'ok'; digits: string }
  /** A digit-only utterance with the wrong count (`heard` digits). Not filled. */
  | { kind: 'wrong_length'; heard: number }
  /** Not an OTP utterance (a command, a sentence): the server text path decides. */
  | { kind: 'none' };

/** Lower case, Devanagari numerals → ASCII, "o t p" / "one time password" → otp, punctuation → spaces. */
function tokens(text: string): string[] {
  let t = (text ?? '').toLowerCase().normalize('NFC');
  t = t.replace(DEVANAGARI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0966));
  t = t.replace(/\bone[\s-]*time[\s-]*(?:password|code|pin)\b/g, ' otp ');
  t = t.replace(/\bo\s*\.?\s*t\s*\.?\s*p\b\.?/g, ' otp ');
  t = t.replace(/ओ\s*टी\s*पी/g, ' ओटीपी ');
  // Separators: whitespace, punctuation, hyphens / dashes. Devanagari danda too. Apostrophes kept ("it's").
  return t.split(/[\s,.;:!?"()\[\]{}|/\\\-–—_।॥*#+=]+/).filter(Boolean);
}

/** Digits of one token, or null. `next` lets "thirty four" / "double five" consume a second token. */
type Step = { digits: string; used: number; ambiguous: boolean } | null;

function unitOf(tok: string | undefined): number | undefined {
  if (tok === undefined) return undefined;
  if (/^\d$/.test(tok)) return Number(tok);
  return UNITS[tok];
}

function step(toks: string[], i: number): Step {
  const tok = toks[i];
  if (/^\d+$/.test(tok)) return { digits: tok, used: 1, ambiguous: false };
  if (tok in MULT) {
    const u = unitOf(toks[i + 1]);
    if (u === undefined) return null;
    return { digits: String(u).repeat(MULT[tok]), used: 2, ambiguous: false };
  }
  if (tok in TEENS) return { digits: String(TEENS[tok]), used: 1, ambiguous: false };
  if (tok in TENS) {
    const u = UNITS[toks[i + 1] ?? ''];
    // "thirty four" → 34, but "thirty no" stays 30 + 9 only if "no" is read on its own.
    if (u !== undefined && u !== 0 && !AMBIGUOUS.has(toks[i + 1])) return { digits: String(TENS[tok] + u), used: 2, ambiguous: false };
    return { digits: String(TENS[tok]), used: 1, ambiguous: false };
  }
  if (tok in UNITS) return { digits: String(UNITS[tok]), used: 1, ambiguous: AMBIGUOUS.has(tok) };
  return null;
}

/** Read the whole utterance as one code. `expected` = the screen's OTP length (6). */
export function parseOtp(text: string, expected: number = OTP_LENGTH): OtpParse {
  const toks = tokens(text).filter((t) => !FILLERS.has(t));
  if (!toks.length) return { kind: 'none' };
  const parts: { digits: string; ambiguous: boolean }[] = [];
  for (let i = 0; i < toks.length;) {
    const s = step(toks, i);
    if (!s) return { kind: 'none' }; // a real word: this is a sentence / command, not a code
    parts.push({ digits: s.digits, ambiguous: s.ambiguous });
    i += s.used;
  }
  if (parts.every((p) => p.ambiguous)) return { kind: 'none' }; // "no", "do", "o"
  const all = parts.map((p) => p.digits).join('');
  if (all.length === expected) return { kind: 'ok', digits: all };
  // "no, 1 2 3 4 5 6": a leading "no" is a negation when the rest is exactly the code.
  if (parts[0].ambiguous) {
    const rest = parts.slice(1).map((p) => p.digits).join('');
    if (rest.length === expected) return { kind: 'ok', digits: rest };
  }
  return { kind: 'wrong_length', heard: all.length };
}

/** Number of digits to show as dots in the live pill for OTP-turn text (never the digits themselves). */
export function otpMaskFor(text: string): string {
  const p = parseOtp(text, OTP_LENGTH);
  const n = p.kind === 'ok' ? p.digits.length : p.kind === 'wrong_length' ? p.heard : (text.match(/[0-9०-९]/g)?.length ?? 0);
  return maskOtp(n);
}

/** Masked, digit-free prompt for a code of the wrong length / an unreachable server. */
export function otpSayAgainText(_heard?: number, expected: number = OTP_LENGTH): string {
  // Never says how many digits were heard (that leaks part of the code's shape); same line as the server.
  return `Say all ${expected} digits or type them.`;
}

/** Esign hands-off: the masked line spoken / shown while the OTP is verified (never the digits). */
export const ESIGN_VERIFY_TEXT = 'OTP entered, verifying';
/** Esign: verification failed → the boxes are cleared and this is spoken. */
export const ESIGN_RETRY_TEXT = "That OTP didn't work. Say the 6 digits again.";
/** Screens whose OTP step verifies on its own once a full code is spoken. */
export const AUTO_VERIFY_OTP_ROUTES: ReadonlySet<string> = new Set(['Esign']);

/** The 6-digit code a command carries for filling (server normalizedFields or the phone's own), else null. */
export function otpCodeOf(cmd: CommandResponse, expected: number = OTP_LENGTH): string | null {
  const f = (cmd.normalizedFields ?? []).find((x) => x.type === 'OTP' && x.valid);
  const d = f?.value.replace(/\D/g, '') ?? '';
  return d.length === expected ? d : null;
}

/**
 * Esign hands-off command: an OTP fill that the screen verifies at once (slots.otpSubmit). Status ok / auto so it
 * never shows a Confirm card; the transcript and every display copy are masked.
 */
export function esignOtpCommand(digits: string): CommandResponse {
  const cmd = localOtpCommand(digits);
  return { ...cmd, responseText: ESIGN_VERIFY_TEXT, readBack: ESIGN_VERIFY_TEXT, autoReason: 'esign_otp', candidates: undefined };
}

const masked = (n: number): NormalizedField => ({ type: 'OTP', value: maskOtp(n), valid: true, display: maskOtp(n), raw: '[otp]' });

/**
 * A fill command for a code the phone read itself. Same shape as the server's OTP fill (status ok, auto band, an
 * OTP field), so planCommand → 'fill' → applyCommand → voiceDraft.merge({ otp }) → the screen's setOtp + Undo.
 * Intent UNKNOWN / action none: it can never navigate, verify or sign.
 */
export function localOtpCommand(digits: string): CommandResponse {
  const n = digits.length;
  const line = `OTP captured, ${n === 6 ? 'six' : 'all'} digits`;
  return {
    transcript: '[otp utterance]', confidence: 1, engine: 'device', method: 'otp', matcher: 'otp-local',
    intent: 'UNKNOWN', score: 1, matchedPhrase: null, action: { type: 'none' }, status: 'ok',
    confidenceBand: 'auto', autoExecute: true, autoReason: 'field:OTP', hasOtpField: true,
    normalizedFields: [{ type: 'OTP', value: digits, valid: true, display: maskOtp(n), raw: '[otp]', readBack: line }],
    normalizedFieldsDisplay: [masked(n)],
    readBack: line, responseText: line,
  };
}

/** "Say all 6 digits again": nothing filled, masked everywhere, "Type it instead" still offered (hasOtpField). */
export function otpRetryCommand(heard?: number, expected: number = OTP_LENGTH): CommandResponse {
  const line = otpSayAgainText(heard, expected);
  const empty: NormalizedField = { type: 'OTP', value: '', valid: false, display: '', raw: '[otp]', error: line };
  return {
    transcript: '[otp utterance]', confidence: 0, engine: 'device', method: 'otp', matcher: 'otp-local',
    intent: 'UNKNOWN', score: 0, matchedPhrase: null, action: { type: 'none' }, status: 'retry',
    confidenceBand: 'retry', autoExecute: false, hasOtpField: true,
    normalizedFields: [empty], normalizedFieldsDisplay: [empty],
    readBack: line, responseText: line,
  };
}

export type OtpTurnPlan = { kind: 'local'; command: CommandResponse } | { kind: 'server' };

/** An OTP turn's text: fill / say-again on the phone, or ask the server (not digit-ish). */
export function planOtpTurn(text: string, expected: number = OTP_LENGTH): OtpTurnPlan {
  const p = parseOtp(text, expected);
  if (p.kind === 'ok') return { kind: 'local', command: localOtpCommand(p.digits) };
  if (p.kind === 'wrong_length') return { kind: 'local', command: otpRetryCommand(p.heard, expected) };
  return { kind: 'server' };
}

const NUMBERISH = /[0-9०-९]|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|ek|teen|char|chaar|paanch|panch|chhe|saat|aath|nau|shunya)\b|शून्य|एक|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ/i;

/**
 * Make a command from the server (or the phone's matcher) safe for an OTP turn:
 *  - an OTP field of the wrong length is NOT filled (marked invalid, masked "Say all 6 digits or type them.");
 *  - a transcript with digits / number words is never shown (→ "[otp utterance]").
 * Never adds a verify / sign: it only removes fills.
 */
export function otpSafeCommand(cmd: CommandResponse, expected: number = OTP_LENGTH): CommandResponse {
  let out = cmd;
  const real = cmd.normalizedFields ?? [];
  const bad = real.findIndex((f) => f.type === 'OTP' && f.valid && f.value.replace(/\D/g, '').length !== expected);
  if (bad >= 0) {
    const heard = real[bad].value.replace(/\D/g, '').length;
    const line = otpSayAgainText(heard, expected);
    const fix = (f: NormalizedField): NormalizedField => (f.type === 'OTP' ? { ...f, value: '', valid: false, display: '', raw: '[otp]', error: line } : f);
    out = {
      ...out, normalizedFields: real.map(fix), normalizedFieldsDisplay: (cmd.normalizedFieldsDisplay ?? real).map(fix),
      status: 'retry', autoExecute: false, confidenceBand: 'retry', hasOtpField: true, readBack: line, responseText: line,
    };
  }
  if (NUMBERISH.test(out.transcript) && out.transcript !== '[otp utterance]') {
    out = { ...out, transcript: '[otp utterance]', normalizedTranscript: undefined };
  }
  return out;
}

/** Server unreachable on an OTP turn: a plain digit-free command still works offline, anything else is "say all 6 digits". */
export function otpOfflineCommand(text: string, local: CommandResponse, expected: number = OTP_LENGTH): CommandResponse {
  if (!NUMBERISH.test(text) && (local.status ?? 'ok') !== 'retry') return local;
  return otpRetryCommand(undefined, expected);
}

/**
 * The screen-side draft → boxes decision (Esign, DealerOtp, SearchMobile stage=otp): the code to put in the
 * boxes with setOtp, or null. Exactly `expected` digits, and never while blocked (signing / locked / no session).
 * The caller only calls setOtp — it must never call verify(): the dealer taps Verify / E-sign.
 */
export function otpFromDraft(code: string | undefined, blocked: boolean, expected: number = OTP_LENGTH): string | null {
  if (blocked || !code) return null;
  return new RegExp(`^\\d{${expected}}$`).test(code) ? code : null;
}

export type OtpTurnDecision =
  /** Esign: fill + verify now (hands-off). `code` is the secret; `command` is fully masked. */
  | { kind: 'esign_auto'; code: string; command: CommandResponse }
  /** Anything else: deliver as usual (fill with toast + Undo, or the masked say-again preview). */
  | { kind: 'deliver'; command: CommandResponse };

/**
 * What an OTP turn's answer (server or phone) does on `screen`. Esign + exactly 6 digits → hands-off, whatever
 * the server's band says (S1 sent confirm; the hands-off server sends auto): no Confirm card, no clarify.
 */
export function decideOtpTurn(cmd: CommandResponse, screen: string | undefined, expected: number = OTP_LENGTH): OtpTurnDecision {
  const safe = otpSafeCommand(cmd, expected);
  const code = AUTO_VERIFY_OTP_ROUTES.has(screen ?? '') ? otpCodeOf(safe, expected) : null;
  if (code) {
    const n = maskOtp(expected);
    return { kind: 'esign_auto', code, command: { ...esignOtpCommand(code), normalizedFields: [{ type: 'OTP', value: n, valid: true, display: n, raw: '[otp]' }] } };
  }
  return { kind: 'deliver', command: safe };
}
