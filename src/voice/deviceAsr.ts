/**
 * The phone's built-in speech recognizer (expo-speech-recognition) as the PRIMARY voice path (v1.4.0).
 *
 *  - Live partial text while the dealer speaks (interimResults), en-IN by default, hi-IN on request.
 *  - On-device / offline recognition when the device has the model for the locale
 *    (requiresOnDeviceRecognition, checked with supportsOnDeviceRecognition / getSupportedLocales).
 *  - Biased toward the dealer glossary + on-screen names (contextualStrings).
 *  - Records the same audio in parallel (recordingOptions.persist, Android 13+ / iOS) so the Whisper
 *    server can run its accurate second check in the background.
 *
 * The native module is loaded lazily: on web, in Expo Go or in a dev build without the module,
 * `deviceAsrSupport()` reports it missing and the app uses the record → server path instead.
 * OTP: transcripts are never logged here.
 */
import { Platform } from 'react-native';
import type { ExpoSpeechRecognitionErrorEvent, ExpoSpeechRecognitionOptions, ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { androidLocaleExtras, recognizerLang, type VoiceLocale } from './voiceMode';

type Module = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

let mod: Module | null | undefined;
function load(): Module | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') { mod = null; return mod; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule ?? null;
  } catch {
    mod = null; // Expo Go / a dev build made before the module was added.
  }
  return mod;
}

export type DeviceAsrSupport = { moduleLoaded: boolean; available: boolean; onDevice: boolean; canRecord: boolean };

let installed: Record<string, boolean> = {};
let warmed = false;

/** Cheap, synchronous capability check (no prompt). */
export function deviceAsrSupport(lang?: string): DeviceAsrSupport {
  const m = load();
  if (!m) return { moduleLoaded: false, available: false, onDevice: false, canRecord: false };
  let available = false; let onDevice = false; let canRecord = false;
  try { available = m.isRecognitionAvailable(); } catch { /* treat as unavailable */ }
  try { onDevice = m.supportsOnDeviceRecognition(); } catch { /* network recognizer only */ }
  try { canRecord = m.supportsRecording(); } catch { /* no parallel audio */ }
  // Android: the offline model must be installed for this locale, or requiresOnDeviceRecognition fails.
  if (onDevice && Platform.OS === 'android' && lang && warmed) onDevice = installed[lang] === true;
  return { moduleLoaded: true, available, onDevice, canRecord };
}

/** Look up installed offline locales once (Android) so the first turn can pick on-device recognition. */
export async function warmDeviceAsr(): Promise<void> {
  const m = load();
  if (!m || warmed) return;
  try {
    if (Platform.OS === 'android') {
      const r = await m.getSupportedLocales({});
      installed = Object.fromEntries((r.installedLocales ?? []).map((l) => [l, true]));
    }
  } catch { /* keep network recognition */ }
  warmed = true;
}

/** Mic + speech-recognition permission (iOS asks for both; Android RECORD_AUDIO). */
export async function deviceAsrPermission(request: boolean): Promise<'granted' | 'denied' | 'undetermined'> {
  const m = load();
  if (!m) return 'denied';
  try {
    const r = request ? await m.requestPermissionsAsync() : await m.getPermissionsAsync();
    if (r.granted) return 'granted';
    return r.canAskAgain && !request ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

export interface DeviceAsrCallbacks {
  onStart?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string, confidence: number) => void;
  onSpeechEnd?: () => void;
  onError?: (code: string, message: string) => void;
  /** Recognition finished (always last, also after errors / abort). */
  onEnd?: () => void;
  /** Parallel recording finished: a local WAV the Whisper check can upload. */
  onAudio?: (uri: string) => void;
}

export interface DeviceAsrHandle { stop(): void; abort(): void }

/**
 * Start one recognition turn. `continuous: false`: the recognizer ends the turn at end-of-speech (hands-free)
 * or when `stop()` is called (push-to-talk release), emitting a final result first.
 */
export function startDeviceAsr(o: {
  locale: VoiceLocale; contextualStrings: string[]; persistAudio: boolean; preferOnDevice: boolean;
} & DeviceAsrCallbacks): DeviceAsrHandle | null {
  const m = load();
  if (!m) return null;
  const lang = recognizerLang(o.locale);
  const sup = deviceAsrSupport(lang);
  const subs: { remove(): void }[] = [];
  let ended = false;
  let gotFinal = false;
  let lastPartial = '';
  const cleanup = () => { while (subs.length) { try { subs.pop()?.remove(); } catch { /* gone */ } } };
  subs.push(m.addListener('start', () => o.onStart?.()));
  subs.push(m.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
    const best = e.results?.[0];
    const text = (best?.transcript ?? '').trim();
    if (!e.isFinal) { if (text) { lastPartial = text; o.onPartial?.(text); } return; }
    if (gotFinal) return;
    gotFinal = true;
    o.onFinal?.(text || lastPartial, typeof best?.confidence === 'number' && best.confidence >= 0 ? best.confidence : 0.8);
  }));
  subs.push(m.addListener('speechend', () => o.onSpeechEnd?.()));
  subs.push(m.addListener('nomatch', () => { if (!gotFinal) { gotFinal = true; if (lastPartial) o.onFinal?.(lastPartial, 0.5); else o.onError?.('no-speech', 'nomatch'); } }));
  subs.push(m.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
    // A partial already on screen is better than an error ("no-speech" after the dealer spoke).
    if (!gotFinal && lastPartial && e.error !== 'aborted') { gotFinal = true; o.onFinal?.(lastPartial, 0.5); return; }
    o.onError?.(e.error, e.message);
  }));
  subs.push(m.addListener('audioend', (e: { uri?: string | null }) => { if (e?.uri) o.onAudio?.(e.uri); }));
  subs.push(m.addListener('end', () => {
    if (ended) return;
    ended = true;
    if (!gotFinal && lastPartial) { gotFinal = true; o.onFinal?.(lastPartial, 0.5); }
    cleanup();
    o.onEnd?.();
  }));
  const opts: ExpoSpeechRecognitionOptions = {
    lang,
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    addsPunctuation: false,
    requiresOnDeviceRecognition: o.preferOnDevice && sup.onDevice,
    contextualStrings: o.contextualStrings,
    iosTaskHint: 'search',
    androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search', ...androidLocaleExtras(o.locale) },
    ...(o.persistAudio && sup.canRecord ? {
      recordingOptions: { persist: true, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' as const },
    } : {}),
  };
  try {
    m.start(opts);
  } catch (e) {
    cleanup();
    o.onError?.('client', e instanceof Error ? e.message : 'start failed');
    o.onEnd?.();
    return null;
  }
  return {
    stop: () => { try { m.stop(); } catch { /* already stopped */ } },
    abort: () => { try { m.abort(); } catch { /* already stopped */ } },
  };
}
