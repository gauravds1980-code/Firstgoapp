import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { secureStorage } from '../utils/secureStorage';
import { defaultOnDeviceAsr, type TalkMode, type VoiceLocale } from './voiceMode';

/**
 * Dealer voice settings (persisted on device).
 *
 * askBeforeActing — default OFF: Zippy acts on high-confidence commands right away and shows an Undo
 *   toast. ON: every actionable command opens the Confirm sheet first (the v1.2.6 behaviour).
 * mode (v1.4.0) — 'ptt' (default): hold the mic, release ends the turn. 'handsfree': tap once, the
 *   recognizer's end-of-speech ends the turn (capped at 15 s); tap again to cancel.
 * locale (v1.4.0) — recognizer language: 'en-IN' (default), 'hi-IN', or 'auto'.
 * onDeviceAsr (v1.4.0, feature flag `voice.onDeviceAsr`) — use the phone's speech recognizer as the
 *   primary path (live words, no upload wait). Default ON on native, OFF on web. When off or
 *   unavailable the app records and sends the clip to the voice server, as before.
 * metricsLog (v1.4.0, dev flag) — print one `[voice-metrics]` line per turn to the console.
 *
 * Kept in memory (sync reads for the voice hook) and mirrored to secureStorage (Keychain / Keystore on
 * device, localStorage on web) — the app already ships expo-secure-store, so no new native module.
 */
export type VoiceSettings = {
  askBeforeActing: boolean;
  mode: TalkMode;
  locale: VoiceLocale;
  onDeviceAsr: boolean;
  metricsLog: boolean;
};

const KEYS: Record<keyof VoiceSettings, string> = {
  askBeforeActing: 'firstgo.voice.askBeforeActing',
  mode: 'firstgo.voice.mode',
  locale: 'firstgo.voice.locale',
  onDeviceAsr: 'firstgo.voice.onDeviceAsr',
  metricsLog: 'firstgo.voice.metricsLog',
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  askBeforeActing: false,
  mode: 'ptt',
  locale: 'en-IN',
  onDeviceAsr: defaultOnDeviceAsr(Platform.OS),
  metricsLog: false,
};

let settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
/** Keys the dealer changed before the initial read finished (their choice wins). */
const touched = new Set<keyof VoiceSettings>();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const encode = (k: keyof VoiceSettings, v: VoiceSettings[keyof VoiceSettings]): string => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
function decode<K extends keyof VoiceSettings>(k: K, raw: string | null | undefined): VoiceSettings[K] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const d = DEFAULT_VOICE_SETTINGS[k];
  if (typeof d === 'boolean') return (raw === '1') as VoiceSettings[K];
  if (k === 'mode') return (raw === 'handsfree' || raw === 'ptt' ? raw : undefined) as VoiceSettings[K] | undefined;
  if (k === 'locale') return (raw === 'en-IN' || raw === 'hi-IN' || raw === 'auto' ? raw : undefined) as VoiceSettings[K] | undefined;
  return undefined;
}

export const getVoiceSettings = (): VoiceSettings => settings;

export function setVoiceSetting<K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]): void {
  touched.add(k);
  if (settings[k] === v) return;
  settings = { ...settings, [k]: v };
  emit();
  void secureStorage.set(KEYS[k], encode(k, v)).catch(() => {});
}

export const getAskBeforeActing = (): boolean => settings.askBeforeActing;
export const setAskBeforeActing = (on: boolean): void => setVoiceSetting('askBeforeActing', on);

/** Read the stored values once (VoiceHost calls this on mount). Safe to call repeatedly. */
export async function loadVoiceSettings(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const next = { ...settings };
  let changed = false;
  await Promise.all((Object.keys(KEYS) as (keyof VoiceSettings)[]).map(async (k) => {
    try {
      const v = decode(k, await secureStorage.get(KEYS[k]));
      if (v !== undefined && !touched.has(k) && next[k] !== v) { (next as Record<string, unknown>)[k] = v; changed = true; }
    } catch {
      // Storage unavailable: keep the default.
    }
  }));
  if (changed) { settings = { ...settings, ...Object.fromEntries((Object.keys(next) as (keyof VoiceSettings)[]).filter((k) => !touched.has(k)).map((k) => [k, next[k]])) }; emit(); }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribe, getVoiceSettings, getVoiceSettings);
}

export function useAskBeforeActing(): boolean {
  return useVoiceSettings().askBeforeActing;
}
