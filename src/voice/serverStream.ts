/**
 * Server-path live streaming (v1.4.2). Pure TS — no React Native imports — so it is unit-tested in Node.
 *
 * While the dealer is still speaking, raw int16 PCM from the mic is POSTed to the voice server in small
 * HTTP chunks (WebSockets are impossible: the Expo dev-server proxy strips the Upgrade header):
 *
 *   POST {base}/stream/{id}/start          JSON { sampleRate, channels, encoding, languageCode, ...CommandContext }
 *   POST {base}/stream/{id}/chunk?seq=N    raw int16 LE PCM (application/octet-stream) → { partial }
 *   GET  {base}/stream/{id}/partial?after=REV&waitMs=N   (optional long poll)
 *   POST {base}/stream/{id}/end?seq=LAST   JSON { ...CommandContext, ...extras } → the /command response
 *   DELETE {base}/stream/{id}              cancel
 *
 * Exactly ONE chunk request is in flight at a time; audio that arrives meanwhile is coalesced into the next
 * POST, and `seq` is strictly increasing. Partial text from chunk responses goes to `onPartial` (stale `rev`s
 * are dropped). The whole clip is also kept in memory (capped), so if streaming fails at ANY point — start
 * (other than 409 busy), a network error, a chunk or end error — `finish()` sends the same audio as a 16-bit
 * WAV to the classic whole-clip POST /command and the dealer never loses the turn.
 *
 * OTP SAFETY: nothing here logs. Partial text is handed to the caller, which masks OTP digits via
 * `liveTextFromPartial` before anything reaches the screen.
 */
import { readCommand, type CommandExtras, type ResponseLike } from './sttClient';
import { VoiceError, type CommandContext, type CommandResponse } from './types';
import { maskOtp } from './voiceLogic';

export type FetchInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  signal?: AbortSignal;
};
export type FetchLike = (url: string, init: FetchInit) => Promise<ResponseLike>;

export type StreamPartial = {
  text: string;
  stable: string;
  unstable: string;
  rev: number;
  audioMs?: number;
  decodeMs?: number;
  /** The server already masked digits (OTP). */
  masked?: boolean;
};

export type StreamFormat = { sampleRate: number; channels?: number; languageCode?: string };

export type StreamState = 'idle' | 'starting' | 'streaming' | 'fallback' | 'busy' | 'finishing' | 'done' | 'cancelled';

/** Why a session gave up streaming (the turn then goes through whole-clip /command). */
export type FallbackReason = 'start_http' | 'start_network' | 'chunk_http' | 'chunk_network' | 'end_http' | 'end_network' | 'rate_change';

export type StreamSessionOptions = {
  fetch: FetchLike;
  /** Voice server base URL, no trailing slash (STT_BASE_URL). */
  baseUrl: string;
  /** Client-side stream id; random when omitted. */
  id?: string;
  /** Audio per chunk POST (ms of PCM). Default 200. */
  flushMs?: number;
  /** PCM kept / sent per turn. Default 30 000 ms. */
  maxMs?: number;
  /** Per start / chunk request. Default 8000 ms. */
  requestTimeoutMs?: number;
  /** /end and the /command fallback. Default 45 000 ms. */
  timeoutMs?: number;
  /**
   * Also long-poll GET /partial?after=REV&waitMs=1500 while streaming, so a partial the server decodes between
   * chunk responses shows at once. Off by default here; the app turns it on.
   */
  longPoll?: boolean;
  /**
   * Ask for the server's fast final: /end?fast=1 (true) or fast=0 (false); omitted when undefined (server default).
   * The app passes config STREAM_FAST_FINAL (default true).
   */
  fastFinal?: boolean;
  /** Long poll: wait at least this long between polls that brought nothing new. Default 250 ms. */
  minPollGapMs?: number;
  /** Send chunks as JSON { seq, audioBase64 } instead of raw octets (also auto-selected after a 415). */
  jsonChunks?: boolean;
  onPartial?: (p: StreamPartial) => void;
  onFallback?: (reason: FallbackReason) => void;
  /** start() got 409: Zippy is still speaking. */
  onBusy?: () => void;
};

export type StreamStats = {
  chunks: number;
  bytesSent: number;
  partials: number;
  fallback: FallbackReason | null;
  /** 'stream' = /end answered, 'command' = WAV fallback answered. */
  via: 'stream' | 'command' | null;
};

