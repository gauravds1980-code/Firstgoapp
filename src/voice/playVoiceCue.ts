/**
 * Plays the short non-verbal cues (voiceCues.ts) with expo-audio. Players are created once and reused so a cue
 * starts at once; they are separate from piper.ts's player and never mark Zippy as "reading out", so the mic
 * stays free. Never calls /tts or /tts/done. piper.stopSpeaking() calls stopVoiceCue() (barge-in).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { haptic } from '../utils/haptics';
import type { VoiceCueKind } from './voiceCues';

const SOURCES: Record<VoiceCueKind, number> = {
  accepted: require('../../assets/voice-cues/accepted.wav'),
  notUnderstood: require('../../assets/voice-cues/not-understood.wav'),
  // Third, distinct sound on purpose: "accepted" would suggest the action already ran and "not understood"
  // would feel like a failure. A soft mid pulse says "Zippy has a guess — look at the screen and confirm".
  confirm: require('../../assets/voice-cues/confirm.wav'),
};

const players: Partial<Record<VoiceCueKind, AudioPlayer>> = {};
let playing: AudioPlayer | null = null;
let gen = 0;

function playerFor(kind: VoiceCueKind): AudioPlayer | null {
  try {
    return (players[kind] ??= createAudioPlayer(SOURCES[kind]));
  } catch {
    return null;
  }
}

/** Create the three players once (VoiceHost mount). Safe to call repeatedly; never throws. */
export function preloadCueSounds(): void {
  (Object.keys(SOURCES) as VoiceCueKind[]).forEach(playerFor);
}

/** Stop a cue that is playing (barge-in). */
export function stopVoiceCue(): void {
  gen += 1;
  const p = playing;
  playing = null;
  if (!p) return;
  try { p.pause(); } catch { /* gone */ }
  p.seekTo(0).catch(() => {});
}

const HAPTIC: Record<VoiceCueKind, () => void> = { accepted: haptic.success, notUnderstood: haptic.warning, confirm: haptic.select };

/**
 * Fire-and-forget. `haptic` (default true) adds the matching buzz; pass false when the call site already fired
 * one. A cue already playing is cut off. `onStart` fires as playback starts (latency metrics).
 */
export function playVoiceCue(kind: VoiceCueKind, opts?: { haptic?: boolean; onStart?: () => void }): void {
  if (opts?.haptic !== false) HAPTIC[kind]();
  stopVoiceCue();
  const mine = gen;
  const p = playerFor(kind);
  if (!p) return;
  const start = () => {
    if (mine !== gen) return;
    try {
      playing = p;
      opts?.onStart?.();
      p.play();
    } catch { playing = null; }
  };
  setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}).then(() => {
    if (mine !== gen) return;
    if (p.currentTime > 0) p.seekTo(0).catch(() => {}).then(start);
    else start();
  });
}
