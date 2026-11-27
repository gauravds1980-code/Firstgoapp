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
import { androidLocaleExtras, hasInstalledLocale, normLocale, pickRecognitionService, recognizerLang, type VoiceLocale } from './voiceMode';

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

export type DeviceAsrSupport = {
  moduleLoaded: boolean; available: boolean; onDevice: boolean; canRecord: boolean;
  /** 'default' recognition service, or the explicit package used because the phone has no default (Android). */
  service: string | null;
};

let installed: string[] = [];
let warmed = false;
/** Session memory (v1.4.2): the recognizer refused the parallel audio copy → never ask for it again this session. */
let persistBroken = false;
/** Session memory: languages whose on-device model failed ('language-not-supported') → network recognizer. */
const onDeviceBroken = new Set<string>();
/** Service lookup is cached once a service is found (the dealer may install / enable the Google app later). */
let serviceCache: string | null = null;

export function markPersistBroken(): void { persistBroken = true; }
export function markOnDeviceBroken(lang: string): void { onDeviceBroken.add(normLocale(lang)); }
export const isPersistBroken = (): boolean => persistBroken;

function resolveService(m: Module, defaultAvailable: boolean): string | null {
  if (defaultAvailable) return 'default';
  if (Platform.OS !== 'android') return null;
  if (serviceCache) return serviceCache;
  const services: string[] = [];
  try { services.push(...(m.getSpeechRecognitionServices() ?? [])); } catch { /* old module / no services */ }
  try { const d = m.getDefaultRecognitionService()?.packageName; if (d) services.push(d); } catch { /* none */ }
  serviceCache = pickRecognitionService(false, services);
  return serviceCache;
}

/** Cheap, synchronous capability check (no prompt). */
export function deviceAsrSupport(lang?: string): DeviceAsrSupport {
  const m = load();
  if (!m) return { moduleLoaded: false, available: false, onDevice: false, canRecord: false, service: null };
  let defaultAvailable = false; let onDevice = false; let canRecord = false;
  try { defaultAvailable = m.isRecognitionAvailable(); } catch { /* treat as unavailable */ }
  try { onDevice = m.supportsOnDeviceRecognition(); } catch { /* network recognizer only */ }
  try { canRecord = m.supportsRecording() && !persistBroken; } catch { /* no parallel audio */ }
  const service = resolveService(m, defaultAvailable);
  if (Platform.OS === 'android') {
    // On-device only when CONFIRMED: the offline model for this locale is installed (normalised compare),
    // the default service is used (an explicit package can't be combined with on-device), and it hasn't failed.
    onDevice = onDevice && warmed && !!lang && service === 'default' && hasInstalledLocale(installed, lang) && !onDeviceBroken.has(normLocale(lang));
  } else if (lang && onDeviceBroken.has(normLocale(lang))) {
    onDevice = false;
  }
  return { moduleLoaded: true, available: service !== null, onDevice, canRecord, service };
}

/** Look up installed offline locales once (Android) so the first turn can pick on-device recognition. */
export async function warmDeviceAsr(): Promise<void> {
  const m = load();
  if (!m || warmed) return;
  try {
    if (Platform.OS === 'android') {
      const r = await m.getSupportedLocales({});
      installed = (r.installedLocales ?? []).filter((l): l is string => typeof l === 'string');
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
  /** `confidence` is the recogniser's raw value (-1 = missing, 0 often = unknown on Android); 0.5 = built from the last partial. */
  onFinal?: (text: string, confidence: number) => void;
  onSpeechEnd?: () => void;
  onError?: (code: string, message: string, info: DeviceAsrStartInfo) => void;
  /** Recognition finished (always last, also after errors / abort). */
  onEnd?: () => void;
  /** Parallel recording finished: a local WAV the Whisper check can upload. */
  onAudio?: (uri: string) => void;
}

/** What a turn asked the recognizer for (and whether anything came back) — classifies early failures. */
export interface DeviceAsrStartInfo {
  service: string;
  onDeviceRequested: boolean;
  persistRequested: boolean;
  /** Any partial or final result arrived before the error. */
  gotResult: boolean;
}

export interface DeviceAsrHandle { stop(): void; abort(): void; info: DeviceAsrStartInfo }

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
  const onDeviceRequested = o.preferOnDevice && sup.onDevice;
  const persistRequested = o.persistAudio && sup.canRecord && !persistBroken;
  const service = sup.service ?? 'default';
  const info: DeviceAsrStartInfo = { service, onDeviceRequested, persistRequested, gotResult: false };
  const cleanup = () => { while (subs.length) { try { subs.pop()?.remove(); } catch { /* gone */ } } };
  subs.push(m.addListener('start', () => o.onStart?.()));
  subs.push(m.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
    const best = e.results?.[0];
    const text = (best?.transcript ?? '').trim();
    if (text) info.gotResult = true;
    if (!e.isFinal) { if (text) { lastPartial = text; o.onPartial?.(text); } return; }
    if (gotFinal) return;
    gotFinal = true;
    // RAW confidence (-1 when missing; Android often 0 / -1 for every result): the hook normalises it
    // (confidenceGate.normalizeAsrConfidence). Partial-fallback finals below pass 0.5 = known-shaky.
    o.onFinal?.(text || lastPartial, typeof best?.confidence === 'number' && Number.isFinite(best.confidence) ? best.confidence : -1);
  }));
  subs.push(m.addListener('speechend', () => o.onSpeechEnd?.()));
  subs.push(m.addListener('nomatch', () => { if (!gotFinal) { gotFinal = true; if (lastPartial) o.onFinal?.(lastPartial, 0.5); else o.onError?.('no-speech', 'nomatch', info); } }));
  subs.push(m.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
    // A partial already on screen is better than an error ("no-speech" after the dealer spoke).
    if (!gotFinal && lastPartial && e.error !== 'aborted') { gotFinal = true; o.onFinal?.(lastPartial, 0.5); return; }
    o.onError?.(e.error, e.message, info);
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
    // Never together with an explicit service package (createOnDeviceSpeechRecognizer ignores it).
    requiresOnDeviceRecognition: onDeviceRequested && service === 'default',
    ...(service !== 'default' ? { androidRecognitionServicePackage: service } : {}),
    contextualStrings: o.contextualStrings,
    iosTaskHint: 'search',
    androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search', ...androidLocaleExtras(o.locale) },
    ...(persistRequested ? {
      recordingOptions: { persist: true, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' as const },
    } : {}),
  };
  try {
    m.start(opts);
  } catch (e) {
    cleanup();
    o.onError?.('client', e instanceof Error ? e.message : 'start failed', info);
    o.onEnd?.();
    return null;
  }
  return {
    info,
    stop: () => { try { m.stop(); } catch { /* already stopped */ } },
    abort: () => { try { m.abort(); } catch { /* already stopped */ } },
  };
}