// ---------------------------------------------------------------------------------------------
// PCM helpers (pure)
// ---------------------------------------------------------------------------------------------

/** int16 LE PCM (ArrayBuffer or Int16Array, any channel count) → mono Int16Array (channels averaged). */
export function toMonoInt16(data: ArrayBuffer | Int16Array, channels = 1): Int16Array {
  const src = data instanceof Int16Array ? data : new Int16Array(data, 0, Math.floor(data.byteLength / 2));
  if (channels <= 1) return src;
  const frames = Math.floor(src.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += src[i * channels + c];
    out[i] = Math.round(sum / channels);
  }
  return out;
}

/** RMS level of int16 samples in dBFS (-160 for silence), the same scale as expo-audio's metering. */
export function rmsDb(samples: Int16Array): number {
  if (!samples.length) return -160;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i] / 32768; sum += v * v; }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(-160, 20 * Math.log10(rms)) : -160;
}

function concatInt16(parts: readonly Int16Array[], total?: number): Int16Array {
  const n = total ?? parts.reduce((a, p) => a + p.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const p of parts) { out.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; if (o >= n) break; }
  return out;
}

/** Little-endian bytes of the samples as a standalone ArrayBuffer (what fetch / RN networking send). */
export function int16ToArrayBuffer(s: Int16Array): ArrayBuffer {
  const out = new ArrayBuffer(s.length * 2);
  const v = new DataView(out);
  for (let i = 0; i < s.length; i++) v.setInt16(i * 2, s[i], true);
  return out;
}

/** 44-byte RIFF/WAVE header + 16-bit PCM. */
export function pcmToWav(samples: Int16Array, sampleRate: number, channels = 1): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 without Buffer / btoa (works the same in Hermes, browsers and Node). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) { const n = bytes[i] << 16; out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '=='; }
  else if (rest === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='; }
  return out;
}

/** Random client-side stream id (not security-sensitive; just unique per turn). */
export function newStreamId(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 36).toString(36);
  return `s${Date.now().toString(36)}${s}`;
}

/**
 * What the live pill shows for one partial. OTP turns (or a server-masked partial) never show digits —
 * the same `maskOtp(digitCount)` the device path uses.
 */
export function liveTextFromPartial(p: Pick<StreamPartial, 'text' | 'masked'>, otp: boolean): string {
  if (!otp && !p.masked) return p.text;
  return maskOtp(p.text.replace(/\D/g, '').length);
}

function parsePartial(v: unknown): StreamPartial | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.rev !== 'number') return null;
  const stable = typeof o.stable === 'string' ? o.stable : '';
  const unstable = typeof o.unstable === 'string' ? o.unstable : '';
  const text = typeof o.text === 'string' ? o.text : [stable, unstable].filter(Boolean).join(' ');
  return {
    text, stable, unstable, rev: o.rev,
    ...(typeof o.audioMs === 'number' ? { audioMs: o.audioMs } : {}),
    ...(typeof o.decodeMs === 'number' ? { decodeMs: o.decodeMs } : {}),
    ...(o.masked === true ? { masked: true } : {}),
  };
}

/** Same request fields /command gets (CommandContext + extras), without undefined keys. */
function contextBody(ctx: CommandContext | undefined, extras?: CommandExtras): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...(ctx ?? {}), ...(extras ?? {}) })) as Record<string, unknown>;
}

class RequestFailed extends Error {
  constructor(public readonly kind: 'http' | 'network' | 'timeout', public readonly status = 0) { super(kind); }
}

// ---------------------------------------------------------------------------------------------
// StreamSession
// ---------------------------------------------------------------------------------------------

