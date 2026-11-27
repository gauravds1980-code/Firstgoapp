/**
 * v1.4.2 "parallel Whisper stream" + the early-Whisper source. Pure TS (no React Native), unit-tested in Node.
 *
 * On the phone-recogniser (device) path the confidence gate waits up to 600 ms after release for Whisper when
 * the phone's result is shaky. With `voice.parallelStream` on, useVoiceCommand also captures PCM (usePcmStream)
 * while expo-speech-recognition listens, streams it to the voice server, and calls finish() at release, so
 * Whisper's answer is ready at about release time. TurnStreams keeps that /end promise per turn id and is the
 * source registered with earlyWhisper.ts (the server path registers its stream there too, for consistency).
 *
 * Default OFF: since Android 10 the mic normally goes to one capture client at a time (SpeechRecognizer runs in
 * another process, so one side may get silence), and on iOS the two may clash on AVAudioSession/AVAudioEngine.
 * Failure is detected safely and turns the feature off for this app session (like the persist auto-off):
 *  - the stream's audio was silence for the whole turn (peak RMS below PARALLEL_SILENT_DB, or no buffers), or
 *  - the phone recogniser failed with an audio / busy / client error soon after the PCM capture started, or
 *  - the PCM capture itself could not start.
 * The gate then gets null (and still races the persisted-WAV check, which is unchanged). Never holds transcripts.
 */
import { clearEarlyWhisperSource, setEarlyWhisperSource, type EarlyWhisperSource } from './earlyWhisper';
import type { CommandExtras } from './sttClient';
import type { CommandContext, CommandResponse } from './types';

/** Peak buffer RMS (dBFS) at or below this for the whole turn = the stream got no real mic audio. Room noise is ~-55…-45. */
export const PARALLEL_SILENT_DB = -60;
/** A recogniser audio/busy/client error this soon after the PCM capture started is blamed on the parallel capture. */
export const PARALLEL_ERROR_WINDOW_MS = 2500;
const CONTENTION_CODES = new Set(['audio-capture', 'busy', 'client', 'interrupted']);

export type ParallelOffReason = 'silent' | 'recogniser_error' | 'capture_failed';
const WHY: Record<ParallelOffReason, string> = { silent: 'silent', recogniser_error: 'mic clash', capture_failed: 'mic busy' };
/** Debug-line text: 'on' this turn, turned 'off' this turn (with why), or 'paused' (turned off earlier this session). */
export function parallelDiagText(s: 'on' | 'paused' | ParallelOffReason): string {
  if (s === 'on') return 'parallel stream';
  if (s === 'paused') return `parallel stream paused (${pausedBy ? WHY[pausedBy] : 'off'})`;
  return `parallel stream off (${WHY[s]})`;
}

// ---- session auto-off (module state, like deviceAsr's persistBroken) ----
let pausedBy: ParallelOffReason | null = null;
export function markParallelBroken(r: ParallelOffReason): void { if (!pausedBy) pausedBy = r; }
export const isParallelBroken = (): boolean => pausedBy !== null;
/** Test helper. */
export function resetParallelBroken(): void { pausedBy = null; }

/** Start the parallel stream on this turn? Device path, setting on, not OTP, PCM capture available, not paused. */
export function wantParallelStream(o: { path: 'device' | 'server'; settingOn: boolean; otp: boolean; pcmAvailable: boolean }): boolean {
  return o.path === 'device' && o.settingOn && !o.otp && o.pcmAvailable && !pausedBy;
}

/** A recogniser error that points at mic contention with the parallel capture. */
export function isParallelClash(code: string | undefined, msSinceCaptureStart: number): boolean {
  return !!code && CONTENTION_CODES.has(code) && msSinceCaptureStart >= 0 && msSinceCaptureStart <= PARALLEL_ERROR_WINDOW_MS;
}

export const isSilentCapture = (peakDb: number, buffers: number): boolean => buffers === 0 || peakDb <= PARALLEL_SILENT_DB;

/** finish() extras: skipTts plus optional turn metadata (voiceTurnLogApp.turnExtras). */
export type ParallelExtras = CommandExtras;

/** What usePcmStream.stop() gives back (structural, so this file stays RN-free). */
export type ParallelCapture =
  | { kind: 'stream'; peakDb: number; buffers: number; finish: (ctx: CommandContext, extras?: ParallelExtras) => Promise<CommandResponse>; cancel: () => void }
  | { kind: 'too_short' | 'permission_prompted' | 'fallback' };

