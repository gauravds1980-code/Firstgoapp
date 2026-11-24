/**
 * Spoken replies go through Piper on the local voice pipeline (POST /tts), never Google TTS
 * and never expo-speech. The same STT_BASE_URL that serves /command also serves /tts.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { STT_TIMEOUT_MS, isVoiceConfigured, ttsUrl } from './config';

interface TtsResponse {
  audioBase64?: string;
  audioUrl?: string;
  audioDurationSec?: number;
}

let player: AudioPlayer | null = null;
let sub: { remove(): void } | null = null;
let doneTimer: ReturnType<typeof setTimeout> | null = null;

function clearPlayer() {
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
  try { sub?.remove(); } catch { /* already gone */ }
  sub = null;
  try { player?.pause(); } catch { /* already gone */ }
  try { player?.remove(); } catch { /* already gone */ }
  player = null;
}

export async function stopSpeaking() {
  clearPlayer();
}

async function fetchPiperWav(text: string): Promise<string> {
  if (!isVoiceConfigured()) throw new Error('voice not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  try {
    const res = await fetch(ttsUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null) as TtsResponse | null;
    if (!res.ok || !body?.audioBase64) throw new Error(`Piper /tts failed (${res.status})`);
    return body.audioBase64;
  } finally {
    clearTimeout(timer);
  }
}

async function playWavBase64(audioBase64: string, durationSec: number | undefined, cb?: { onStart?: () => void; onDone?: () => void }) {
  const file = new File(Paths.cache, 'zippy-piper.wav');
  if (file.exists) file.delete();
  file.create();
  await file.write(audioBase64, { encoding: 'base64' });
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  const next = createAudioPlayer(file.uri);
  player = next;
  const finish = () => {
    if (player !== next) return;
    clearPlayer();
    cb?.onDone?.();
  };
  sub = next.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    if (status.didJustFinish) finish();
  });
  const waitMs = Math.max(2, (durationSec ?? 4) + 1) * 1000;
  doneTimer = setTimeout(finish, waitMs);
  cb?.onStart?.();
  next.play();
}

/**
 * Speak `text` with Piper. If `precomputed.audioBase64` is already a Piper WAV for this text
 * (for example a /command response), it is played and /tts is not called again.
 */
export async function speak(
  text: string,
  cb?: { onStart?: () => void; onDone?: () => void },
  precomputed?: { audioBase64?: string; audioDurationSec?: number },
) {
  const trimmed = text.trim();
  if (!trimmed) { cb?.onDone?.(); return; }
  await stopSpeaking();
  try {
    const audioBase64 = precomputed?.audioBase64 || await fetchPiperWav(trimmed);
    await playWavBase64(audioBase64, precomputed?.audioDurationSec, cb);
  } catch {
    cb?.onDone?.();
  }
}
