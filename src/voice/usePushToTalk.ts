import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { PTT_MAX_HOLD_MS, PTT_MIN_HOLD_MS } from './config';
import { hasMicPermission, requestMicPermission } from './permissions';
import { VoiceError } from './types';

/** AAC in an .m4a (MPEG-4) container, 16 kHz mono — small uploads, plenty for speech. */
export const PTT_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
};

/** What the proxy is told the audio is. Web records webm/opus (the proxy transcodes with ffmpeg). */
export const PTT_MIME_TYPE = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';

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
  useEffect(() => () => { mounted.current = false; if (maxTimer.current) clearTimeout(maxTimer.current); }, []);
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
    const durationMs = Date.now() - startedAt.current;
    try { await recorder.stop(); } catch { /* already stopped */ }
    resetAudioMode();
    set('idle');
    const uri = recorder.uri;
    if (!uri) {
      if (durationMs < PTT_MIN_HOLD_MS) return { kind: 'too_short' };
      throw new VoiceError('recording', 'No recording file');
    }
    const file = new File(uri);
    try {
      if (durationMs < PTT_MIN_HOLD_MS) return { kind: 'too_short' };
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

  const pressIn = useCallback(() => {
    if (starting.current || phase !== 'idle') return;
    held.current = true;
    set('starting');
    const p = start();
    starting.current = p;
    p.then((r) => {
      if (r !== 'recording') { set('idle'); return; }
      maxTimer.current = setTimeout(() => onAutoStop.current?.(), PTT_MAX_HOLD_MS);
    });
  }, [phase, start]);

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