/**
 * Release of a parallel stream: silence → cancel, auto-off, null; otherwise finish() → Whisper's CommandResponse
 * (null when it failed or heard nothing). Never throws. `onOff` writes the debug line (no transcript).
 */
export async function settleParallel(
  capture: Promise<ParallelCapture | null>, ctx: CommandContext, onOff: (r: ParallelOffReason) => void, extras: ParallelExtras = { skipTts: true },
): Promise<CommandResponse | null> {
  let c: ParallelCapture | null;
  try { c = await capture; } catch { return null; }
  if (!c) return null;
  if (c.kind === 'fallback') { markParallelBroken('capture_failed'); onOff('capture_failed'); return null; }
  if (c.kind !== 'stream') return null;
  if (isSilentCapture(c.peakDb, c.buffers)) { c.cancel(); markParallelBroken('silent'); onOff('silent'); return null; }
  try {
    const r = await c.finish(ctx, extras);
    return r.transcript.trim() ? r : null;
  } catch {
    return null;
  }
}

/**
 * Per-turn stream results for the early-Whisper hook. Only the latest turn is kept (a new turn drops the old
 * one). `source` is what useVoiceCommand registers with setEarlyWhisperSource on mount.
 */
export class TurnStreams {
  private m = new Map<number, Promise<CommandResponse | null>>();
  set(id: number, p: Promise<CommandResponse | null>): void {
    this.m.clear();
    this.m.set(id, p.catch(() => null));
  }
  drop(id: number): void { this.m.delete(id); }
  clear(): void { this.m.clear(); }
  has(id: number): boolean { return this.m.has(id); }
  readonly source: EarlyWhisperSource = (turn) => this.m.get(turn.id) ?? null;
}

/** Mount: register `streams` as the early-Whisper source. Returns the unmount cleanup (clears it, drops results). */
export function registerTurnStreams(streams: TurnStreams): () => void {
  setEarlyWhisperSource(streams.source);
  return () => { clearEarlyWhisperSource(streams.source); streams.clear(); };
}

/**
 * ONE Whisper second check per turn, from whichever source answers first: the streamed /end (read through
 * earlyWhisper.getEarlyWhisper, so it is the same answer the confidence gate sees) or the persisted-WAV upload.
 * `deliver` is useVoiceCommand.onCheck: it hands the answer to a waiting gate, or reconciles it with the phone's
 * result and, for a Whisper correction, re-publishes `live` with source 'server' (that is what the pill and the
 * transcript sheet show). The second answer is dropped, so the sheet never gets a duplicate correction and the
 * dealer never gets two "Did you mean"s / Undo offers.
 *  - A stream answer that lands before the turn is handled (the phone's final not in yet) is held until `ready()`.
 *  - `settle()`: the gate already used a Whisper answer (either source); later answers are dropped.
 *  - `needWav`: false once settled, so the WAV upload is skipped when the stream already answered.
 * Null / empty stream answers are ignored (the WAV check still runs). Pure, unit-tested.
 */
export class TurnCheck {
  private settled = false;
  private handled = false;
  private held: CommandResponse | null = null;
  constructor(private readonly deliver: (r: CommandResponse, from: 'stream' | 'wav') => void) {}
  get needWav(): boolean { return !this.settled; }
  get done(): boolean { return this.settled; }
  /** The turn's stream /end answer (null = nothing usable). */
  stream(r: CommandResponse | null): void {
    if (!r || !r.transcript.trim() || this.settled) return;
    if (this.handled) this.fire(r, 'stream'); else this.held = r;
  }
  /** The persisted-WAV check's answer. */
  wav(r: CommandResponse): void { this.fire(r, 'wav'); }
  /** The turn is handled (the phone's final was delivered or is held by the gate): release a held stream answer. */
  ready(): void {
    this.handled = true;
    const r = this.held;
    this.held = null;
    if (r) this.fire(r, 'stream');
  }
  settle(): void { this.settled = true; this.held = null; }
  private fire(r: CommandResponse, from: 'stream' | 'wav'): void {
    if (this.settled) return;
    this.settled = true;
    this.deliver(r, from);
  }
}
