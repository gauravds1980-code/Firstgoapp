import { useEffect, useRef } from 'react';
import type { NavigationState } from '@react-navigation/native';
import { navRef } from '../navigation/navRef';
import { voiceDraft, type VoiceDraft } from './voiceDraft';
import type { UndoSlot } from './voiceLogic';

/**
 * Undo for auto-acted voice commands (v1.2.7).
 *
 * Screens that own a value voice can change register a source for it while focused:
 *   AssetScreen → 'asset', 'tenure'; SearchMobile → 'mobile', 'otp'; DealerOtp → 'otp'.
 * Right before an auto-act, `captureUndo` snapshots the navigation state, the voice draft and the
 * current value of every relevant source. `runUndo` puts them back. Undo never presses Verify /
 * Continue / Submit, and OTP values are never logged.
 */
type Source<T = unknown> = { get: () => T; set: (v: T) => void };

const sources = new Map<UndoSlot, Source>();

/** Register a source for `slot` (latest registration wins). Returns an unregister function. */
export function registerUndoSource<T>(slot: UndoSlot, src: Source<T>): () => void {
  sources.set(slot, src as Source);
  return () => { if (sources.get(slot) === src) sources.delete(slot); };
}

/**
 * Hook form: registers while `enabled` (usually `useIsFocused()`), always reading the latest
 * `get` / `set` through refs so callers can pass inline closures.
 */
export function useUndoSource<T>(slot: UndoSlot, get: () => T, set: (v: T) => void, enabled = true): void {
  const getRef = useRef(get);
  const setRef = useRef(set);
  getRef.current = get;
  setRef.current = set;
  useEffect(() => {
    if (!enabled) return;
    return registerUndoSource<T>(slot, { get: () => getRef.current(), set: (v) => setRef.current(v) });
  }, [slot, enabled]);
}

export type UndoRecord = {
  nav: NavigationState | null;
  routeKey: string | null;
  draft: VoiceDraft | null;
  values: { slot: UndoSlot; src: Source; value: unknown }[];
  navigates: boolean;
};

/** Snapshot before an auto-act. `navigates` = the act will change screen. */
export function captureUndo(slots: UndoSlot[], navigates: boolean): UndoRecord {
  const ready = navRef.isReady();
  const values: UndoRecord['values'] = [];
  for (const slot of slots) {
    const src = sources.get(slot);
    if (!src) continue;
    try { values.push({ slot, src, value: src.get() }); } catch { /* screen gone */ }
  }
  return {
    nav: ready && navigates ? (navRef.getRootState() as NavigationState | undefined) ?? null : null,
    routeKey: ready ? navRef.getCurrentRoute()?.key ?? null : null,
    draft: voiceDraft.peek(),
    values,
    navigates,
  };
}

/** Put everything back. Never throws; never submits anything. */
export function runUndo(u: UndoRecord): void {
  // Draft first, so a screen does not re-apply slots the act left behind.
  voiceDraft.restore(u.draft);
  if (u.navigates && navRef.isReady()) {
    try {
      const state = navRef.getRootState() as NavigationState | undefined;
      const prevTop = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
      // Usual case: the act pushed one screen on top of where the dealer was → animate back.
      if (u.routeKey && prevTop?.key === u.routeKey && navRef.canGoBack()) navRef.goBack();
      else if (u.nav && navRef.getCurrentRoute()?.key !== u.routeKey) navRef.resetRoot(u.nav);
    } catch {
      // Nothing to go back to: stay.
    }
  }
  for (const { slot, src, value } of u.values) {
    // Only restore into the same screen instance that was snapshotted.
    if (sources.get(slot) !== src) continue;
    try { src.set(value); } catch { /* screen gone */ }
  }
}
