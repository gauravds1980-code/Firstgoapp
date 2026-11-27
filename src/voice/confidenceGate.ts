/**
 * v1.4.2 confidence gate for the phone-recogniser path. Pure TS (no React Native), unit-tested.
 *
 * Before: the phone's final text acted at once whatever its confidence; Whisper's parallel check could only
 * correct afterwards (Undo / "Did you mean …?"). Now the hook asks `assessDeviceResult` first:
 *   - confident → exactly as before (act now, Whisper checks in the background, reconcile later);
 *   - shaky + an audio copy → don't act yet; wait for Whisper up to WHISPER_WAIT_MS after RELEASE, then
 *     `pickAfterWait` (Whisper if it is sure and disagrees / the phone had nothing, else the phone's reading);
 *   - shaky + no audio (Android < 13, no copy) → the phone's reading, downgraded to a one-tap "Did you mean …?".
 * A downgraded result never auto-acts.
 *
 * With chunked streaming (voice-stream / DA-30), Whisper's result is ready at release, so the shaky path
 * costs ~0 ms instead of up to 600 ms — see earlyWhisper.ts.
 */
import type { CommandResponse } from './types';
import { LOCAL_AUTO, sameTarget } from './intentMatcher';
import { WHISPER_DISAGREE_MIN } from './voiceMode';

/**
 * Known recogniser confidence below this is shaky. Google / Apple finals for clean commands sit at 0.85–0.95;
 * misheard ones drop to 0.3–0.6. 0.6 is also intentMatcher's LOCAL_CONFIRM, so "shaky" means the same
 * number on both sides. The partial-fallback finals (no real final arrived) carry 0.5 → always shaky.
 */
export const SHAKY_CONFIDENCE = 0.6;
/**
 * Unknown confidence (Android reports 0 / -1 for every result): trust the text only when the local matcher is
 * at its own auto bar (LOCAL_AUTO = 0.8) — a near-exact catalogue phrase is unlikely to be a mishearing.
 */
export const UNKNOWN_CONF_MIN_SCORE = LOCAL_AUTO;
/** Unknown confidence: words that kept being rewritten (stability < 0.5) are shaky even with a good match. */
export const STABILITY_MIN = 0.5;
/**
 * Hard cap on the shaky wait, measured from RELEASE (the 'release' metric mark), not from the final. Whisper
 * on the LAN answers a 1–2 s clip in ~250–500 ms after upload; 600 ms keeps release → action under the
 * 700 ms target in the common case. If the final itself arrives after the cap, use whatever is ready now.
 */
export const WHISPER_WAIT_MS = 600;
/** Partials kept per turn (the stability score only looks at the transitions, a handful is plenty). */
export const MAX_PARTIALS = 10;

export { WHISPER_DISAGREE_MIN };

/**
 * Recogniser confidence → (0, 1], or null = unknown.
 * Unknown: undefined / NaN / < 0 (expo-speech-recognition's "missing" is -1), and 0 on every platform —
 * Android reports 0 or -1 for every result, and iOS reports 0 for finals that were never scored (e.g. built
 * from a partial). Keeping 0 = unknown everywhere is simpler than per-platform rules and errs toward the
 * matcher-score / stability checks rather than a fake "certain". `platform` is kept for future tuning.
 */
export function normalizeAsrConfidence(raw: number | null | undefined, _platform?: string): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(1, raw);
}

const words = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);

