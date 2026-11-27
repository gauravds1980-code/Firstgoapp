/**
 * v1.4.2 voice backtest logging (pure core; no React Native imports so `npm run test:voice` can run it).
 *
 * - Server-path requests (/command, /text, /stream) carry turn metadata (turnId, appVersion, platform, path,
 *   deviceTranscript, deviceConfidence, deviceIdHash) — see `CommandExtras` in sttClient.ts.
 * - Every non-OTP voice turn ends with a fire-and-forget POST /log carrying one of five outcomes
 *   (executed | confirm | unmatched | dropped | error) and a reason token: device-decided turns with the full
 *   reading, server-decided turns with the outcome the phone acted on, and dropped / error turns (too short,
 *   cancelled, permission, no speech, network, timeout, recogniser errors) with what was heard and the clip.
 * - OTP turns are never posted to /log, and OTP text never goes into a /log body.
 * - The device id on the wire is sha256(random install id); the raw id stays in secure storage.
 * Masking (digit runs, names, phones) is done by the server, which is the source of truth. The server's
 * VOICE_LOG setting is the only on/off switch.
 */

import type { LogQueue } from './voiceLogQueue';
import { classifyHttp, type RouteOutcome } from './voiceRoutes';

export type TurnLogPath = 'device' | 'server' | 'device+check' | 'device+text' | 'stream';

/**
 * Standard outcome of a voice turn on the /log wire (v1.4.2 outcomes). Every /log body carries one of these five,
 * plus a short machine-stable `reason` token:
 * - executed: auto, confirmed
 * - confirm: clarify, preview, did_you_mean
 * - unmatched: retry, below_floor, no_candidates, nothing
 * - dropped: too_short, cancelled, superseded, permission, prompted, dismissed, double_tap
 * - error: no_speech, network, timeout, http, asr_<kind>, error (any other failure code is kept as the reason)
 */
export type TurnOutcome = 'executed' | 'confirm' | 'unmatched' | 'dropped' | 'error';
export const TURN_OUTCOMES: readonly TurnOutcome[] = ['executed', 'confirm', 'unmatched', 'dropped', 'error'];

/** Old outcome values (and bare reasons) → the five outcomes. */
const LEGACY_OUTCOME: Record<string, TurnOutcome> = {
  auto: 'executed', confirmed: 'executed',
  preview: 'confirm', clarify: 'confirm', did_you_mean: 'confirm',
  retry: 'unmatched', nothing: 'unmatched', below_floor: 'unmatched', no_candidates: 'unmatched',
  too_short: 'dropped', cancelled: 'dropped', superseded: 'dropped', permission: 'dropped', permission_denied: 'dropped', prompted: 'dropped', dismissed: 'dropped', double_tap: 'dropped',
  no_speech: 'error', network: 'error', timeout: 'error', http: 'error', error: 'error',
};

/** Short machine-stable token: lower case, [a-z0-9_] only, at most 32 chars. */
export function reasonToken(s: string | undefined | null): string | undefined {
  const t = String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return t || undefined;
}

/**
 * Map any outcome value (new or old) onto the five outcomes. Old values become the reason when no reason is
 * given (auto → executed/auto, retry → unmatched/retry, asr_busy → error/asr_busy). Unknown values are errors.
 */
export function normalizeOutcome(outcome?: string | null, reason?: string | null): { outcome?: TurnOutcome; reason?: string } {
  const o = reasonToken(outcome);
  const r = reasonToken(reason);
  if (!o) return r ? normalizeOutcome(r) : {};
  if ((TURN_OUTCOMES as readonly string[]).includes(o)) return { outcome: o as TurnOutcome, ...(r ? { reason: r } : {}) };
  const mapped = LEGACY_OUTCOME[o] ?? 'error';
  const why = r ?? (o === 'permission_denied' ? 'permission' : o);
  return { outcome: mapped, reason: why };
}

/** The parts of a CommandResponse the outcome mapper reads. */
export type OutcomeCommand = { status?: string; intent?: string; score?: number; transcript?: string; candidates?: unknown[] | null };

