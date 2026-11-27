/**
 * v1.4.2 voice diagnostics: what the LAST voice turn did on this phone (which ASR path, why, which
 * recognition service, on-device / audio copy, live partials). Pure TS (no React Native) so it is
 * unit-tested; VoiceHost shows it as one debug line under the live pill when `debugAsr` is on.
 * Never holds transcripts.
 */
import type { AsrPath, AsrServerReason } from './voiceMode';

export interface AsrDiag {
  /** Turn counter (0 = no voice turn yet). */
  turn: number;
  path: AsrPath | null;
  /** Why the server path was used (only when path === 'server'). */
  reason?: AsrServerReason;
  /** 'default' recognition service, or the explicit package used as a fallback. */
  service: string | null;
  onDevice: boolean;
  persist: boolean;
  partials: number;
  /** ms from start() to the first partial. */
  firstPartialMs: number | null;
  lastError: string | null;
  /** v1.4.2 confidence gate: "confident · acted", "shaky (low match, unknown conf) · waited 420 ms · used Whisper"… */
  gate: string | null;
  /** Internal: when start() was called (ms clock of the caller). */
  startedAt: number | null;
}

const EMPTY: AsrDiag = {
  turn: 0, path: null, service: null, onDevice: false, persist: false, partials: 0, firstPartialMs: null, lastError: null, gate: null, startedAt: null,
};

let state: AsrDiag = { ...EMPTY };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getAsrDiag = (): AsrDiag => state;

export function subscribeAsrDiag(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function updateAsrDiag(patch: Partial<AsrDiag>): void {
  state = { ...state, ...patch };
  emit();
}

/** New turn: clear the per-turn fields and record the path decision. */
export function resetAsrTurn(path: AsrPath, reason?: AsrServerReason): void {
  state = { ...EMPTY, turn: state.turn + 1, path, reason: path === 'server' ? reason : undefined };
  emit();
}

/** Recognizer start() was called (device path). */
export function markAsrStarted(o: { service: string; onDevice: boolean; persist: boolean }, at: number): void {
  updateAsrDiag({ ...o, startedAt: at, partials: 0, firstPartialMs: null });
}

/** One interim result arrived. */
export function countAsrPartial(at: number): void {
  const first = state.firstPartialMs === null && state.startedAt !== null ? Math.max(0, Math.round(at - state.startedAt)) : state.firstPartialMs;
  updateAsrDiag({ partials: state.partials + 1, firstPartialMs: first });
}

export function noteAsrError(code: string): void { updateAsrDiag({ lastError: code }); }

/** Test helper / full reset. */
export function clearAsrDiag(): void { state = { ...EMPTY }; emit(); }

const REASON_TEXT: Record<AsrServerReason, string> = {
  flag_off: 'phone recogniser off in settings',
  web: 'web build',
  no_module: 'speech module not in this build',
  no_service: 'no speech service on this phone',
  disabled_after_error: 'phone recogniser paused after errors',
  permission: 'speech permission refused',
};

/** Friendly package names for the debug line. */
export function serviceLabel(service: string | null): string {
  if (!service || service === 'default') return 'default service';
  if (service === 'com.google.android.googlequicksearchbox') return 'Google app';
  if (service === 'com.google.android.as') return 'Android System Intelligence';
  if (service === 'com.google.android.tts') return 'Google speech services';
  return service;
}

/** One-line summary, e.g. "Phone recogniser · Google app · network · audio copy on · 4 partials · first 620 ms". */
export function asrDiagLine(d: AsrDiag): string | null {
  if (!d.path) return null;
  if (d.path === 'server') return `Voice server · ${d.reason ? REASON_TEXT[d.reason] : 'fallback'}${d.lastError ? ` · error ${d.lastError}` : ''}`;
  const parts = [
    'Phone recogniser',
    serviceLabel(d.service),
    d.onDevice ? 'on-device' : 'network',
    d.persist ? 'audio copy on' : 'audio copy off',
    `${d.partials} partial${d.partials === 1 ? '' : 's'}`,
  ];
  if (d.firstPartialMs !== null) parts.push(`first ${d.firstPartialMs} ms`);
  if (d.lastError) parts.push(`error ${d.lastError}`);
  if (d.gate) parts.push(d.gate);
  return parts.join(' · ');
}