export class StreamSession {
  readonly id: string;
  private readonly o: Required<Pick<StreamSessionOptions, 'flushMs' | 'maxMs' | 'requestTimeoutMs' | 'timeoutMs' | 'minPollGapMs'>> & StreamSessionOptions;
  private _state: StreamState = 'idle';
  private ctx: CommandContext | undefined;
  private rate = 0;
  private channels = 1;
  private languageCode: string | undefined;
  /** Every sample of the turn (capped at maxMs) — the WAV fallback. */
  private all: Int16Array[] = [];
  private allLen = 0;
  /** Samples not yet POSTed. */
  private pending: Int16Array[] = [];
  private pendingLen = 0;
  private seq = 0;
  private lastSentSeq = -1;
  private lastRev = -1;
  private inflight: Promise<void> | null = null;
  private startP: Promise<void> | null = null;
  private draining = false;
  private json: boolean;
  private readonly ctrls = new Set<AbortController>();
  private polling = false;
  private pollCtrl: AbortController | null = null;
  readonly stats: StreamStats = { chunks: 0, bytesSent: 0, partials: 0, fallback: null, via: null };

  constructor(opts: StreamSessionOptions) {
    this.o = { flushMs: 200, maxMs: 30_000, requestTimeoutMs: 8000, timeoutMs: 45_000, minPollGapMs: 250, ...opts };
    this.id = opts.id ?? newStreamId();
    this.json = !!opts.jsonChunks;
  }

  get state(): StreamState { return this._state; }
  /** Sample rate the session was started with (0 before start). */
  get sampleRate(): number { return this.rate; }
  /** ms of audio captured so far. */
  get audioMs(): number { return this.rate ? (this.allLen / this.rate) * 1000 : 0; }

