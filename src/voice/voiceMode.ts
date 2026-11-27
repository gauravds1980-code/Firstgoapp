/**
 * v1.4.0 voice mode + fallback decisions, kept pure (no React Native) so they are unit-tested.
 *
 *  - Which ASR path a turn takes: the phone's recognizer (expo-speech-recognition) or the
 *    record → server (Whisper on 8793) path.
 *  - Recognizer locale and glossary biasing (contextual strings).
 *  - What a recognizer error means (fall back for the session / for this turn / say again).
 *  - Fallback end-of-turn detection for hands-free on the server path (input level metering).
 *  - Reconciling the device result with Whisper's second check: never silently flip.
 */
import type { CommandResponse } from './types';
import { sameTarget } from './intentMatcher';
import { isDestructiveCommand } from './voiceLogic';

export type TalkMode = 'ptt' | 'handsfree';
export type VoiceLocale = 'en-IN' | 'hi-IN' | 'auto';
export type AsrPath = 'device' | 'server';

export interface AsrEnv {
  platform: 'ios' | 'android' | 'web' | string;
  /** voice.onDeviceAsr setting (default on for native, off for web). */
  flagOn: boolean;
  /** expo-speech-recognition native module loaded (false in Expo Go / old dev builds). */
  moduleLoaded: boolean;
  /** ExpoSpeechRecognitionModule.isRecognitionAvailable(). */
  recognitionAvailable: boolean;
  /** A permanent recognizer failure already happened this app session (service missing, denied…). */
  disabledThisSession: boolean;
  /** Why the session was disabled (debug line only; 'error' when not given). */
  disabledBy?: 'permission' | 'error';
}

/** Why a turn used the server path (shown on the voice debug line). */
export type AsrServerReason = 'flag_off' | 'web' | 'no_module' | 'no_service' | 'disabled_after_error' | 'permission';

/** chooseAsrPath with the reason when it picks the server path. */
export function explainAsrPath(env: AsrEnv): { path: AsrPath; reason?: AsrServerReason } {
  if (!env.flagOn) return { path: 'server', reason: 'flag_off' };
  if (env.platform === 'web') return { path: 'server', reason: 'web' };
  if (!env.moduleLoaded) return { path: 'server', reason: 'no_module' };
  if (env.disabledThisSession) return { path: 'server', reason: env.disabledBy === 'permission' ? 'permission' : 'disabled_after_error' };
  if (!env.recognitionAvailable) return { path: 'server', reason: 'no_service' };
  return { path: 'device' };
}

/** On-device recognizer when everything lines up, else the server path (always works). */
export function chooseAsrPath(env: AsrEnv): AsrPath {
  return explainAsrPath(env).path;
}

/** Recognition services worth naming explicitly when the phone has no DEFAULT one (preference order). */
export const FALLBACK_RECOGNITION_SERVICES: readonly string[] = [
  'com.google.android.googlequicksearchbox',
  'com.google.android.as',
  'com.google.android.tts',
];

/**
 * Which recognition service to use. 'default' when the phone has a default service; else the first known
 * Google package that is installed (many Xiaomi / Oppo / Vivo / Realme phones ship without a default);
 * null when there is none.
 */
export function pickRecognitionService(defaultAvailable: boolean, services: readonly string[] | null | undefined): string | null {
  if (defaultAvailable) return 'default';
  const have = new Set((services ?? []).map((x) => x.trim()));
  return FALLBACK_RECOGNITION_SERVICES.find((p) => have.has(p)) ?? null;
}

/** Locale key for comparing recognizer locales: "en_IN" / "en-in" / "EN-IN" → "en-in". */
export const normLocale = (l: string): string => l.trim().toLowerCase().replace(/_/g, '-');

/** Offline model for `lang` is installed (normalised compare against getSupportedLocales().installedLocales). */
export function hasInstalledLocale(installed: readonly string[] | null | undefined, lang: string): boolean {
  const k = normLocale(lang);
  return (installed ?? []).some((l) => normLocale(l) === k);
}

export const defaultOnDeviceAsr = (platform: string): boolean => platform !== 'web';