/**
 * Outcome of a delivered result. `acted`: the command ran at once (auto-act). Otherwise the dealer saw a preview:
 * a "Did you mean" (candidates) / clarify is `confirm`; a say-again with no usable candidates is `unmatched`.
 */
export function deliveredOutcome(cmd: OutcomeCommand, acted: boolean): { outcome: TurnOutcome; reason: string } {
  if (acted) return { outcome: 'executed', reason: 'auto' };
  const status = cmd.status ?? 'ok';
  const hasCands = !!cmd.candidates?.length;
  if (status === 'clarify') return { outcome: 'confirm', reason: hasCands ? 'did_you_mean' : 'clarify' };
  if (status === 'retry' || status === 'reprompt') {
    if (hasCands) return { outcome: 'confirm', reason: 'did_you_mean' };
    if (!(cmd.transcript ?? '').trim()) return { outcome: 'unmatched', reason: 'nothing' };
    if ((cmd.score ?? 0) > 0) return { outcome: 'unmatched', reason: 'below_floor' };
    if (!cmd.intent || cmd.intent === 'UNKNOWN') return { outcome: 'unmatched', reason: 'no_candidates' };
    return { outcome: 'unmatched', reason: 'retry' };
  }
  if (!cmd.intent || cmd.intent === 'UNKNOWN') return { outcome: hasCands ? 'confirm' : 'unmatched', reason: hasCands ? 'did_you_mean' : 'no_candidates' };
  return { outcome: 'confirm', reason: 'preview' };
}

/** Failure → outcome: a VoiceError code / ASR kind / anything thrown. Dropped codes stay dropped. */
export function failureOutcome(code: string | undefined | null): { outcome: TurnOutcome; reason: string } {
  const n = normalizeOutcome(code || 'error');
  if (n.reason === 'asr_permission') return { outcome: 'dropped', reason: 'permission' };
  const outcome = n.outcome === 'dropped' ? 'dropped' : 'error';
  return { outcome, reason: n.reason ?? 'error' };
}

/**
 * Attach the turn's clip to /log? Never for OTP; only when a clip exists and no Whisper check has taken it (the
 * check posts /command with the same turnId and carries the clip itself).
 */
export function shouldAttachClip(t: { otp?: boolean; audioUri?: string | null; checkStarted?: boolean }): boolean {
  return !t.otp && !!t.audioUri && !t.checkStarted;
}

/** What the app knows about a turn that ended without a delivered result (dropped / error). */
export type TurnEndInput = {
  turnId: string;
  path: TurnLogPath;
  outcome: TurnOutcome;
  reason: string;
  otp?: boolean;
  expect?: string;
  deviceText?: string;
  deviceConfidence?: number;
  /** Last live partial (what the dealer saw) when no final text came. */
  partial?: string;
  screen?: string;
  route?: string;
  audioBase64?: string;
};

/** /log record for a dropped / error turn, or null for OTP turns. Transcript = final device text, else the partial. */
export function turnEndRecord(i: TurnEndInput): DeviceTurnRecord | null {
  if (i.otp || isOtpTurn({ expect: i.expect, screen: i.screen, route: i.route })) return null;
  const heard = (i.deviceText ?? '').trim() || (i.partial ?? '').trim();
  return {
    turnId: i.turnId,
    path: i.path,
    outcome: i.outcome,
    reason: i.reason,
    ...(heard ? { deviceTranscript: heard, transcript: heard } : {}),
    ...(i.deviceConfidence !== undefined ? { deviceConfidence: i.deviceConfidence } : {}),
    ...(i.screen ? { screen: i.screen } : {}),
    ...(i.route ? { context: { route: i.route } } : {}),
    ...(i.audioBase64 ? { audioBase64: i.audioBase64, mimeType: 'audio/wav' } : {}),
  };
}

