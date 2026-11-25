import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useEventListener } from 'expo';
import { setVideoCacheSizeAsync, useVideoPlayer, type VideoSource } from 'expo-video';
import { classifyProbe, nextSourceIndex, sourcesFor, type PlannedSource, type ProbeResult, type SourceKind } from './catalog';
import { PROBE_TIMEOUT_MS, VIDEO_CACHE_BYTES } from './config';
import { markTutorialMissing, type TutorialEntry } from './manifest';

/** No first "readyToPlay" within this → treat the source as failed (and fall back / show offline). */
const LOAD_TIMEOUT_MS = 12_000;

let cacheConfigured = false;
/**
 * expo-video's disk cache for played videos (~100 MB). Must run before the first VideoPlayer exists,
 * so RootNavigator calls it at launch. Native only (web uses the browser cache).
 */
export function configureVideoCache() {
  if (cacheConfigured || Platform.OS === 'web') return;
  cacheConfigured = true;
  setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => { /* a player already exists: default size */ });
}

const toSource = (s: PlannedSource): VideoSource => ({ uri: s.uri, useCaching: s.useCaching, contentType: s.kind === 'hls' ? 'hls' : 'progressive' });

/** Small Range request to tell "not a video yet" (the tunnel's HTML) from "offline". */
export async function probeVideo(url: string): Promise<ReturnType<typeof classifyProbe>> {
  if (Platform.OS === 'web') {
    // No CORS headers on the tunnel: a fetch probe can't read it. Trust the browser's online flag.
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    return nav?.onLine === false ? 'offline' : 'missing';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  let r: ProbeResult;
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal });
    r = { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') };
  } catch (e) {
    r = { error: (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
  return classifyProbe(r);
}

export type StreamState = 'loading' | 'ready' | 'failed';

/**
 * One streaming expo-video player for a tutorial. Never plays by itself (callers play / pause), so the
 * same hook is used for the visible feed page and for preloading (created, buffering, paused).
 *  - Native: adaptive HLS first; if it errors or does not load within LOAD_TIMEOUT_MS, swap ONCE to
 *    the faststart MP4. Web: MP4 only.
 *  - When every source fails, a probe decides: offline → "You're offline" with retry; anything else →
 *    "coming soon" (and the short is marked missing for the session).
 */
export function useStreamingPlayer(entry: TutorialEntry, opts: { muted?: boolean; loop?: boolean } = {}) {
  const sources = useMemo(() => sourcesFor(entry.urls, Platform.OS), [entry.urls]);
  const player = useVideoPlayer(toSource(sources[0]!), (p) => {
    p.loop = opts.loop ?? true;
    p.muted = opts.muted ?? false;
    p.timeUpdateEventInterval = 0.25;
    p.keepScreenOnWhilePlaying = true;
  });
  const idx = useRef(0);
  const [kind, setKind] = useState<SourceKind>(sources[0]!.kind);
  const [state, setState] = useState<StreamState>('loading');
  const [failure, setFailure] = useState<'missing' | 'offline' | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const fail = useCallback(() => {
    const next = nextSourceIndex(idx.current, sources.length);
    if (next !== null) {
      idx.current = next;
      setKind(sources[next]!.kind);
      setState('loading');
      player.replaceAsync(toSource(sources[next]!)).catch(() => {});
      return;
    }
    setState('failed');
    void probeVideo(entry.urls.mp4).then((v) => {
      if (!alive.current) return;
      const f = v === 'offline' ? 'offline' : 'missing';
      setFailure(f);
      if (f === 'missing') markTutorialMissing(entry.id);
    });
  }, [entry.id, entry.urls.mp4, player, sources]);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') fail();
    else if (status === 'readyToPlay') setState('ready');
    else if (status === 'loading') setState((s) => (s === 'failed' ? s : 'loading'));
  });

  // A source that never becomes ready (stalled tunnel, captive portal) counts as failed.
  useEffect(() => {
    if (state !== 'loading') return;
    const t = setTimeout(fail, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [state, kind, fail]);

  const retry = useCallback(() => {
    idx.current = 0;
    setKind(sources[0]!.kind);
    setFailure(null);
    setState('loading');
    player.replaceAsync(toSource(sources[0]!)).catch(() => {});
  }, [player, sources]);

  return { player, kind, state, failure, retry };
}

/**
 * Preload only: creates a muted, paused player for `entry` so its first segments are buffered before
 * the dealer taps (Help: the first unwatched short; a Zippy nudge: that screen's short). Released on
 * unmount. Renders nothing. On web there is no <video> element, so nothing is fetched.
 */
export function PreloadTutorial({ entry }: { entry: TutorialEntry }) {
  useStreamingPlayer(entry, { muted: true, loop: false });
  return null;
}