function lcs(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How settled the words were, 0..1 (1 = every partial grew the same sentence that became the final).
 *   0.5 × share of the final's words already present, in order, in the last ~3 partials (best of them), plus
 *   0.5 × (1 − rewrite rate): a rewrite is a partial whose earlier words (all but its last, still-forming word)
 *        are not the start of the next partial — i.e. the leading words changed.
 * No partials → null: no evidence either way (the caller treats null as neutral, never as shaky on its own).
 */
export function partialStability(partials: readonly string[], final: string): number | null {
  const ps = partials.map(words).filter((p) => p.length);
  if (!ps.length) return null;
  const f = words(final);
  if (!f.length) return 0;
  const coverage = Math.max(...ps.slice(-3).map((p) => lcs(p, f) / f.length));
  let rewrites = 0;
  for (let i = 1; i < ps.length; i++) {
    const head = ps[i - 1].slice(0, -1);
    if (head.some((w, k) => ps[i][k] !== w)) rewrites++;
  }
  const rate = ps.length > 1 ? rewrites / (ps.length - 1) : 0;
  return Math.round((0.5 * coverage + 0.5 * (1 - rate)) * 1000) / 1000;
}

export type ShakyReason = 'empty' | 'garbled' | 'no_match' | 'unsure_match' | 'low_conf' | 'low_match' | 'unstable';

export interface DeviceAssessInput {
  text: string;
  /** Normalised recogniser confidence (normalizeAsrConfidence), null = unknown. */
  confidence: number | null;
  /** The local matcher's reading (localCommand): status / score / confidenceBand. */
  local: { status?: string; score: number; band?: string };
  partials: readonly string[];
  heardSpeech: boolean;
  /** Screen expectation (number / otp …): digit-only text is fine then. */
  expect?: string;
}

/**
 * Is the phone's result too shaky to act on at once? Shaky when:
 *   - empty, or garbled after speech (no letters, or < 2 characters; digits are fine when a number is expected);
 *   - the local matcher said retry ('no_match') or clarify ('unsure_match'). A destructive command (band
 *     'confirm', status ok) is NOT shaky: it always waits for Confirm anyway;
 *   - known confidence < SHAKY_CONFIDENCE;
 *   - unknown confidence AND (matcher score < UNKNOWN_CONF_MIN_SCORE OR stability < STABILITY_MIN).
 * High known confidence with an auto-band match → not shaky.
 */
export function assessDeviceResult(i: DeviceAssessInput): { shaky: boolean; reasons: ShakyReason[]; stability: number | null } {
  const reasons: ShakyReason[] = [];
  const text = i.text.trim();
  const stability = partialStability(i.partials, text);
  if (!text) reasons.push('empty');
  else if (i.heardSpeech && (text.length < 2 || (!/\p{L}/u.test(text) && !(i.expect && /\d/.test(text))))) reasons.push('garbled');
  const status = i.local.status ?? 'ok';
  if (status === 'retry') reasons.push('no_match');
  else if (status === 'clarify' || (status !== 'ok' && i.local.band === 'confirm')) reasons.push('unsure_match');
  if (i.confidence !== null) {
    if (i.confidence < SHAKY_CONFIDENCE) reasons.push('low_conf');
  } else {
    if (i.local.score < UNKNOWN_CONF_MIN_SCORE) reasons.push('low_match');
    if (stability !== null && stability < STABILITY_MIN) reasons.push('unstable');
  }
  return { shaky: reasons.length > 0, reasons, stability };
}

const REASON_TEXT: Record<ShakyReason, string> = {
  empty: 'nothing heard', garbled: 'garbled', no_match: 'no match', unsure_match: 'unsure match', low_conf: 'low conf',
  low_match: 'low match', unstable: 'words kept changing',
};
/** "low match, unknown conf" for the debug line. */
export function describeShaky(reasons: readonly ShakyReason[], confidence: number | null): string {
  const parts = reasons.map((r) => REASON_TEXT[r]);
  if (confidence === null) parts.push('unknown conf');
  return parts.join(', ');
}

const actionable = (c: CommandResponse) => (c.status ?? 'ok') === 'ok' && c.intent !== 'UNKNOWN' && c.action.type !== 'none';
const phraseOf = (c: CommandResponse) => c.matchedPhrase ?? c.intent.toLowerCase().replace(/_/g, ' ');

/**
 * A result that must not auto-act: actionable → status 'clarify' "Did you mean this?" with the command's
 * intent as the single candidate (same shape as localCommand's clarify, so the preview + one-tap work);
 * clarify / retry stay as they are (autoExecute forced off).
 */
export function downgradeCommand(c: CommandResponse): CommandResponse {
  if (!actionable(c)) return { ...c, autoExecute: false, confidenceBand: c.status === 'retry' ? 'retry' : 'clarify' };
  return {
    ...c,
    status: 'clarify',
    intent: 'UNKNOWN',
    action: { type: 'none' },
    autoExecute: false,
    confidenceBand: 'clarify',
    autoReason: 'shaky_device',
    candidates: [{ intent: c.intent, phrase: phraseOf(c), score: c.score }],
    responseText: 'Did you mean this?',
  };
}

export type GatePick = { use: 'whisper' | 'device'; command: CommandResponse; downgraded: boolean };

/**
 * After the shaky wait. Whisper wins when it is actionable with score ≥ WHISPER_DISAGREE_MIN and the phone's
 * result is not actionable or points somewhere else; same target → the phone's result (it carries the phone's
 * text) acts normally. Whisper null / unsure → the phone's result DOWNGRADED (never auto-acts). A phone
 * retry + a Whisper clarify with candidates → Whisper's clarify (something to tap beats "say again").
 */
export function pickAfterWait(device: CommandResponse, whisper: CommandResponse | null): GatePick {
  if (whisper) {
    const sure = actionable(whisper) && whisper.score >= WHISPER_DISAGREE_MIN;
    if (sure) {
      if (!actionable(device) || !sameTarget(device, whisper)) return { use: 'whisper', command: whisper, downgraded: false };
      return { use: 'device', command: device, downgraded: false };
    }
    if (!actionable(device) && whisper.status === 'clarify' && (whisper.candidates?.length ?? 0) > 0) {
      return { use: 'whisper', command: { ...whisper, autoExecute: false }, downgraded: false };
    }
  }
  return { use: 'device', command: downgradeCommand(device), downgraded: true };
}

// ---------------------------------------------------------------------------------------------
// Orchestrator (pure, injectable clock + sleep, measured in tests)
// ---------------------------------------------------------------------------------------------
export type GateDecision = 'confident' | 'whisper' | 'whisper_early' | 'agreed' | 'late' | 'unsure' | 'no_audio';

export interface GateOutcome extends GatePick {
  decision: GateDecision;
  /** ms the gate waited (now at resolution − now at start). */
  waitedMs: number;
  /** The Whisper result the gate used, if any (null when it timed out / failed). */
  whisper: CommandResponse | null;
}

export interface GateInput {
  shaky: boolean;
  wantCheck: boolean;
  device: CommandResponse;
  /** Release time on the same clock as `now` (the 'release' metric mark). */
  releasedAt: number;
  now: () => number;
  /** The WAV check (resolves with Whisper's result, or null when it failed). */
  whisper?: Promise<CommandResponse | null> | null;
  /** Streaming / early source (earlyWhisper.ts). */
  early?: Promise<CommandResponse | null> | null;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Confident → the device result, no wait. Shaky → race the early (streaming) and WAV Whisper sources against
 * the cap (releasedAt + waitMs); the first non-null result wins; all null → stop waiting at once.
 * A final that arrives after the cap still takes whatever is already settled (one macrotask, no real wait).
 */
export async function runGate(i: GateInput): Promise<GateOutcome> {
  const start = i.now();
  const done = (pick: GatePick, decision: GateDecision, whisper: CommandResponse | null): GateOutcome => ({
    ...pick, decision, whisper, waitedMs: Math.max(0, Math.round(i.now() - start)),
  });
  if (!i.shaky) return done({ use: 'device', command: i.device, downgraded: false }, 'confident', null);
  const sources: { p: Promise<CommandResponse | null>; early: boolean }[] = [];
  if (i.early) sources.push({ p: i.early, early: true });
  if (i.wantCheck && i.whisper) sources.push({ p: i.whisper, early: false });
  if (!sources.length) return done(pickAfterWait(i.device, null), 'no_audio', null);

  const remaining = Math.max(0, i.releasedAt + (i.waitMs ?? WHISPER_WAIT_MS) - start);
  const winner = await new Promise<{ r: CommandResponse; early: boolean } | null | 'timeout'>((resolve) => {
    let pending = sources.length;
    for (const s of sources) {
      s.p.then((r) => {
        if (r) resolve({ r, early: s.early });
        else if (--pending === 0) resolve(null);
      }, () => { if (--pending === 0) resolve(null); });
    }
    void (i.sleep ?? defaultSleep)(remaining).then(() => resolve('timeout'));
  });
  if (winner === 'timeout') return done(pickAfterWait(i.device, null), 'late', null);
  if (!winner) return done(pickAfterWait(i.device, null), 'unsure', null);
  const pick = pickAfterWait(i.device, winner.r);
  const decision: GateDecision = pick.use === 'whisper' ? (winner.early ? 'whisper_early' : 'whisper') : pick.downgraded ? 'unsure' : 'agreed';
  return done(pick, decision, winner.r);
}

/** Debug-line text for a gate decision, e.g. "shaky (low match, unknown conf) · waited 420 ms · used Whisper". */
export function gateDiagText(o: { decision: GateDecision; waitedMs?: number; reasons?: readonly ShakyReason[]; confidence?: number | null; retryText?: boolean }): string {
  if (o.decision === 'confident') return 'confident · acted';
  const head = `shaky (${describeShaky(o.reasons ?? [], o.confidence ?? null)})`;
  const asked = o.retryText ? 'server text' : 'asked';
  if (o.decision === 'no_audio') return `${head} · no audio, ${asked}`;
  const waited = `waited ${o.waitedMs ?? 0} ms`;
  switch (o.decision) {
    case 'whisper': return `${head} · ${waited} · used Whisper`;
    case 'whisper_early': return `${head} · ${waited} · used Whisper (stream)`;
    case 'agreed': return `${head} · ${waited} · Whisper agreed`;
    case 'late': return `${head} · ${waited} · Whisper late, ${asked}`;
    default: return `${head} · ${waited} · Whisper unsure, ${asked}`;
  }
}
