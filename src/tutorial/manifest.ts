import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { secureStorage } from '../utils/secureStorage';
import { buildCatalog, condenseManifest, parseRemoteManifest, tutorialUrls, type CatalogItem, type RemoteManifest, type TutorialPaths } from './catalog';
import { MANIFEST_TIMEOUT_MS, TUTORIAL_BASE_URL } from './config';
import { SCREEN_SHORT, SHORT_IDS, screenToShort, type ScreenName, type ShortId } from './shortMap';

export { screenToShort, SHORT_IDS, type ShortId };

/**
 * In-app tutorial videos (v1.3.0): URL-based, nothing bundled. Each entry carries absolute URLs for the
 * HLS master playlist (native), the faststart MP4 (fallback + web), the poster, the 360x640 thumbnail
 * and the WebVTT captions. The built-in list (shortMap.ts) is merged with `${base}/manifest.json`,
 * fetched once per launch with a short timeout and cached (memory + secure storage), so durations and
 * new shorts show up without an app update.
 */
export type TutorialEntry = CatalogItem & {
  urls: TutorialPaths;
  /** Route names that offer this short (Zippy's nudges, the sheet's "Watch a how-to"). */
  screens: ScreenName[];
};

const K_MANIFEST = 'firstgo.tutorial.manifest.v130';

const screensFor = (id: string) => (Object.keys(SCREEN_SHORT) as ScreenName[]).filter((s) => SCREEN_SHORT[s] === id);
const toEntries = (items: CatalogItem[]): TutorialEntry[] =>
  items.map((it) => ({ ...it, urls: tutorialUrls(TUTORIAL_BASE_URL, it.id, it.paths), screens: screensFor(it.id) }));

type CatalogSnapshot = {
  entries: TutorialEntry[];
  byId: Readonly<Record<string, TutorialEntry>>;
  /** 'builtin' until manifest.json (or its cached copy) is read. */
  source: 'builtin' | 'cache' | 'remote';
  /** Shorts that failed to stream this session (HTML fallback, 404): shown as coming soon. */
  failed: ReadonlySet<string>;
};

const index = (entries: TutorialEntry[]) => Object.fromEntries(entries.map((e) => [e.id, e]));
const builtinEntries = toEntries(buildCatalog(null));
let snap: CatalogSnapshot = { entries: builtinEntries, byId: index(builtinEntries), source: 'builtin', failed: new Set() };
const listeners = new Set<() => void>();
const emit = (next: Partial<CatalogSnapshot>) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export function useTutorialCatalog(): CatalogSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const apply = (m: RemoteManifest, source: CatalogSnapshot['source']) => {
  const entries = toEntries(buildCatalog(m));
  emit({ entries, byId: index(entries), source });
};

let loading: Promise<void> | null = null;

/**
 * Cached copy first (instant), then the network with MANIFEST_TIMEOUT_MS. Non-JSON answers (the
 * tunnel's HTML for missing files), CORS failures on web and timeouts keep the current list.
 */
export function loadTutorialManifest(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const cached = await secureStorage.get(K_MANIFEST);
      const m = cached ? parseRemoteManifest(cached) : null;
      if (m && snap.source === 'builtin') apply(m, 'cache');
    } catch { /* no cache */ }
    // Web: the tunnel sends no CORS headers, so a cross-origin fetch only logs a browser error. Skip it
    // there (the built-in list is used); same-origin web hosting still reads the manifest.
    if (Platform.OS === 'web') {
      const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
      if (!origin || !TUTORIAL_BASE_URL.startsWith(origin)) return;
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), MANIFEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${TUTORIAL_BASE_URL}/manifest.json`, { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
      const m = res.ok ? parseRemoteManifest(await res.text(), res.headers.get('content-type')) : null;
      if (m) {
        apply(m, 'remote');
        secureStorage.set(K_MANIFEST, condenseManifest(m)).catch(() => { /* non-critical */ });
      }
    } catch { /* offline / timeout / CORS: keep the built-in or cached list */ }
    finally { clearTimeout(timer); }
  })();
  return loading;
}

/** Playback of `id` failed for good (not a video / not found): coming soon for the rest of the session. */
export function markTutorialMissing(id: string) {
  if (snap.failed.has(id)) return;
  const f = new Set(snap.failed); f.add(id);
  emit({ failed: f });
}

/** Coming soon: not available per the catalogue, or failed to stream this session. */
export const isComingSoon = (e: TutorialEntry | undefined, failed: ReadonlySet<string> = snap.failed): boolean =>
  !e || e.availability === 'missing' || failed.has(e.id);

export const getTutorial = (id: string | null | undefined): TutorialEntry | undefined => (id ? snap.byId[id] : undefined);
export const getCatalog = () => snap;

export const isShortId = (v: unknown): v is ShortId => typeof v === 'string' && (SHORT_IDS as readonly string[]).includes(v);

/** The short entry for a route, or null. */
export function tutorialForScreen(screen: string | null | undefined): TutorialEntry | null {
  const id = screenToShort(screen);
  return id ? snap.byId[id] ?? null : null;
}

// Compile-time guard: SCREEN_SHORT must list exactly the navigator's routes (a new route without a
// mapping, or a stale mapping, fails `tsc`).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const routesCovered: Exact<ScreenName, keyof RootStackParamList> = true;
void routesCovered;