/** Turn metadata sent with server requests and /log. All optional (old servers ignore unknown keys). */
export type TurnMeta = {
  turnId?: string;
  appVersion?: string;
  platform?: string;
  path?: TurnLogPath;
  deviceTranscript?: string;
  deviceConfidence?: number;
  /** One of TurnOutcome on the wire; old values are mapped by buildLogBody. */
  outcome?: string;
  /** Short token, e.g. auto, did_you_mean, below_floor, too_short, network. */
  reason?: string;
  deviceIdHash?: string;
};

export type DeviceTurnRecord = TurnMeta & {
  transcript?: string;
  intent?: string;
  score?: number;
  band?: string;
  method?: string;
  candidates?: { intent: string; score?: number; phrase?: string }[];
  screen?: string;
  context?: { route?: string };
  timings?: Record<string, number>;
  /** Base64 clip (optional). Dropped for OTP turns. */
  audioBase64?: string;
  mimeType?: string;
  expect?: string;
  /** The turn's own OTP flag (expect=otp at press time). */
  otp?: boolean;
  hasOtpField?: boolean;
};

export type KeyValueStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<unknown>;

export type TurnLogDeps = {
  fetch: FetchLike;
  storage: KeyValueStorage;
  /** The current voice route (voiceRoutes.ts) or '' when voice is not configured (then nothing is posted). */
  baseUrl: () => string;
  platform: string;
  appVersion: string;
  random?: () => number;
  /** v1.4.5: offline queue (voiceLogQueue.ts). A /log post that fails on the route is kept and resent later. */
  queue?: LogQueue;
  /** v1.4.5: tell the route manager how the route answered ('route' = tunnel down / network error). */
  report?: (base: string, outcome: RouteOutcome) => void;
};

/** A fetch result → ok / route failure / app error. Anything without a numeric status (old test doubles) is ok. */
async function sendOutcome(res: unknown): Promise<RouteOutcome> {
  if (typeof res !== 'object' || res === null) return 'ok';
  const r = res as { status?: unknown; headers?: { get?(n: string): string | null } | null; text?: () => Promise<string> };
  if (typeof r.status !== 'number') return 'ok';
  let start: string | null = null;
  if (r.status >= 300 && typeof r.text === 'function') { try { start = (await r.text()).slice(0, 64); } catch { /* no body */ } }
  return classifyHttp(r.status, typeof r.headers?.get === 'function' ? r.headers.get('content-type') : null, start);
}

export const INSTALL_ID_KEY = 'firstgo.voice.installId';

// ---- sha256 (pure; no native crypto dependency) ---------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