  private url(step: string, q?: Record<string, string | number>): string {
    const qs = q ? `?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
    return `${this.o.baseUrl}/stream/${encodeURIComponent(this.id)}${step ? `/${step}` : ''}${qs}`;
  }

  /** One request with its own timeout; network / timeout → RequestFailed. Aborted by cancel(). */
  private async req(url: string, init: FetchInit, timeoutMs: number, own?: (c: AbortController | null) => void): Promise<ResponseLike> {
    const ctrl = new AbortController();
    this.ctrls.add(ctrl);
    own?.(ctrl);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await this.o.fetch(url, { ...init, signal: ctrl.signal });
    } catch {
      throw new RequestFailed(ctrl.signal.aborted && this._state !== 'cancelled' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
      this.ctrls.delete(ctrl);
      own?.(null);
    }
  }

  private postJson(url: string, body: unknown, timeoutMs: number) {
    return this.req(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
  }

  /**
   * POST /start. Never throws: a failure flips the session to 'fallback' (or 'busy' on 409) and `finish()`
   * deals with it. Audio pushed before / during start is kept and sent once start succeeds.
   */
  /** `extras`: optional turn metadata (turnId, path, …) sent in the /start body; skipTts / languageCode are not. */
  start(ctx: CommandContext | undefined, fmt: StreamFormat, extras?: CommandExtras): Promise<void> {
    if (this._state !== 'idle') return this.startP ?? Promise.resolve();
    this.ctx = ctx;
    this.rate = Math.round(fmt.sampleRate) || 16000;
    this.channels = 1; // push() down-mixes, so the server always gets mono
    this.languageCode = fmt.languageCode;
    this._state = 'starting';
    const meta = extras ? (({ skipTts: _s, languageCode: _l, ...m }) => m)(extras) : undefined;
    const body = { ...contextBody(ctx, meta), sampleRate: this.rate, channels: 1, encoding: 'int16', ...(fmt.languageCode ? { languageCode: fmt.languageCode } : {}) };
    this.startP = (async () => {
      try {
        const res = await this.postJson(this.url('start'), body, this.o.requestTimeoutMs);
        if (this._state !== 'starting') return;
        if (res.status === 409) { this._state = 'busy'; this.o.onBusy?.(); return; }
        if (!res.ok) { this.toFallback('start_http'); return; }
        try { await res.json(); } catch { /* body not needed */ }
        this._state = 'streaming';
        this.pump();
        if (this.o.longPoll) void this.poll();
      } catch {
        if (this._state === 'starting') this.toFallback('start_network');
      }
    })();
    return this.startP;
  }

  /**
   * Add one mic buffer (int16 LE). `channels` > 1 is down-mixed. `sampleRate` (the buffer's actual rate) must
   * match the start rate; if the device switches rates mid-turn streaming stops and the WAV fallback is used.
   */
  push(data: ArrayBuffer | Int16Array, channels = 1, sampleRate?: number): void {
    if (this._state === 'cancelled' || this._state === 'done' || this._state === 'finishing' || this._state === 'busy') return;
    if (sampleRate && this.rate && Math.round(sampleRate) !== this.rate) {
      if (this._state !== 'fallback') this.toFallback('rate_change');
      return;
    }
    let s = toMonoInt16(data, channels);
    const cap = this.rate ? Math.floor((this.o.maxMs / 1000) * this.rate) : Number.MAX_SAFE_INTEGER;
    if (this.allLen >= cap) return;
    if (this.allLen + s.length > cap) s = s.subarray(0, cap - this.allLen);
    if (!s.length) return;
    const copy = new Int16Array(s); // the native buffer may be reused
    this.all.push(copy); this.allLen += copy.length;
    if (this._state === 'fallback') return;
    this.pending.push(copy); this.pendingLen += copy.length;
    this.pump();
  }

  /** POST the queued audio when there is enough of it (or we are draining) and nothing is in flight. */
  private pump(): void {
    if (this._state !== 'streaming' && this._state !== 'finishing') return;
    if (this.inflight || !this.pendingLen) return;
    const min = Math.max(1, Math.floor((this.o.flushMs / 1000) * this.rate));
    if (!this.draining && this.pendingLen < min) return;
    const samples = concatInt16(this.pending, this.pendingLen);
    this.pending = []; this.pendingLen = 0;
    const seq = this.seq++;
    this.inflight = this.sendChunk(seq, samples).finally(() => { this.inflight = null; this.pump(); });
  }

  private async sendChunk(seq: number, samples: Int16Array): Promise<void> {
    try {
      let res = await this.chunkReq(seq, samples);
      if (!res.ok && (res.status === 415 || res.status === 400) && !this.json) {
        this.json = true; // the server (or a proxy) refused raw octets: same chunk as JSON base64
        res = await this.chunkReq(seq, samples);
      }
      if (!this.live()) return;
      if (!res.ok) { this.toFallback('chunk_http'); return; }
      this.lastSentSeq = seq;
      this.stats.chunks += 1;
      this.stats.bytesSent += samples.length * 2;
      let body: unknown = null;
      try { body = await res.json(); } catch { /* no partial */ }
      if (body && typeof body === 'object') this.onPartialRaw((body as Record<string, unknown>).partial);
    } catch {
      if (this.live()) this.toFallback('chunk_network');
    }
  }

  private chunkReq(seq: number, samples: Int16Array): Promise<ResponseLike> {
    const url = this.url('chunk', { seq });
    if (this.json) return this.postJson(url, { seq, audioBase64: bytesToBase64(new Uint8Array(int16ToArrayBuffer(samples))) }, this.o.requestTimeoutMs);
    return this.req(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'application/json' }, body: int16ToArrayBuffer(samples) }, this.o.requestTimeoutMs);
  }

  private live(): boolean { return this._state === 'streaming' || this._state === 'finishing'; }

  private onPartialRaw(v: unknown): void {
    const p = parsePartial(v);
    if (!p || p.rev <= this.lastRev || !this.live()) return;
    this.lastRev = p.rev;
    this.stats.partials += 1;
    this.o.onPartial?.(p);
  }

  /** Optional long poll for partials between chunk responses. Errors just stop the poll. */
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (this._state === 'streaming') {
        const t0 = Date.now();
        const before = this.lastRev;
        const res = await this.req(this.url('partial', { after: this.lastRev, waitMs: 1500 }), { method: 'GET', headers: { accept: 'application/json' } }, 4000, (c) => { this.pollCtrl = c; });
        if (!res.ok) break;
        let body: unknown = null;
        try { body = await res.json(); } catch { break; }
        this.onPartialRaw(body);
        // A server that answers at once with nothing new must not turn this into a request storm.
        const gap = this.o.minPollGapMs - (Date.now() - t0);
        if (this.lastRev === before && gap > 0) await new Promise((r) => setTimeout(r, gap));
      }
    } catch { /* best effort */ } finally { this.polling = false; }
  }

  private toFallback(reason: FallbackReason): void {
    const wasStarted = this._state === 'streaming' || this._state === 'finishing';
    this._state = 'fallback';
    this.stats.fallback = reason;
    this.pending = []; this.pendingLen = 0;
    this.pollCtrl?.abort(); // the open long poll would only hold a connection while the WAV uploads
    if (wasStarted) this.sendDelete();
    this.o.onFallback?.(reason);
  }

  private sendDelete(): void {
    // Not tracked in ctrls: a cancel must still reach the server.
    void this.o.fetch(this.url(''), { method: 'DELETE' }).catch(() => {});
  }

  /**
   * Release: flush the rest, POST /end and return the /command-shaped result. Falls back to whole-clip
   * POST /command (WAV) when streaming failed. Throws VoiceError like postToCommand ('busy', 'no_speech',
   * 'http', 'network', 'timeout').
   */
  async finish(ctx?: CommandContext, extras?: CommandExtras): Promise<CommandResponse> {
    if (this._state === 'cancelled') throw new VoiceError('network', 'cancelled');
    const c = ctx ?? this.ctx;
    if (this.startP) await this.startP;
    if ((this._state as StreamState) === 'busy') throw new VoiceError('busy');
    if (!this.allLen) { this.endQuietly(); throw new VoiceError('no_speech'); }
    if (this._state === 'streaming') {
      this._state = 'finishing';
      this.draining = true;
      this.pollCtrl?.abort(); // the long poll would only hold a connection open while /end decodes
      while (this.live() && (this.inflight || this.pendingLen)) {
        this.pump();
        if (this.inflight) await this.inflight;
      }
    }
    if (this._state === 'finishing') {
      try {
        // languageCode is repeated at /end (and in the fallback) so the final decode never auto-detects a different language.
        const res = await this.postJson(this.url('end', this.o.fastFinal === undefined ? { seq: this.lastSentSeq } : { seq: this.lastSentSeq, fast: this.o.fastFinal ? 1 : 0 }), contextBody(c, this.withLang(extras)), this.o.timeoutMs);
        if (res.status === 409) { this._state = 'done'; throw new VoiceError('busy'); }
        if (res.ok) {
          this._state = 'done';
          this.stats.via = 'stream';
          return await readCommand(res);
        }
        this.toFallback('end_http');
      } catch (e) {
        if (e instanceof VoiceError) throw e;
        if (e instanceof RequestFailed && e.kind === 'timeout') { this._state = 'done'; throw new VoiceError('timeout'); }
        if ((this._state as StreamState) === 'cancelled') throw new VoiceError('network', 'cancelled');
        this.toFallback('end_network');
      }
    }
    if ((this._state as StreamState) === 'cancelled') throw new VoiceError('network', 'cancelled');
    return this.commandFallback(c, this.withLang(extras));
  }

  private withLang(extras?: CommandExtras): CommandExtras | undefined {
    return this.languageCode && !extras?.languageCode ? { ...extras, languageCode: this.languageCode } : extras;
  }

  /** The whole clip as a WAV to POST /command (exactly what postToCommand sends, with the injected fetch). */
  private async commandFallback(ctx: CommandContext | undefined, extras?: CommandExtras): Promise<CommandResponse> {
    const wav = pcmToWav(concatInt16(this.all, this.allLen), this.rate || 16000, 1);
    this._state = 'done';
    let res: ResponseLike;
    try {
      res = await this.postJson(`${this.o.baseUrl}/command`, { audio: bytesToBase64(wav), mimeType: 'audio/wav', ...contextBody(ctx, extras) }, this.o.timeoutMs);
    } catch (e) {
      throw new VoiceError(e instanceof RequestFailed && e.kind === 'timeout' ? 'timeout' : 'network');
    }
    this.stats.via = 'command';
    return readCommand(res);
  }

  /** The WAV of everything captured so far (tests / diagnostics). */
  wav(): Uint8Array { return pcmToWav(concatInt16(this.all, this.allLen), this.rate || 16000, 1); }

  private endQuietly(): void {
    const started = this._state === 'streaming' || this._state === 'finishing';
    this._state = 'done';
    if (started) this.sendDelete();
  }

  /** Drop the turn: abort requests, tell the server (best effort), forget the audio. */
  cancel(): void {
    if (this._state === 'cancelled' || this._state === 'done') return;
    const started = this._state === 'streaming' || this._state === 'finishing' || this._state === 'starting';
    this._state = 'cancelled';
    this.ctrls.forEach((c) => c.abort());
    this.ctrls.clear();
    this.pending = []; this.pendingLen = 0; this.all = []; this.allLen = 0;
    if (started) this.sendDelete();
  }
}
