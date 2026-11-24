import { useEffect, useSyncExternalStore } from 'react';
import { useRoute } from '@react-navigation/native';
import { secureStorage } from '../../utils/secureStorage';

/**
 * Tiny shared store for Zippy (no provider needed): dock state shared by the floating overlay
 * (ZippyBubble) and the header slots (HeaderDockSlot), screen-level mood overrides, and the
 * focused screen's header slot to fly into.
 */

export type ZippyMood = 'idle' | 'happy' | 'thinking' | 'cheer';

/**
 * hydrating → reading the persisted flag (nothing drawn yet)
 * docked    → DEFAULT. Mini face in the header slot; tap = help sheet, long-press = float on screen
 * floating  → orb on screen (opt-in; long-press it, or use the sheet menu, to dock it again)
 * docking   → orb flying up into the header slot
 * docked    → mini face drawn by the header slot; overlay hidden
 * undocking → slot was tapped; overlay is measuring the slot (slot still draws the face)
 * returning → orb flying from the slot back down to its rest position
 */
export type DockPhase = 'hydrating' | 'floating' | 'docking' | 'docked' | 'undocking' | 'returning';

export type WindowRect = { x: number; y: number; width: number; height: number };
type Measurer = (cb: (r: WindowRect | null) => void) => void;

/**
 * v1.2.4: Zippy docks in the header by default. The flag now records the opt-in to FLOAT ('1');
 * a new key, so every install starts docked whatever the old `firstgo.zippy.docked` said.
 */
export const FLOAT_STORAGE_KEY = 'firstgo.zippy.float';

/** One tip at a time, shown by the focused screen's ZippyTipSlot (anchored above its footer / FAB). */
export type ZippyTip = { route: string; text: string; id: number };

type Snapshot = { phase: DockPhase; moodVersion: number; tip: ZippyTip | null; sheetRequest: number };
let snap: Snapshot = { phase: 'hydrating', moodVersion: 0, tip: null, sheetRequest: 0 };
const listeners = new Set<() => void>();
const emit = (next: Partial<Snapshot>) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export function useZippyStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const zippyDock = {
  get phase() { return snap.phase; },
  setPhase(phase: DockPhase) { if (snap.phase !== phase) emit({ phase }); },
  /** Restore the persisted preference once per app launch. Docked unless the dealer chose to float Zippy. */
  hydrate() {
    if (snap.phase !== 'hydrating') return;
    secureStorage.get(FLOAT_STORAGE_KEY)
      .then((v) => { if (snap.phase === 'hydrating') emit({ phase: v === '1' ? 'floating' : 'docked' }); })
      .catch(() => { if (snap.phase === 'hydrating') emit({ phase: 'docked' }); });
  },
  persist(docked: boolean) {
    secureStorage.set(FLOAT_STORAGE_KEY, docked ? '0' : '1').catch(() => { /* non-critical UI preference */ });
  },
  /** Docked mini face long-pressed (or "Show Zippy on screen" in the sheet) → overlay flies the orb back out. */
  requestUndock() { if (snap.phase === 'docked') emit({ phase: 'undocking' }); },
  /** Open the help sheet (docked face tapped, or the tip bubble tapped). */
  requestSheet() { emit({ sheetRequest: snap.sheetRequest + 1 }); },
};

let tipSeq = 0;
export const zippyTip = {
  /** Show a tip on `route`; returns its id (for a targeted auto-dismiss). */
  show(route: string, text: string): number { const id = ++tipSeq; emit({ tip: { route, text, id } }); return id; },
  /** Hide the current tip (optionally only if it is still the one with this id). */
  hide(id?: number) { if (snap.tip && (id === undefined || snap.tip.id === id)) emit({ tip: null }); },
};

// ---- Header slots -------------------------------------------------------------------------------
// Only focused screens register; the most recently focused one is the fly target.
const slots: { id: string; measure: Measurer }[] = [];
export function registerDockSlot(id: string, measure: Measurer) {
  const i = slots.findIndex((x) => x.id === id);
  if (i >= 0) slots.splice(i, 1);
  slots.push({ id, measure });
  return () => { const j = slots.findIndex((x) => x.id === id); if (j >= 0) slots.splice(j, 1); };
}
/** Measure the focused screen's header slot (window coordinates); null if the screen has none. */
export function measureActiveSlot(cb: (r: WindowRect | null) => void) {
  const top = slots[slots.length - 1];
  if (!top) { cb(null); return; }
  top.measure(cb);
}

// ---- Moods --------------------------------------------------------------------------------------
/** Default mood per route: good-news screens smile wider, Disbursal celebrates. */
const ROUTE_MOOD: Record<string, ZippyMood> = { Offer: 'happy', Docs: 'happy', Disbursal: 'cheer' };
const moodOverrides = new Map<string, ZippyMood>();

export function moodForRoute(route?: string): ZippyMood {
  if (!route) return 'idle';
  return moodOverrides.get(route) ?? ROUTE_MOOD[route] ?? 'idle';
}

/** Current mood for a route; re-renders when any screen changes its override. */
export function useRouteMood(route?: string): ZippyMood {
  useZippyStore();
  return moodForRoute(route);
}

/**
 * In-screen mood override, e.g. `useZippyMood(capturing ? 'thinking' : null)` while KYC captures.
 * Keyed by the calling route; `null` falls back to the route default. Cleared on unmount.
 */
export function useZippyMood(mood: ZippyMood | null) {
  const route = useRoute().name;
  useEffect(() => {
    if (mood) moodOverrides.set(route, mood); else moodOverrides.delete(route);
    emit({ moodVersion: snap.moodVersion + 1 });
    return () => { moodOverrides.delete(route); emit({ moodVersion: snap.moodVersion + 1 }); };
  }, [route, mood]);
}