/** BCP-47 tag for the recognizer. 'auto' listens in Indian English (Hinglish words come through romanized). */
export function recognizerLang(locale: VoiceLocale): 'en-IN' | 'hi-IN' {
  return locale === 'hi-IN' ? 'hi-IN' : 'en-IN';
}

/** Android language-detection extras for 'auto' (Android 14+ with the on-device service; ignored elsewhere). */
export function androidLocaleExtras(locale: VoiceLocale): Record<string, unknown> {
  if (locale !== 'auto') return {};
  return { EXTRA_ENABLE_LANGUAGE_DETECTION: true, EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: ['en-IN', 'hi-IN'] };
}

/** Dealer glossary: biases the recognizer toward FIRSTgo words (contextualStrings / EXTRA_BIASING_STRINGS). */
export const DEALER_GLOSSARY: readonly string[] = [
  'EMI', 'KYC', 'face KYC', 'e-KYC', 'RC', 'RC pendency', 'UPI', 'UPI mandate', 'mandate', 'e-sign', 'TA', 'TA INF', 'trade advance',
  'INF', 'payouts', 'portfolio', 'disbursal', 'pending disbursals', 'overdue cases', 'down payment', 'tenure', 'Aadhaar', 'PAN',
  'QR', 'scan QR', 'two-wheeler', 'Zippy', 'FIRSTgo', 'IDFC FIRST', 'dikhao', 'kholo', 'batao', 'chalo', 'shuru karo',
];

