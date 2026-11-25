import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { navRef } from '../navigation/navRef';
import { secureStorage } from '../utils/secureStorage';
import { ttffLine } from './feed';
import { getTutorial, isComingSoon } from './manifest';
import { screenToShort } from './shortMap';
import { type NudgeTrigger, StuckDetector } from './stuckDetector';

/**
 * Tutorial state shared by the Help screen, the full-screen player host, Zippy's nudge bubble and
 * Profile's toggle (v1.3.0). Tiny external store (no provider). Persisted in secure storage
 * (localStorage on web):
 *  - watched shorts           firstgo.tutorial.watched.v130   (JSON string[])
 *  - introduced screens       firstgo.tutorial.visited.v130   (first-visit offer already made)
 *  - "don't show again here"  firstgo.tutorial.dontshow.v130
 *  - nudges toggle            firstgo.tutorial.nudges.v130    ('on' | 'off'; missing = on)
 *  - feed swipe hint seen     firstgo.tutorial.feedhint.v130  ('1')
 */
const K_WATCHED = 'firstgo.tutorial.watched.v130';
const K_VISITED = 'firstgo.tutorial.visited.v130';
const K_DONTSHOW = 'firstgo.tutorial.dontshow.v130';
const K_NUDGES = 'firstgo.tutorial.nudges.v130';
const K_FEEDHINT = 'firstgo.tutorial.feedhint.v130';

export type TutorialSnapshot = {
  hydrated: boolean;
  watched: ReadonlySet<string>;
  nudgesEnabled: boolean;
  /** Zippy's "drop a short" bubble, when one is up. */
  nudge: (NudgeTrigger & { id: number }) | null;
  /** Shorts feed sound, for this session only (starts unmuted: the feed always opens from a tap). */
  feedMuted: boolean;
  /** The feed's "Swipe up for the next how-to" hint was shown once already (persisted). */
  feedHintSeen: boolean;
};

let snap: TutorialSnapshot = { hydrated: false, watched: new Set(), nudgesEnabled: true, nudge: null, feedMuted: false, feedHintSeen: false };
const listeners = new Set<() => void>();
const emit = (next: Partial<TutorialSnapshot>) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export function useTutorialState(): TutorialSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

let visited = new Set<string>();
let dontShow = new Set<string>();

const saveSet = (key: string, s: ReadonlySet<string>) => { secureStorage.set(key, JSON.stringify([...s])).catch(() => { /* non-critical */ }); };
const loadSet = async (key: string): Promise<Set<string>> => {
  try {
    const raw = await secureStorage.get(key);
    const v = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
};

export const detector = new StuckDetector({
  // Only shorts that can stream: a coming-soon short is never offered (and its screen stays
  // un-introduced, so the first-visit offer comes once the video exists).
  shortFor: (screen) => { const id = screenToShort(screen); return id && !isComingSoon(getTutorial(id)) ? id : null; },
  onIntroduced: (screen) => { visited.add(screen); saveSet(K_VISITED, visited); },
});
// Off until the persisted sets are loaded (hydrate), so a first-visit offer never uses stale data.
detector.setEnabled(false);

/** Web screenshots only: `?nudge=1` pops the bubble for the current screen right away. */
export function webForcedNudge(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get('nudge') === '1';
  } catch { return false; }
}

let nudgeSeq = 0;
let hydrating = false;

