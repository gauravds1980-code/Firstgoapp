import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { setAudioModeAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { PTT_MAX_HOLD_MS, PTT_MIN_HOLD_MS, STREAM_FAST_FINAL, STREAM_FLUSH_MS, STREAM_MAX_MS, STT_TIMEOUT_MS, streamBaseUrl, voiceRoutes } from './config';
import { classifyHttp } from './voiceRoutes';
import { hasMicPermission, requestMicPermission } from './permissions';
import { rmsDb, StreamSession, toMonoInt16, type FetchLike, type StreamPartial } from './serverStream';
import type { CommandExtras } from './sttClient';
import { VoiceError, type CommandContext, type CommandResponse } from './types';
import { createEndpointer, type EndpointDecision } from './voiceMode';

/**
 * Live mic capture for the server path (v1.4.2): expo-audio's `useAudioStream` (int16 PCM, ~100 ms buffers)
 * feeding a StreamSession, so the voice server decodes while the dealer is still talking.
 *
 * Availability: native only, and only when the installed ExpoAudio native module has the AudioStream class
 * (expo-audio ≥ 58 — already in the shipped APK). On web expo-audio's useAudioStream returns `stream: null`,
 * so web (and any build without the class) reports `available: false` and the caller keeps the recorder path.
 */
const NATIVE_HAS_STREAM = Platform.OS !== 'web' && !!(requireOptionalNativeModule('ExpoAudio') as { AudioStream?: unknown } | null)?.AudioStream;
type StreamHook = typeof useAudioStream;
const useNoStream: StreamHook = () => ({ stream: null as unknown as ReturnType<StreamHook>['stream'], isStreaming: false });
/** Chosen once per bundle, so hooks are always called in the same order. */
const useStreamImpl: StreamHook = NATIVE_HAS_STREAM ? useAudioStream : useNoStream;

export type PcmPhase = 'idle' | 'starting' | 'recording';

export type PcmBeginOptions = {
  ctx: CommandContext;
  languageCode?: string;
  /** v1.4.3: turn metadata (turnId, path, appVersion…) for the /start body (voiceTurnLogApp.turnExtras). */
  extras?: CommandExtras;
  onPartial: (p: StreamPartial) => void;
  /** Hands-free end of turn from the input level ('end' | 'no_speech' | 'max'). Push-to-talk passes nothing. */
  onEndpoint?: (d: Exclude<EndpointDecision, 'listen'>) => void;
  /** start() got 409 (Zippy still speaking). */
  onBusy?: () => void;
  /** The mic stream could not start (mic busy, native error): the caller switches this turn to the recorder. */
  onCaptureFailed: () => void;
  /**
   * Parallel Whisper stream on the phone-recogniser path (parallelWhisper.ts): no /partial long poll (partials
   * are not shown) and the audio session is left to the recogniser (no setAudioModeAsync on start / stop).
   */
  parallel?: boolean;
};

export type PcmResult =
  /** peakDb / buffers: loudest buffer RMS (dBFS) and buffer count of the turn (silence detection for the parallel stream). */
  | { kind: 'stream'; durationMs: number; peakDb: number; buffers: number; finish: (ctx: CommandContext, extras?: CommandExtras) => Promise<CommandResponse>; cancel: () => void }
  | { kind: 'too_short' }
  | { kind: 'permission_prompted' }
  /** Capture never started; the caller already switched this turn to the recorder (onCaptureFailed). */
  | { kind: 'fallback' };

type StartResult = 'recording' | 'prompted' | 'failed' | 'capture_failed';

/**
 * v1.4.5: fetch for one stream session on route `base`. A network error or a tunnel answer (404 / 5xx / HTML page)
 * marks the route down so the NEXT turn uses the next route; this turn keeps its own fallback (one /command with
 * the same audio). Requests the session aborted itself are not counted.
 */
const routedFetch = (base: string): FetchLike => async (url, init) => {
  try {
    const res = await fetch(url, init as RequestInit);
    const kind = classifyHttp(res.status, res.headers?.get('content-type'), null);
    if (kind === 'route') voiceRoutes.markFail(base, { down: true }); else voiceRoutes.markOk(base);
    return res;
  } catch (e) {
    if (!(init as { signal?: AbortSignal }).signal?.aborted) voiceRoutes.markFail(base, { down: true });
    throw e;
  }
};

export function usePcmStream() {
  const session = useRef<StreamSession | null>(null);
  const endpoint = useRef<{ ep: ReturnType<typeof createEndpointer>; fired: boolean; cb: NonNullable<PcmBeginOptions['onEndpoint']> } | null>(null);
  const t0 = useRef(0);
  /** /start waiting for the first buffer's actual rate (only when stream.sampleRate was not readable). */
  const pendingStart = useRef<{ ctx: CommandContext; languageCode?: string; extras?: CommandExtras } | null>(null);
  const level = useRef({ peakDb: -160, buffers: 0 });
  const onBuffer = useCallback((b: AudioStreamBuffer) => {
    const s = session.current;
    if (!s) return;
    const mono = toMonoInt16(b.data, b.channels);
    const ps = pendingStart.current;
    if (ps && !s.sampleRate) {
      pendingStart.current = null;
      void s.start(ps.ctx, { sampleRate: b.sampleRate, ...(ps.languageCode ? { languageCode: ps.languageCode } : {}) }, ps.extras);
    }
    s.push(mono, 1, b.sampleRate);
    const db = rmsDb(mono);
    const lv = level.current;
    lv.buffers += 1;
    if (db > lv.peakDb) lv.peakDb = db;
    const e = endpoint.current;
    if (e && !e.fired) {
      const d = e.ep.push(db, Date.now() - t0.current);
      if (d !== 'listen') { e.fired = true; e.cb(d); }
    }
  }, []);
  const { stream } = useStreamImpl({ sampleRate: 16000, channels: 1, encoding: 'int16', onBuffer });
  const available = NATIVE_HAS_STREAM && !!stream;

  const [phase, setPhase] = useState<PcmPhase>('idle');
  const held = useRef(false);
  const starting = useRef<Promise<StartResult> | null>(null);
  const startError = useRef<unknown>(null);
  const startedAt = useRef(0);
  const capturing = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const onAutoStop = useRef<(() => void) | null>(null);
  /** This capture leaves the audio session alone (parallel stream). */
  const keepMode = useRef(false);
  const set = (p: PcmPhase) => { if (mounted.current) setPhase(p); };

  const stopCapture = useCallback(() => {
    if (maxTimer.current) { clearTimeout(maxTimer.current); maxTimer.current = null; }
    endpoint.current = null;
    if (capturing.current) {
      capturing.current = false;
      try { stream?.stop(); } catch { /* already stopped */ }
      // Back to playback mode so Piper replies play on the loudspeaker (iOS stream uses .record).
      if (!keepMode.current) setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    set('idle');
  }, [stream]);

  useEffect(() => () => { mounted.current = false; session.current?.cancel(); session.current = null; stopCapture(); }, [stopCapture]);

  const start = useCallback(async (o: PcmBeginOptions): Promise<StartResult> => {
    startError.current = null;
    try {
      if (!(await hasMicPermission())) {
        // The OS prompt steals the touch, so this press never records; the next hold will.
        const p = await requestMicPermission();
        if (p !== 'granted') { startError.current = new VoiceError('permission_denied'); return 'failed'; }
        return 'prompted';
      }
    } catch (e) {
      startError.current = new VoiceError('recording', e instanceof Error ? e.message : undefined);
      return 'failed';
    }
    if (!held.current) return 'failed';
    const base = streamBaseUrl();
    const s = new StreamSession({
      fetch: routedFetch(base), baseUrl: base, flushMs: STREAM_FLUSH_MS, maxMs: STREAM_MAX_MS, timeoutMs: STT_TIMEOUT_MS, longPoll: !o.parallel, fastFinal: STREAM_FAST_FINAL,
      onPartial: o.onPartial, onBusy: o.onBusy,
    });
    keepMode.current = !!o.parallel;
    level.current = { peakDb: -160, buffers: 0 };
    try {
      if (!o.parallel) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      session.current = s;
      t0.current = Date.now();
      if (o.onEndpoint) endpoint.current = { ep: createEndpointer({ maxMs: PTT_MAX_HOLD_MS }), fired: false, cb: o.onEndpoint };
      await stream!.start();
      capturing.current = true;
    } catch {
      session.current = null;
      endpoint.current = null;
      s.cancel();
      if (!o.parallel) setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      o.onCaptureFailed();
      return 'capture_failed';
    }
    // stream.sampleRate is the ACTUAL rate after start() (Android may give 48 kHz); the server resamples.
    let rate = 0;
    try { rate = stream!.sampleRate; } catch { rate = 0; }
    const fmt = o.languageCode ? { languageCode: o.languageCode } : {};
    if (rate > 0) void s.start(o.ctx, { sampleRate: rate, ...fmt }, o.extras);
    else pendingStart.current = { ctx: o.ctx, ...fmt, ...(o.extras ? { extras: o.extras } : {}) }; // onBuffer starts it with the first buffer's rate
    startedAt.current = Date.now();
    set('recording');
    maxTimer.current = setTimeout(() => onAutoStop.current?.(), PTT_MAX_HOLD_MS);
    return 'recording';
  }, [stream]);

  /** Start capturing + streaming. Visual state flips at once; permission / start resolve later. */
  const begin = useCallback((o: PcmBeginOptions) => {
    if (starting.current) return;
    held.current = true;
    pendingStart.current = null;
    set('starting');
    const p = start(o);
    starting.current = p;
    p.then((r) => { if (r !== 'recording') set('idle'); });
  }, [start]);

  /** Release: stop the mic and hand back the stream's finish(). Null when nothing was in flight. */
  const stop = useCallback(async (): Promise<PcmResult | null> => {
    held.current = false;
    const p = starting.current;
    if (!p) return null;
    const r = await p;
    starting.current = null;
    if (r === 'prompted') return { kind: 'permission_prompted' };
    if (r === 'capture_failed') return { kind: 'fallback' };
    if (r === 'failed') {
      const err = startError.current;
      if (err) throw err;
      return { kind: 'too_short' };
    }
    const durationMs = Date.now() - startedAt.current;
    stopCapture();
    const s = session.current;
    session.current = null;
    if (!s || durationMs < PTT_MIN_HOLD_MS) { s?.cancel(); return { kind: 'too_short' }; }
    const { peakDb, buffers } = level.current;
    return { kind: 'stream', durationMs, peakDb, buffers, finish: (ctx, extras) => s.finish(ctx, extras), cancel: () => s.cancel() };
  }, [stopCapture]);

  /** Abort without sending. */
  const cancel = useCallback(async () => {
    held.current = false;
    const p = starting.current;
    starting.current = null;
    session.current?.cancel();
    session.current = null;
    if (p) await p;
    (session.current as StreamSession | null)?.cancel(); // a start that finished after the cancel
    session.current = null;
    stopCapture();
  }, [stopCapture]);

  return { available, phase, begin, stop, cancel, onAutoStop };
}