/** Glossary + names / labels from the screen (customer names, on-screen chips). Capped: recognizers limit the list. */
export function contextualStrings(extra: readonly (string | undefined | null)[] = [], max = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...extra, ...DEALER_GLOSSARY]) {
    const t = (s ?? '').trim();
    // Never bias with digit runs that could be an OTP / phone / amount (model numbers like 125R are fine).
    if (!t || /\d{4,}/.test(t) || t.length > 40) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** What a recognizer error means for this turn and the session. */
export type AsrErrorKind = 'disable' | 'fallback_turn' | 'no_speech' | 'cancelled' | 'permission'
  /** On-device model missing for the language: retry with the network recognizer (session stays on). */
  | 'retry_network'
  /** The recognizer refused the parallel audio copy (EXTRA_AUDIO_SOURCE): stop asking for it this session. */
  | 'drop_persist';
export interface AsrErrorContext { onDeviceRequested?: boolean; persistRequested?: boolean; gotResult?: boolean }
export function classifyAsrError(code: string | undefined, ctx: AsrErrorContext = {}): AsrErrorKind {
  if (code === 'language-not-supported' && ctx.onDeviceRequested) return 'retry_network';
  if ((code === 'client' || code === 'audio-capture' || code === 'unknown') && ctx.persistRequested && !ctx.gotResult) return 'drop_persist';
  switch (code) {
    case 'aborted': return 'cancelled';
    case 'no-speech':
    case 'speech-timeout':
    case 'nomatch': return 'no_speech';
    case 'not-allowed': return 'permission';
    // No recognition service / locale / language pack: don't try again this session.
    case 'service-not-allowed':
    case 'language-not-supported':
    case 'bad-grammar': return 'disable';
    // Network-based recognizer offline, busy, rate-limited, audio session interrupted, unknown client error: server path for this turn.
    case 'too-many-requests':
    case 'network':
    case 'busy':
    case 'audio-capture':
    case 'interrupted':
    case 'client':
    default: return 'fallback_turn';
  }
}

// ---------------------------------------------------------------------------------------------
// Hands-free end-of-turn on the server path (expo-audio metering, dBFS). The device recognizer
// decides end-of-speech itself; this is only the fallback when the recognizer is not in use.
// ---------------------------------------------------------------------------------------------
export interface EndpointerOptions { speechDb?: number; silenceMs?: number; minSpeechMs?: number; noSpeechMs?: number; maxMs?: number }
export type EndpointDecision = 'listen' | 'end' | 'no_speech' | 'max';

export function createEndpointer(o: EndpointerOptions = {}) {
  const speechDb = o.speechDb ?? -42;
  const silenceMs = o.silenceMs ?? 700;
  const minSpeechMs = o.minSpeechMs ?? 200;
  const noSpeechMs = o.noSpeechMs ?? 6000;
  const maxMs = o.maxMs ?? 15000;
  let t0: number | null = null;
  let speechStart: number | null = null;
  let lastVoice: number | null = null;
  return {
    /** Feed one level sample (dBFS, e.g. -160..0) at time `t` ms. */
    push(db: number | undefined, t: number): EndpointDecision {
      if (t0 === null) t0 = t;
      if (t - t0 >= maxMs) return 'max';
      if (db !== undefined && db >= speechDb) {
        if (speechStart === null) speechStart = t;
        lastVoice = t;
      }
      if (speechStart === null) return t - t0 >= noSpeechMs ? 'no_speech' : 'listen';
      if (lastVoice !== null && lastVoice - speechStart >= minSpeechMs && t - lastVoice >= silenceMs) return 'end';
      return 'listen';
    },
    get heardSpeech() { return speechStart !== null; },
  };
}

// ---------------------------------------------------------------------------------------------
// Whisper second check
// ---------------------------------------------------------------------------------------------
/** How sure Whisper's result must be to raise "Did you mean …?" over the device result. */
export const WHISPER_DISAGREE_MIN = 0.65;

/** Where the device result stands when Whisper's answer comes back. */
export type TurnStage = 'preview' | 'acted' | 'confirmed' | 'nothing' | 'gone';

export type Reconcile =
  | { kind: 'keep' }
  /** Device result had nothing to do: Whisper's result becomes the turn's result (normal rules apply). */
  | { kind: 'use_server' }
  /** Preview still open: re-stage it as "Did you mean <Whisper's phrase>?" (device result as the alternative). */
  | { kind: 'did_you_mean' }
  /** Auto-act already ran: keep it, offer Undo + "Did you mean <Whisper's phrase>?". */
  | { kind: 'offer_undo' };

const actionable = (c: CommandResponse) => (c.status ?? 'ok') === 'ok' && c.intent !== 'UNKNOWN' && c.action.type !== 'none';

export function reconcile(device: CommandResponse, server: CommandResponse, stage: TurnStage): Reconcile {
  if (stage === 'gone' || stage === 'confirmed') return { kind: 'keep' };
  const serverOk = actionable(server) && server.score >= WHISPER_DISAGREE_MIN;
  if (stage === 'nothing' || !actionable(device)) {
    // The device result was a retry / say-again: Whisper's result is the fallback answer.
    return serverOk || (server.status === 'clarify' && (server.candidates?.length ?? 0) > 0) ? { kind: 'use_server' } : { kind: 'keep' };
  }
  if (!serverOk || sameTarget(device, server)) return { kind: 'keep' };
  return stage === 'preview' ? { kind: 'did_you_mean' } : { kind: 'offer_undo' };
}

/**
 * Preview re-staged after Whisper disagreed: "Did you mean <server>?" with the device's reading as the
 * alternative. Status clarify, so nothing runs until the dealer taps; a destructive pick still needs Confirm.
 */
export function didYouMeanFrom(device: CommandResponse, server: CommandResponse): CommandResponse {
  const cand = (c: CommandResponse) => ({ intent: c.intent, phrase: c.matchedPhrase ?? c.intent.toLowerCase().replace(/_/g, ' '), score: c.score });
  return {
    ...device,
    status: 'clarify',
    intent: 'UNKNOWN',
    action: { type: 'none' },
    autoExecute: false,
    confidenceBand: 'clarify',
    autoReason: 'whisper_disagreed',
    candidates: [cand(server), cand(device)],
    responseText: 'Did you mean this?',
  };
}

/**
 * One-tap on a "Did you mean" candidate is the dealer's confirm: it acts at once, unless the picked command is
 * destructive (submit / sign / pay / mandate / upload) — then the normal Confirm is still required.
 */
export const oneTapActs = (staged: CommandResponse): boolean => (staged.status ?? 'ok') === 'ok' && !isDestructiveCommand(staged);

/** Lookup key of a bundled reply clip (same transform as firstgo-voice-local/scripts/make_reply_clips.py). */
export const clipKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
