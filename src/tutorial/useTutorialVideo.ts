import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useEventListener } from 'expo';
import { setVideoCacheSizeAsync, useVideoPlayer, type VideoSource } from 'expo-video';
import { bundledVideoFor } from './bundledAssets';
import { classifyProbe, failureFromProbe, nextSourceIndex, sourcesFor, type PlannedSource, type PlaybackFailure, type ProbeResult, type SourceKind } from './catalog';
import { PROBE_TIMEOUT_MS, VIDEO_CACHE_BYTES } from './config';
import type { TutorialEntry } from './manifest';

/** No first "readyToPlay" within this → treat the source as failed (fall back; at the end: Retry). */
const LOAD_TIMEOUT_MS = 12_000;

let cacheConfigured = false;
/**
 * expo-video's disk cache for streamed (non-bundled) videos (~100 MB). Must run before the first VideoPlayer exists,
 * so RootNavigator calls it at launch. Native only (web uses the browser cache).
 */
export function configureVideoCache() {
  if (cacheConfigured || Platform.OS === 'web') return;
  cacheConfigured = true;
  setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => { /* a player already exists: default size */ });
}

/** A bundled short is `{ assetId }` only: with a `uri` too, expo-video would ignore the asset id. */
const toSource = (s: PlannedSource): VideoSource =>
  s.kind === 'bundled' ? { assetId: s.assetId } : { uri: s.uri, useCaching: s.useCaching, contentType: s.kind === 'hls' ? 'hls' : 'progressive' };

/**
 * Small Range request after every source failed, to tell "offline" from a load error. Only the wording
 * depends on it: both show Retry, and neither makes the short "coming soon".
 */
export async function probeVideo(url: string): Promise<ReturnType<typeof classifyProbe>> {
  if (Platform.OS === 'web') {
    // A cross-origin probe can't read a host without CORS: trust the browser's online flag, else unknown.
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    return nav?.onLine === false ? 'offline' : 'unknown';
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
 * One expo-video player for a tutorial. Never plays by itself (callers play / pause), so the same hook
 * is used for the visible feed page and for preloading (created, buffering, paused).
 *  - Native: the MP4 bundled in the app first (catalogue shorts), then adaptive HLS, then the remote
 *    faststart MP4; a source that errors or does not load within LOAD_TIMEOUT_MS moves to the next.
 *    Web: the same-origin MP4 only.
 *  - When every source fails, a probe picks the wording: offline → "You're offline", else "Couldn't
 *    load this how-to". Both offer Retry (back to the first source). Never "coming soon": that is
 *    decided by the catalogue alone.
 */
export function useStreamingPlayer(entry: TutorialEntry, opts: { muted?: boolean; loop?: boolean } = {}) {
  const assetId = bundledVideoFor(entry);
  const sources = useMemo(() => sourcesFor(entry.urls, Platform.OS, { assetId }), [entry.urls, assetId]);
  const player = useVideoPlayer(toSource(sources[0]!), (p) => {
    p.loop = opts.loop ?? true;
    p.muted = opts.muted ?? false;
    p.timeUpdateEventInterval = 0.25;
    p.keepScreenOnWhilePlaying = true;
  });
  const idx = useRef(0);
  const [kind, setKind] = useState<SourceKind>(sources[0]!.kind);
  const [state, setState] = useState<StreamState>('loading');
  const [failure, setFailure] = useState<PlaybackFailure | null>(null);
  /** Bumped by retry() so the load timeout re-arms even if state / kind did not change. */
  const [attempt, setAttempt] = useState(0);
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
    void probeVideo(entry.urls.mp4).then(
      (v) => { if (alive.current) setFailure(failureFromProbe(v)); },
      () => { if (alive.current) setFailure('error'); },
    );
  }, [entry.urls.mp4, player, sources]);

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
  }, [state, kind, attempt, fail]);

  /** Clear the failure and start over from the first source (the bundled file when there is one). */
  const retry = useCallback(() => {
    idx.current = 0;
    setKind(sources[0]!.kind);
    setFailure(null);
    setState('loading');
    setAttempt((n) => n + 1);
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
