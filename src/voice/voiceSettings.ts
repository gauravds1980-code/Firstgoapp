import { useSyncExternalStore } from 'react';
import { secureStorage } from '../utils/secureStorage';

/**
 * Dealer voice settings (persisted on device).
 *
 * askBeforeActing — default OFF: Zippy acts on high-confidence commands right away and shows an Undo
 * toast. ON: every actionable command opens the Confirm sheet first (the v1.2.6 behaviour).
 *
 * Kept in memory (sync reads for the voice hook) and mirrored to secureStorage (Keychain / Keystore on
 * device, localStorage on web) — the app already ships expo-secure-store, so no new native module.
 */
const KEY = 'firstgo.voice.askBeforeActing';

let askBeforeActing = false;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getAskBeforeActing = (): boolean => askBeforeActing;

export function setAskBeforeActing(on: boolean): void {
  loaded = true; // a dealer's choice wins over a slow initial read
  if (askBeforeActing === on) return;
  askBeforeActing = on;
  emit();
  void secureStorage.set(KEY, on ? '1' : '0').catch(() => {});
}

/** Read the stored value once (VoiceHost calls this on mount). Safe to call repeatedly. */
export async function loadVoiceSettings(): Promise<void> {
  if (loaded) return;
  try {
    const v = await secureStorage.get(KEY);
    if (loaded) return;
    loaded = true;
    const on = v === '1';
    if (on !== askBeforeActing) { askBeforeActing = on; emit(); }
  } catch {
    // Storage unavailable: keep the default (off).
  }
}

export function useAskBeforeActing(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    getAskBeforeActing,
    getAskBeforeActing,
  );
}
