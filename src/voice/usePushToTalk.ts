import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { PTT_MAX_HOLD_MS, PTT_MIN_HOLD_MS } from './config';
import { hasMicPermission, requestMicPermission } from './permissions';
import { VoiceError } from './types';
import { createEndpointer, type EndpointDecision } from './voiceMode';

/** AAC in an .m4a (MPEG-4) container, 16 kHz mono — small uploads, plenty for speech. */
export const PTT_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  // v1.4.0: input level for the hands-free end-of-turn fallback (server path only).
  isMeteringEnabled: true,
};

/** What the proxy is told the audio is. Web records webm/opus (the proxy transcodes with ffmpeg). */
export const PTT_MIME_TYPE = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';

/** Web: read a blob: / data: URL into base64 (no expo-file-system on web). */
async function blobUrlToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export type PttPhase = 'idle' | 'starting' | 'recording';

export type PttResult =
  | { kind: 'audio'; base64: string; mimeType: string; durationMs: number }
  | { kind: 'too_short' }
  | { kind: 'permission_prompted' }; // first press showed the OS prompt; dealer holds again to talk

/**
 * Press-and-hold recorder. `pressIn()` starts recording (asking for mic permission on first use);
 * `pressOut()` stops it and resolves with base64 audio, or `too_short` for a tap under 250 ms.
 * Errors are thrown as VoiceError ('permission_denied' | 'recording').
 */
export function usePushToTalk() {
  const recorder = useAudioRecorder(PTT_RECORDING);
  const [phase, setPhase] = useState<PttPhase>('idle');
  const startedAt = useRef(0);
  const held = useRef(false);
  /** Resolves when the in-flight start (permission + prepare + record) settles. */
  const starting = useRef<Promise<'recording' | 'prompted' | 'failed'> | null>(null);
  const startError = useRef<unknown>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /** Hands-free: polls the input level and calls back when the dealer stopped talking. */
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMeter = () => { if (meter.current) { clearInterval(meter.current); meter.current = null; } };
  useEffect(() => () => { mounted.current = false; if (maxTimer.current) clearTimeout(maxTimer.current); stopMeter(); }, []);
  const set = (p: PttPhase) => { if (mounted.current) setPhase(p); };

  const start = useCallback(async (): Promise<'recording' | 'prompted' | 'failed'> => {
    startError.current = null;
    try {
      if (!(await hasMicPermission())) {
        // The OS prompt steals the touch, so this press never records; the next hold will.
        const p = await requestMicPermission();
        if (p !== 'granted') { startError.current = new VoiceError('permission_denied'); return 'failed'; }
        return 'prompted';
      }
      if (!held.current) return 'failed';
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      set('recording');
      return 'recording';
    } catch (e) {
      startError.current = new VoiceError('recording', e instanceof Error ? e.message : undefined);
      return 'failed';
    }
  }, [recorder]);

  const resetAudioMode = () => {
    // Back to playback mode so Piper WAV replies play on the loudspeaker on iOS.
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  };

  /** Stop and read the file. Always deletes the recording (audio is ephemeral). */
  const finish = useCallback(async (): Promise<PttResult> => {
    if (maxTimer.current) { clearTimeout(maxTimer.current); maxTimer.current = null; }
    stopMeter();
    const durationMs = Date.now() - startedAt.current;
    try { await recorder.stop(); } catch { /* already stopped */ }
    resetAudioMode();
    set('idle');
    const uri = recorder.uri;
    if (!uri) {
      if (durationMs < PTT_MIN_HOLD_MS) return { kind: 'too_short' };
      throw new VoiceError('recording', 'No recording file');
    }
    if (durationMs < PTT_MIN_HOLD_MS) return { kind: 'too_short' };
    if (Platform.OS === 'web') {
      // expo-file-system has no web implementation: the web recorder hands back a blob: URL.
      try {
        const base64 = await blobUrlToBase64(uri);
        if (!base64) throw new VoiceError('recording', 'Empty recording');
        return { kind: 'audio', base64, mimeType: PTT_MIME_TYPE, durationMs };
      } catch (e) {
        throw e instanceof VoiceError ? e : new VoiceError('recording', e instanceof Error ? e.message : undefined);
      }
    }
    const file = new File(uri);
    try {
      const base64 = await file.base64();
      if (!base64) throw new VoiceError('recording', 'Empty recording');
      return { kind: 'audio', base64, mimeType: PTT_MIME_TYPE, durationMs };
    } catch (e) {
      throw e instanceof VoiceError ? e : new VoiceError('recording', e instanceof Error ? e.message : undefined);
    } finally {
      try { if (file.exists) file.delete(); } catch { /* best effort */ }
    }
  }, [recorder]);

  /** Resolves (via pressOut) when the hold ends; used by the max-duration timer too. */
  const onAutoStop = useRef<(() => void) | null>(null);

  /**
   * Start recording. `onEndpoint` (hands-free on the server path): called once when the input level says the
   * dealer finished ('end'), never started ('no_speech') or hit the cap ('max'). Push-to-talk passes nothing.
   */
  const pressIn = useCallback((onEndpoint?: (d: Exclude<EndpointDecision, 'listen'>) => void) => {
    if (starting.current) return;
    held.current = true;
    set('starting');
    const p = start();
    starting.current = p;
    p.then((r) => {
      if (r !== 'recording') { set('idle'); return; }
      maxTimer.current = setTimeout(() => onAutoStop.current?.(), PTT_MAX_HOLD_MS);
      if (onEndpoint) {
        const ep = createEndpointer({ maxMs: PTT_MAX_HOLD_MS });
        const t0 = Date.now();
        let fired = false;
        meter.current = setInterval(() => {
          let db: number | undefined;
          try { db = recorder.getStatus().metering; } catch { db = undefined; }
          const d = ep.push(db, Date.now() - t0);
          if (d !== 'listen' && !fired) { fired = true; stopMeter(); onEndpoint(d); }
        }, 100);
      }
    });
  }, [start, recorder]);

  /** Returns null when there was no press in flight (e.g. duplicate release events). */
  const pressOut = useCallback(async (): Promise<PttResult | null> => {
    held.current = false;
    const p = starting.current;
    if (!p) return null;
    const r = await p;
    starting.current = null;
    if (r === 'prompted') return { kind: 'permission_prompted' };
    if (r === 'failed') {
      const err = startError.current;
      if (err) throw err;
      return { kind: 'too_short' }; // released before recording began
    }
    return finish();
  }, [finish]);

  /** Abort without sending. */
  const cancel = useCallback(async () => {
    held.current = false;
    stopMeter();
    const p = starting.current;
    starting.current = null;
    if (!p) return;
    if ((await p) === 'recording') {
      startedAt.current = Date.now(); // force too_short so nothing is read
      try { await finish(); } catch { /* ignore */ }
    }
  }, [finish]);

  return { phase, pressIn, pressOut, cancel, onAutoStop };
}