export const tutorials = {
  get state() { return snap; },

  /** Load the persisted sets once per launch. Nudges stay off until this finishes. */
  async hydrate() {
    if (snap.hydrated || hydrating) return;
    hydrating = true;
    const [w, v, d, n, h] = await Promise.all([loadSet(K_WATCHED), loadSet(K_VISITED), loadSet(K_DONTSHOW), secureStorage.get(K_NUDGES).catch(() => null), secureStorage.get(K_FEEDHINT).catch(() => null)]);
    visited = v; dontShow = d;
    const enabled = n !== 'off';
    detector.setWatched(w); detector.setIntroduced(v); detector.setDontShow(d); detector.setEnabled(enabled);
    emit({ hydrated: true, watched: w, nudgesEnabled: enabled, feedHintSeen: h === '1' });
    // Re-enter the screen we are on, so its first-visit offer is scheduled with the loaded data.
    const cur = detector.currentScreen;
    if (cur) detector.navigate(cur, Date.now());
  },

  markWatched(id: string) {
    if (snap.watched.has(id)) return;
    const w = new Set(snap.watched); w.add(id);
    detector.addWatched(id);
    saveSet(K_WATCHED, w);
    emit({ watched: w });
  },

  setNudgesEnabled(on: boolean) {
    detector.setEnabled(on);
    secureStorage.set(K_NUDGES, on ? 'on' : 'off').catch(() => {});
    emit({ nudgesEnabled: on, ...(on ? {} : { nudge: null }) });
  },

  // ---- Shorts feed ----
  /**
   * Open the Reels-style feed at `startId` (Help, Zippy's sheet, a nudge's Watch). Records the tap time
   * for the time-to-first-frame measurement.
   */
  openShorts(startId: string) {
    markPlayIntent(startId);
    tutorials.dismissNudge();
    if (navRef.isReady()) navRef.navigate('ShortsFeed', { startId });
  },
  setFeedMuted(m: boolean) { if (snap.feedMuted !== m) emit({ feedMuted: m }); },
  markFeedHintSeen() {
    if (snap.feedHintSeen) return;
    secureStorage.set(K_FEEDHINT, '1').catch(() => {});
    emit({ feedHintSeen: true });
  },

  // ---- Nudge bubble ----
  showNudge(t: NudgeTrigger | null) {
    if (!t) return;
    detector.suppress('bubble', true, t.at);
    emit({ nudge: { ...t, id: ++nudgeSeq } });
  },
  /** "Not now", route change, or the bubble's player expanded to full screen. */
  dismissNudge() {
    if (!snap.nudge) return;
    detector.suppress('bubble', false, Date.now());
    emit({ nudge: null });
  },
  /** "Don't show again here": persist for the nudge's screen, then dismiss. */
  dontShowAgain(screen: string) {
    dontShow.add(screen);
    detector.addDontShow(screen);
    saveSet(K_DONTSHOW, dontShow);
    tutorials.dismissNudge();
  },
};

// ---- Global reporters (safe to call from anywhere) ----

/** Any touch / keystroke / scroll: restarts the idle clock. */
export function reportActivity() { detector.activity(Date.now()); }

/**
 * A validation error the dealer hit (invalid mobile, wrong OTP, EMI above the cap, failed upload…).
 * Two on the same screen within a minute → Zippy offers that screen's short.
 */
export function reportValidationError(screen?: string) {
  tutorials.showNudge(detector.validationError(Date.now(), screen));
}

/** Something that must not be interrupted is open (sheet, modal, player, voice, Undo toast). */
export function setNudgeSuppressed(key: string, on: boolean) {
  detector.suppress(key, on, Date.now());
}

// ---- Time to first frame (dev measurement; no PII: short id, source kind, ms) ----

const intents = new Map<string, number>();
export type TtffSample = { id: string; kind: string; ms: number };
const ttffSamples: TtffSample[] = [];
const ttffListeners = new Set<() => void>();

/** A tap that should start `id` (feed open, swipe onto it). */
export function markPlayIntent(id: string, at = Date.now()) { intents.set(id, at); }

/**
 * First frame of `id` rendered. Logs "[tutorial] ttff <id> <hls|mp4> <ms> ms" in dev, keeps the last
 * samples for the dev overlay, and on web also pushes to `window.__tutorialTTFF` (Playwright reads it).
 */
export function reportFirstFrame(id: string, kind: string, at = Date.now()) {
  const t0 = intents.get(id);
  if (t0 === undefined) return;
  intents.delete(id);
  const sample = { id, kind, ms: at - t0 };
  ttffSamples.push(sample); if (ttffSamples.length > 20) ttffSamples.shift();
  if (__DEV__) console.log(ttffLine(id, kind, sample.ms));
  if (Platform.OS === 'web') {
    const g = globalThis as { __tutorialTTFF?: TtffSample[] };
    (g.__tutorialTTFF ??= []).push(sample);
  }
  ttffListeners.forEach((l) => l());
}

export function useLastTtff(): TtffSample | null {
  return useSyncExternalStore(
    (l) => { ttffListeners.add(l); return () => { ttffListeners.delete(l); }; },
    () => ttffSamples[ttffSamples.length - 1] ?? null,
    () => ttffSamples[ttffSamples.length - 1] ?? null,
  );
}

/** Web screenshots only: `?feedhint=1` forces the feed's swipe hint. */
export function webForcedFeedHint(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get('feedhint') === '1';
  } catch { return false; }
}
