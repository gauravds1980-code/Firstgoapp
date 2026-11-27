/**
 * Early-Whisper hook for the confidence gate (v1.4.2). Pure TS, no React Native.
 *
 * With chunked streaming (voice-stream / DA-30), Whisper's result is ready at release, so the shaky path
 * costs ~0 ms instead of up to 600 ms; register the streaming client's result here. The gate
 * (confidenceGate.runGate, called from useVoiceCommand.onDeviceFinal) races this promise with the WAV check;
 * the first usable (non-null) result wins. useVoiceCommand registers a TurnStreams source (parallelWhisper.ts)
 * on mount and clears it on unmount: the device-path parallel stream (voice.parallelStream) and the server path.
 */
import type { CommandContext, CommandResponse } from './types';

export type EarlyWhisperTurn = { id: number; ctx: CommandContext; releasedAt: number };
export type EarlyWhisperSource = (turn: EarlyWhisperTurn) => Promise<CommandResponse | null> | null;

let source: EarlyWhisperSource | null = null;

/** Register (or clear with null) the streaming client's per-turn result. */
export function setEarlyWhisperSource(fn: EarlyWhisperSource | null): void { source = fn; }

/** Clear only if `fn` is still the registered source (an unmount must not drop a newer registration). */
export function clearEarlyWhisperSource(fn: EarlyWhisperSource): void { if (source === fn) source = null; }

/** The registered source's promise for this turn, or null (no source / it has nothing for the turn / it threw). */
export function getEarlyWhisper(turn: EarlyWhisperTurn): Promise<CommandResponse | null> | null {
  if (!source) return null;
  try {
    const p = source(turn);
    return p ? p.catch(() => null) : null;
  } catch {
    return null;
  }
}
