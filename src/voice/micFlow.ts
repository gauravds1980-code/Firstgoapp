/**
 * v1.4.5 pure decisions behind the mic disc, the "Listening…" bubble and the turn lifecycle (no React Native
 * imports; unit-tested in Node). See bubble-fix-notes/STATUS.md for the v1.4.4 RCA.
 *
 *  - ONE source of truth for "recording": the session phase (`listening`). VoiceHost derives `micView()` once and
 *    hands the same `live` flag and the same elapsed timer to both the disc (VoiceMic) and the bubble, so the two
 *    can never disagree. A finger on the disc alone never paints "recording".
 *  - The recogniser ending by itself while the finger is still down is restarted once, transparently; after that
 *    the dealer gets a clear message instead of a silent recording disc.
 *  - Pressing while Zippy (Piper) reads out stops the read-out and listens (never a recording state that is not
 *    listening).
 */
import type { VoiceUiPhase } from './types';
import type { TalkMode } from './voiceMode';

/** Shown when the recogniser gave up while the finger was still on the mic. */
export const DIDNT_CATCH = 'Didn’t catch that — hold and speak again';

export type MicView = { live: boolean; checking: boolean; label: 'idle' | 'listening' | 'thinking' };

/** The disc and the bubble both render from this (same phase in → same `live` out). */
export function micView(phase: VoiceUiPhase): MicView {
  const live = phase === 'listening';
  const checking = phase === 'thinking';
  return { live, checking, label: live ? 'listening' : checking ? 'thinking' : 'idle' };
}

/** When the current recording started: kept across a transparent restart (live stays true), cleared when it ends. */
export function nextLiveSince(prev: number | null, live: boolean, now: number): number | null {
  if (!live) return null;
  return prev ?? now;
}

/** m:ss for the recording timer (disc and bubble). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type BubbleInput = {
  phase: VoiceUiPhase;
  mode: TalkMode;
  /** Heard words, already OTP-masked. */
  heard: string;
  /** The current live text is final (turn released). */
  final: boolean;
  checkingLive: boolean;
  elapsedMs: number;
};

export type Bubble = { text: string; listening: boolean; interim: boolean; solid: boolean; checking: boolean; timer: string | null } | null;

/** What the bubble above the mic shows. `listening` ⇔ the disc shows recording (same micView). */
export function bubbleFor(i: BubbleInput): Bubble {
  const v = micView(i.phase);
  if (v.live) {
    return {
      text: i.heard || (i.mode === 'handsfree' ? 'Listening… tap to cancel' : 'Listening… let go to send'),
      listening: true, interim: !!i.heard, solid: false, checking: false, timer: clock(i.elapsedMs),
    };
  }
  const checking = v.checking || i.checkingLive;
  if (i.final) return { text: i.heard ? `“${i.heard}”` : 'Got it — checking…', listening: false, interim: false, solid: !!i.heard, checking, timer: null };
  if (v.checking) return { text: 'Got it — checking…', listening: false, interim: false, solid: false, checking, timer: null };
  return null;
}

/**
 * The recogniser ended (or reported no-speech) before the turn was handled.
 *  - released (push-to-talk let go, or the 15 s cap): 'ignore' — the release path's final / grace timer decides.
 *  - finger still down, no restart yet: 'restart' (once, transparently; partial text kept).
 *  - partial text already heard: 'finalize' with it.
 *  - otherwise: 'give_up' with DIDNT_CATCH (push-to-talk) / no speech (hands-free).
 */
export type SelfEndAction = 'ignore' | 'restart' | 'finalize' | 'give_up';
export const MAX_ASR_RESTARTS = 1;

export function selfEndAction(t: { mode: TalkMode; released: boolean; handled: boolean; restarts: number; partial: string }): SelfEndAction {
  if (t.handled || t.released) return 'ignore';
  if (t.partial.trim()) return 'finalize';
  if (t.mode === 'ptt' && t.restarts < MAX_ASR_RESTARTS) return 'restart';
  return 'give_up';
}

/** Press-in while something is playing: a Piper read-out is cut off and the mic listens (barge-in). */
export function pressAction(s: { readingOut: boolean }): 'stop_readout_then_listen' | 'listen' {
  return s.readingOut ? 'stop_readout_then_listen' : 'listen';
}

/**
 * A new turn starts while the previous one is still open: how to log the previous one (null = nothing to log:
 * it already ended / was handled). Only a turn the dealer really abandoned mid-recording is "cancelled"; a turn
 * whose recogniser already ended without a result is `asr_ended`, one waiting for its final after release is
 * `superseded` — so the v1.4.4 late-'end' race never shows up as a stream of "cancelled" lines.
 */
export function prevTurnEndReason(p: { handled: boolean; released: boolean; asrEnded: boolean }): string | null {
  if (p.handled) return null;
  if (p.asrEnded) return 'asr_ended';
  if (p.released) return 'superseded';
  return 'cancelled';
}
