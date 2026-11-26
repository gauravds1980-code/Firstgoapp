import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { secureStorage } from '../../utils/secureStorage';
import { routeDockDecision } from './zippyDockDefault';

/**
 * Tiny shared store for Zippy (no provider needed): dock state shared by the floating overlay
 * (ZippyBubble) and the header slots (HeaderDockSlot), screen-level mood overrides, and the
 * focused screen's header slot to fly into.
 */

export type ZippyMood = 'idle' | 'happy' | 'thinking' | 'cheer';

/**
 * hydrating → reading the persisted flag (nothing drawn yet)
 * floating  → DEFAULT (v1.2.9). Orb on screen, always fully inside the safe area; drag it up into the
 *             header (or long-press it, or use the sheet menu) to dock it
 * docking   → orb flying up into the header slot
 * docked    → mini face drawn by the header slot; overlay hidden. Tap = help sheet; drag it down out of
 *             the header (or long-press) to float it again
 * undocking → slot asked to undock; overlay is measuring the slot (slot still draws the face)
 * returning → orb flying from the slot back down to its rest position
 */
export type DockPhase = 'hydrating' | 'floating' | 'docking' | 'docked' | 'undocking' | 'returning';

export type WindowRect = { x: number; y: number; width: number; height: number };
type Measurer = (cb: (r: WindowRect | null) => void) => void;

/**
 * v1.2.9: Zippy FLOATS by default. New key (so every install starts floating whatever the older
 * `firstgo.zippy.float` / `firstgo.zippy.docked` said): 'docked' | 'floating'; missing = floating.
 */
export const DOCK_STORAGE_KEY = 'firstgo.zippy.dock.v129';
export type DockPref = 'docked' | 'floating';

/**
 * Web screenshots only: `?zippy=docked` / `?zippy=floating` in the URL forces that phase at hydration
 * (not persisted). Ignored on native.
 */
function webForcedPhase(): DockPref | null {
  if (Platform.OS !== 'web') return null;
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const v = new URLSearchParams(search).get('zippy');
    return v === 'docked' || v === 'floating' ? v : null;
  } catch { return null; }
}

/** One tip at a time, shown by the focused screen's ZippyTipSlot (anchored above its footer / FAB). */
export type ZippyTip = { route: string; text: string; id: number };

/** A window-coordinate point (e.g. where the docked face was dragged out of the header). */
export type WindowPoint = { x: number; y: number };

/**
 * dropHint → a floating Zippy is being dragged over the header dock zone: the focused HeaderDockSlot
 * shows a subtle "drop to dock" highlight.
 * undockAt → where the docked face was dragged out to (window coords); the orb lands there (clamped).
 */
type Snapshot = { phase: DockPhase; moodVersion: number; tip: ZippyTip | null; sheetRequest: number; dropHint: boolean; undockAt: WindowPoint | null };
let snap: Snapshot = { phase: 'hydrating', moodVersion: 0, tip: null, sheetRequest: 0, dropHint: false, undockAt: null };
const listeners = new Set<() => void>();
const emit = (next: Partial<Snapshot>) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export function useZippyStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * design-a: route-level dock default (see zippyDockDefault.ts). Module state, never persisted:
 * globalPref mirrors the stored preference; routeDocked = the current dock came from the route default;
 * undockedVisit = the data screen the dealer undocked on during this visit; forced = `?zippy=` on web.
 */
const routeDock = { globalPref: 'floating' as DockPref, routeDocked: false, undockedVisit: null as string | null, visitRoute: undefined as string | undefined, forced: false };

export const zippyDock = {
  get phase() { return snap.phase; },
  setPhase(phase: DockPhase) { if (snap.phase !== phase) emit({ phase }); },
  /** Restore the persisted preference once per app launch. Floating unless the dealer docked Zippy. */
  hydrate() {
    if (snap.phase !== 'hydrating') return;
    const forced = webForcedPhase();
    if (forced) { routeDock.forced = true; routeDock.globalPref = forced; emit({ phase: forced }); return; }
    secureStorage.get(DOCK_STORAGE_KEY)
      .then((v) => { routeDock.globalPref = v === 'docked' ? 'docked' : 'floating'; if (snap.phase === 'hydrating') emit({ phase: routeDock.globalPref }); })
      .catch(() => { if (snap.phase === 'hydrating') emit({ phase: 'floating' }); });
  },
  /** The dealer chose docked / floating (drag, long-press, sheet menu): the global preference. */
  persist(docked: boolean) {
    const v: DockPref = docked ? 'docked' : 'floating';
    routeDock.globalPref = v;
    routeDock.routeDocked = false;
    secureStorage.set(DOCK_STORAGE_KEY, v).catch(() => { /* non-critical UI preference */ });
  },
  /**
   * design-a: apply the route-level default for the focused route (call on focus and on every phase
   * change). Docks on Portfolio / Cases / Payouts / TA-INF and floats again on leaving them — without
   * touching the stored preference. Returns what it did so the overlay can reset its orb.
   */
  applyRouteDefault(route: string | undefined): 'dock' | 'float' | null {
    if (route !== routeDock.visitRoute) {
      // A new visit: a "stay undocked" override only lasts for the visit it was made in.
      routeDock.visitRoute = route;
      if (routeDock.undockedVisit !== route) routeDock.undockedVisit = null;
    }
    const d = routeDockDecision({ route, phase: snap.phase, ...routeDock });
    if (d === 'dock') { routeDock.routeDocked = true; emit({ phase: 'docked' }); }
    else if (d === 'float') { routeDock.routeDocked = false; emit({ phase: 'floating' }); }
    return d;
  },
  /** The dealer undocked Zippy on `route`: keep it floating there for the rest of this visit. */
  noteUndock(route: string | undefined) {
    routeDock.routeDocked = false;
    routeDock.undockedVisit = route ?? null;
  },
  /**
   * Docked face long-pressed / dragged out of the header (or "Show on screen" in the sheet) → the
   * overlay flies the orb back out. `at` (window coords) = where it was dragged to.
   */
  requestUndock(at?: WindowPoint) { if (snap.phase === 'docked') emit({ phase: 'undocking', undockAt: at ?? null }); },
  /** Consume the drag-out point (once). */
  takeUndockAt(): WindowPoint | null { const p = snap.undockAt; if (p) emit({ undockAt: null }); return p; },
  /** "Drop to dock" highlight on the focused header slot while a floating Zippy is dragged over it. */
  setDropHint(on: boolean) { if (snap.dropHint !== on) emit({ dropHint: on }); },
  snapshotDropHint() { return snap.dropHint; },
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