/** Hex sha256 of a UTF-8 string. */
export function sha256Hex(input: string): string {
  const bytes = utf8(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  for (const v of [hi, bitLen >>> 0]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

// ---- ids --------------------------------------------------------------------------

const randHex = (n: number, random: () => number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');

/** Short unique turn id (also the server-side clip name). */
export function newTurnId(nowMs: number = Date.now(), random: () => number = Math.random): string {
  return `${nowMs.toString(36)}-${randHex(6, random)}`;
}

// ---- OTP --------------------------------------------------------------------------

/** v1.4.5: screens that only ever take an OTP by voice: a turn there is an OTP turn even without `expect`. */
const OTP_ONLY_SCREENS: ReadonlySet<string> = new Set(['Esign', 'DealerOtp']);

export function isOtpTurn(r: { expect?: string; otp?: boolean; hasOtpField?: boolean; screen?: string; route?: string }): boolean {
  return r.otp === true || r.hasOtpField === true || (r.expect ?? '').trim().toLowerCase() === 'otp'
    || OTP_ONLY_SCREENS.has(r.screen ?? '') || OTP_ONLY_SCREENS.has(r.route ?? '');
}

/** JSON body for POST /log, or null for OTP turns (never posted). Drops empty keys. */
export function buildLogBody(rec: DeviceTurnRecord): Record<string, unknown> | null {
  if (isOtpTurn({ ...rec, route: rec.context?.route })) return null;
  const { otp: _otp, hasOtpField: _h, audioBase64, mimeType, candidates, ...rest } = rec;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null && v !== '') body[k] = v;
  // The wire always carries one of the five outcomes (old auto/preview/clarify/retry/confirmed are mapped here).
  const n = normalizeOutcome(rec.outcome, rec.reason);
  delete body.outcome; delete body.reason;
  if (n.outcome) body.outcome = n.outcome;
  if (n.reason) body.reason = n.reason;
  if (candidates?.length) body.candidates = candidates.slice(0, 5).map((c) => ({ intent: c.intent, score: c.score, phrase: c.phrase }));
  if (audioBase64) { body.audioBase64 = audioBase64; body.mimeType = mimeType ?? 'audio/wav'; }
  return body;
}

// ---- logger -----------------------------------------------------------------------

export function createVoiceTurnLog(deps: TurnLogDeps) {
  const random = deps.random ?? Math.random;
  let hashPromise: Promise<string | undefined> | null = null;
  let hashCached: string | undefined;

  /** sha256 hex of the persisted random install id (created on first use). Never rejects. */
  function deviceIdHash(): Promise<string | undefined> {
    if (!hashPromise) {
      hashPromise = (async () => {
        try {
          let id = await deps.storage.get(INSTALL_ID_KEY);
          if (!id) {
            id = randHex(32, random);
            await deps.storage.set(INSTALL_ID_KEY, id);
          }
          hashCached = sha256Hex(id);
          return hashCached;
        } catch {
          hashPromise = null; // try again next time
          return undefined;
        }
      })();
    }
    return hashPromise;
  }

  /** Cached hash for synchronous request building (undefined until the first load finishes). */
  function deviceIdHashSync(): string | undefined {
    if (hashCached === undefined) void deviceIdHash();
    return hashCached;
  }

  /** Base metadata for a server request or a /log record. */
  function meta(m: TurnMeta = {}): TurnMeta {
    const out: TurnMeta = { appVersion: deps.appVersion, platform: deps.platform, ...m };
    const h = m.deviceIdHash ?? deviceIdHashSync();
    if (h) out.deviceIdHash = h;
    return out;
  }

  /**
   * Fire-and-forget POST /log. Resolves true when sent, false when skipped (OTP, voice not configured) or on any
   * error. Never rejects, so callers can `void postDeviceTurn(...)` on the UI path.
   */
  async function postDeviceTurn(rec: DeviceTurnRecord): Promise<boolean> {
    let body: Record<string, unknown> | null = null;
    try {
      const base = deps.baseUrl();
      if (!base) return false;
      body = buildLogBody({ ...meta({}), ...rec, deviceIdHash: rec.deviceIdHash ?? (await deviceIdHash()) });
      if (!body) return false;
      const outcome = await send(base, body);
      if (outcome === 'route') { await deps.queue?.enqueue(body); return false; }
      if (outcome === 'ok' && deps.queue?.size()) void flushQueue();
      return outcome === 'ok';
    } catch {
      return false;
    }
  }

  /** One POST {base}/log → outcome (reported to the route manager). Never rejects. */
  async function send(base: string, body: Record<string, unknown>): Promise<RouteOutcome> {
    let outcome: RouteOutcome;
    try {
      const res = await deps.fetch(`${base}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      outcome = await sendOutcome(res);
    } catch {
      outcome = 'route';
    }
    try { deps.report?.(base, outcome); } catch { /* listener */ }
    return outcome;
  }

  /** Resend queued /log posts in order on the current route (after a success, on route recovery, at app start). */
  async function flushQueue(): Promise<{ sent: number; dropped: number; left: number }> {
    const q = deps.queue;
    if (!q) return { sent: 0, dropped: 0, left: 0 };
    await q.load();
    if (!q.size()) return { sent: 0, dropped: 0, left: 0 };
    return q.flush((b) => { const base = deps.baseUrl(); return base ? send(base, b) : Promise.resolve('route' as const); });
  }

  return { deviceIdHash, deviceIdHashSync, meta, postDeviceTurn, flushQueue };
}

export type VoiceTurnLog = ReturnType<typeof createVoiceTurnLog>;
