/**
 * v1.4.2 server-path live streaming (StreamSession) against a fake fetch. Run: npm run test:voice
 */
import { STREAM_FAST_FINAL } from '../config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToBase64, int16ToArrayBuffer, liveTextFromPartial, pcmToWav, rmsDb, StreamSession, toMonoInt16, type FetchInit, type StreamPartial,
} from '../serverStream';
import { VoiceError } from '../types';

const BASE = 'http://voice.test';
const CTX = { sessionId: 'sess-1', screen: 'home', expect: undefined };
const COMMAND_OK = { transcript: 'open payouts', confidence: 0.9, intent: 'OPEN_PAYOUTS', score: 0.9, matchedPhrase: 'open payouts', action: { type: 'navigate', route: '/payouts' } };

type Call = { url: string; method: string; body?: string | ArrayBuffer; headers?: Record<string, string> };
type Reply = { status: number; body?: unknown } | Error;

function res(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Fake fetch: `route(call)` decides the reply; `hold` lets a test keep chunk requests pending. */
function fakeFetch(route: (c: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  let inflightChunks = 0;
  let maxInflightChunks = 0;
  const fetch = async (url: string, init: FetchInit) => {
    const c: Call = { url, method: init.method, body: init.body, headers: init.headers };
    calls.push(c);
    const isChunk = url.includes('/chunk');
    if (isChunk) { inflightChunks++; maxInflightChunks = Math.max(maxInflightChunks, inflightChunks); }
    try {
      const r = await route(c);
      if (r instanceof Error) throw r;
      return res(r.status, r.body);
    } finally {
      if (isChunk) inflightChunks--;
    }
  };
  return { fetch, calls, get maxInflight() { return maxInflightChunks; } };
}

const deferred = () => { let resolve!: () => void; const p = new Promise<void>((r) => { resolve = r; }); return { p, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
/** n samples of a constant value (16 kHz → 1600 samples = 100 ms). */
const pcm = (n: number, v = 1000) => new Int16Array(n).fill(v);
const seqOf = (u: string) => Number(new URL(u).searchParams.get('seq'));
const step = (u: string) => new URL(u).pathname.split('/').slice(3).join('/') || 'stream';

function okRoute(partialFor?: (seq: number) => unknown) {
  return (c: Call): Reply => {
    const s = step(c.url);
    if (s === 'start') return { status: 200, body: { ok: true, partialIntervalMs: 200 } };
    if (s === 'chunk') { const seq = seqOf(c.url); return { status: 200, body: { ok: true, seq, partial: partialFor ? partialFor(seq) : null } }; }
    if (s === 'end') return { status: 200, body: { ...COMMAND_OK, stream: { chunks: 3 } } };
    if (c.url.endsWith('/command')) return { status: 200, body: COMMAND_OK };
    return { status: 200, body: {} };
  };
}

test('start sends format + context; chunks are raw int16 LE octets with strictly increasing seq; end carries last seq', async () => {
  const f = fakeFetch(okRoute());
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, id: 'abc', flushMs: 200 });
  await s.start(CTX, { sampleRate: 16000, languageCode: 'en-IN' });
  for (let i = 0; i < 10; i++) { s.push(pcm(1600, i)); await tick(); }
  const out = await s.finish(CTX, { skipTts: true });
  assert.equal(out.intent, 'OPEN_PAYOUTS');
  assert.equal(s.stats.via, 'stream');
  const start = f.calls[0];
  assert.equal(start.url, `${BASE}/stream/abc/start`);
  const sb = JSON.parse(String(start.body));
  assert.deepEqual({ sampleRate: sb.sampleRate, channels: sb.channels, encoding: sb.encoding, languageCode: sb.languageCode, sessionId: sb.sessionId, screen: sb.screen },
    { sampleRate: 16000, channels: 1, encoding: 'int16', languageCode: 'en-IN', sessionId: 'sess-1', screen: 'home' });
  const chunks = f.calls.filter((c) => step(c.url) === 'chunk');
  assert.ok(chunks.length >= 4, `expected several chunks, got ${chunks.length}`);
  assert.deepEqual(chunks.map((c) => seqOf(c.url)), chunks.map((_, i) => i));
  assert.equal(chunks[0].headers?.['content-type'], 'application/octet-stream');
  assert.ok(chunks[0].body instanceof ArrayBuffer);
  const total = chunks.reduce((a, c) => a + (c.body as ArrayBuffer).byteLength, 0);
  assert.equal(total, 10 * 1600 * 2, 'every sample sent exactly once');
  const first = new DataView(chunks[0].body as ArrayBuffer);
  assert.equal(first.getInt16(0, true), 0);
  const end = f.calls.find((c) => step(c.url) === 'end')!;
  assert.equal(seqOf(end.url), chunks.length - 1);
  assert.equal(JSON.parse(String(end.body)).skipTts, true);
  assert.equal(JSON.parse(String(end.body)).languageCode, 'en-IN', 'start languageCode repeated at /end');
});

test('only ONE chunk in flight: audio pushed meanwhile is coalesced into the next POST', async () => {
  const gate = deferred();
  let held = true;
  const base = okRoute();
  const f = fakeFetch(async (c) => { if (step(c.url) === 'chunk' && held) { await gate.p; } return base(c); });
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 200 });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200)); // ≥ 200 ms → chunk 0 goes out and hangs
  await tick();
  for (let i = 0; i < 8; i++) s.push(pcm(1600)); // 800 ms queued behind it
  await tick();
  assert.equal(f.calls.filter((c) => step(c.url) === 'chunk').length, 1, 'no second chunk while one is in flight');
  held = false;
  gate.resolve();
  await tick(); await tick(); await tick();
  const chunks = f.calls.filter((c) => step(c.url) === 'chunk');
  assert.equal(chunks.length, 2);
  assert.equal((chunks[1].body as ArrayBuffer).byteLength, 8 * 1600 * 2, 'queued audio coalesced into one POST');
  await s.finish(CTX);
  assert.equal(f.maxInflight, 1);
});

test('finish flushes a sub-threshold remainder before /end', async () => {
  const f = fakeFetch(okRoute());
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 200 });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(800)); // 50 ms: below the flush threshold
  await tick();
  assert.equal(f.calls.filter((c) => step(c.url) === 'chunk').length, 0);
  await s.finish(CTX);
  const steps = f.calls.map((c) => step(c.url));
  assert.deepEqual(steps, ['start', 'chunk', 'end']);
});

test('audio pushed before /start answers is kept and streamed after', async () => {
  const gate = deferred();
  const base = okRoute();
  const f = fakeFetch(async (c) => { if (step(c.url) === 'start') await gate.p; return base(c); });
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  const started = s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(1600)); s.push(pcm(1600)); s.push(pcm(1600));
  assert.equal(f.calls.length, 1);
  gate.resolve();
  await started; await tick();
  const chunks = f.calls.filter((c) => step(c.url) === 'chunk');
  assert.equal(chunks.length, 1);
  assert.equal((chunks[0].body as ArrayBuffer).byteLength, 3 * 1600 * 2);
});

test('partials: newer rev delivered, stale / repeated rev ignored, null partial ignored', async () => {
  const revs = [1, 3, 2, 3, null, 4];
  const f = fakeFetch(okRoute((seq) => (revs[seq] === null || revs[seq] === undefined ? null : { text: `t${revs[seq]}`, stable: '', unstable: `t${revs[seq]}`, rev: revs[seq] })));
  const seen: StreamPartial[] = [];
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 100, onPartial: (p) => seen.push(p) });
  await s.start(CTX, { sampleRate: 16000 });
  for (let i = 0; i < revs.length; i++) { s.push(pcm(1600)); await tick(); await tick(); }
  await s.finish(CTX);
  assert.deepEqual(seen.map((p) => p.rev), [1, 3, 4]);
  assert.equal(seen[0].text, 't1');
});

test('OTP masking: partial digits never reach the live pill on OTP turns or server-masked partials', () => {
  assert.equal(liveTextFromPartial({ text: 'one two 3 4 5 6' }, true), '••••');
  assert.equal(liveTextFromPartial({ text: '482913' }, true), '••••••');
  assert.equal(liveTextFromPartial({ text: '' }, true), '••••••');
  assert.equal(liveTextFromPartial({ text: '[otp] 12', masked: true }, false), '••••');
  assert.equal(liveTextFromPartial({ text: 'open payouts' }, false), 'open payouts');
  assert.ok(!/\d/.test(liveTextFromPartial({ text: 'my otp is 4 8 2 9 1 3 7 7' }, true)));
});

test('start 503 → whole clip falls back to /command as a 16-bit WAV with the same context', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => (step(c.url) === 'start' ? { status: 503, body: { error: 'not ready' } } : base(c)));
  const reasons: string[] = [];
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, onFallback: (r) => reasons.push(r) });
  await s.start(CTX, { sampleRate: 48000 });
  for (let i = 0; i < 5; i++) s.push(pcm(4800, 7));
  const out = await s.finish(CTX, { skipTts: true });
  assert.equal(out.intent, 'OPEN_PAYOUTS');
  assert.equal(s.stats.via, 'command');
  assert.deepEqual(reasons, ['start_http']);
  assert.equal(f.calls.filter((c) => step(c.url) === 'chunk').length, 0);
  const cmd = f.calls.find((c) => c.url === `${BASE}/command`)!;
  const body = JSON.parse(String(cmd.body));
  assert.equal(body.mimeType, 'audio/wav');
  assert.equal(body.sessionId, 'sess-1');
  assert.equal(body.skipTts, true);
  const wav = Buffer.from(body.audio, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 48000, 'WAV carries the actual capture rate');
  assert.equal(wav.length, 44 + 5 * 4800 * 2);
  assert.equal(wav.readInt16LE(44), 7);
});

test('start network error → WAV fallback', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => (step(c.url) === 'start' ? new TypeError('Network request failed') : base(c)));
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200));
  await s.finish(CTX);
  assert.equal(s.stats.fallback, 'start_network');
  assert.equal(s.stats.via, 'command');
});

test('mid-stream chunk failure → stream cancelled (DELETE) and the FULL clip goes to /command', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => (step(c.url) === 'chunk' && seqOf(c.url) === 1 ? { status: 500 } : base(c)));
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 100 });
  await s.start(CTX, { sampleRate: 16000 });
  for (let i = 0; i < 6; i++) { s.push(pcm(1600, i + 1)); await tick(); await tick(); }
  const out = await s.finish(CTX);
  assert.equal(out.intent, 'OPEN_PAYOUTS');
  assert.equal(s.stats.fallback, 'chunk_http');
  assert.ok(f.calls.some((c) => c.method === 'DELETE'));
  assert.ok(!f.calls.some((c) => step(c.url) === 'end'));
  const wav = Buffer.from(JSON.parse(String(f.calls.find((c) => c.url.endsWith('/command'))!.body)).audio, 'base64');
  assert.equal(wav.length, 44 + 6 * 1600 * 2, 'audio sent before AND after the failure is in the fallback');
  assert.equal(wav.readInt16LE(44), 1);
  assert.equal(wav.readInt16LE(44 + 5 * 1600 * 2), 6);
});

test('mid-stream network error and /end 5xx both fall back', async () => {
  for (const which of ['chunk', 'end'] as const) {
    const base = okRoute();
    const f = fakeFetch((c) => (step(c.url) === which ? (which === 'chunk' ? new TypeError('offline') : { status: 502 }) : base(c)));
    const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 100 });
    await s.start(CTX, { sampleRate: 16000 });
    s.push(pcm(3200)); await tick();
    const out = await s.finish(CTX);
    assert.equal(out.intent, 'OPEN_PAYOUTS');
    assert.equal(s.stats.fallback, which === 'chunk' ? 'chunk_network' : 'end_http');
    assert.equal(s.stats.via, 'command');
  }
});

test('415 on raw octets → the same chunk is re-sent as JSON { seq, audioBase64 }', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => (step(c.url) === 'chunk' && c.headers?.['content-type'] === 'application/octet-stream' ? { status: 415 } : base(c)));
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200, 5));
  await s.finish(CTX);
  assert.equal(s.stats.via, 'stream');
  const json = f.calls.filter((c) => step(c.url) === 'chunk' && c.headers?.['content-type'] === 'application/json');
  assert.equal(json.length, 1);
  const b = JSON.parse(String(json[0].body));
  assert.equal(b.seq, 0);
  assert.equal(Buffer.from(b.audioBase64, 'base64').readInt16LE(0), 5);
});

test('409 on start → busy (no fallback upload); 409 on /end → busy', async () => {
  const base = okRoute();
  let busy = 0;
  const f = fakeFetch((c) => (step(c.url) === 'start' ? { status: 409, body: { error: 'busy' } } : base(c)));
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, onBusy: () => busy++ });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200));
  await assert.rejects(s.finish(CTX), (e) => e instanceof VoiceError && e.code === 'busy');
  assert.equal(busy, 1);
  assert.ok(!f.calls.some((c) => c.url.endsWith('/command')));

  const f2 = fakeFetch((c) => (step(c.url) === 'end' ? { status: 409 } : base(c)));
  const s2 = new StreamSession({ fetch: f2.fetch, baseUrl: BASE });
  await s2.start(CTX, { sampleRate: 16000 });
  s2.push(pcm(3200));
  await assert.rejects(s2.finish(CTX), (e) => e instanceof VoiceError && e.code === 'busy');
});

test('errors map like postToCommand: /end empty transcript → no_speech; fallback 500 → http; fallback offline → network', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => (step(c.url) === 'end' ? { status: 200, body: { transcript: '', intent: 'UNKNOWN' } } : base(c)));
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  await s.start(CTX, { sampleRate: 16000 }); s.push(pcm(3200));
  await assert.rejects(s.finish(CTX), (e) => e instanceof VoiceError && e.code === 'no_speech');

  const f2 = fakeFetch((c) => (step(c.url) === 'start' ? { status: 503 } : c.url.endsWith('/command') ? { status: 500 } : base(c)));
  const s2 = new StreamSession({ fetch: f2.fetch, baseUrl: BASE });
  await s2.start(CTX, { sampleRate: 16000 }); s2.push(pcm(3200));
  await assert.rejects(s2.finish(CTX), (e) => e instanceof VoiceError && e.code === 'http');

  const f3 = fakeFetch(() => new TypeError('offline'));
  const s3 = new StreamSession({ fetch: f3.fetch, baseUrl: BASE });
  await s3.start(CTX, { sampleRate: 16000 }); s3.push(pcm(3200));
  await assert.rejects(s3.finish(CTX), (e) => e instanceof VoiceError && e.code === 'network');
});

test('nothing captured → no_speech without calling /end or /command', async () => {
  const f = fakeFetch(okRoute());
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  await s.start(CTX, { sampleRate: 16000 });
  await assert.rejects(s.finish(CTX), (e) => e instanceof VoiceError && e.code === 'no_speech');
  assert.ok(!f.calls.some((c) => step(c.url) === 'end' || c.url.endsWith('/command')));
});

test('cancel: aborts the in-flight chunk, DELETEs the stream, ignores later audio, finish rejects', async () => {
  const base = okRoute();
  const f = fakeFetch((c) => {
    if (step(c.url) === 'chunk') return new Promise<Reply>(() => { /* never answers */ });
    return base(c);
  });
  // The hanging chunk rejects once its signal aborts (like real fetch).
  const fetchAbortable = (url: string, init: FetchInit) => new Promise<ReturnType<typeof res>>((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    f.fetch(url, init).then(resolve, reject);
  });
  const partials: StreamPartial[] = [];
  const s = new StreamSession({ fetch: fetchAbortable, baseUrl: BASE, onPartial: (p) => partials.push(p) });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200)); await tick();
  s.cancel();
  assert.equal(s.state, 'cancelled');
  s.push(pcm(3200)); await tick();
  assert.equal(f.calls.filter((c) => step(c.url) === 'chunk').length, 1);
  const del = f.calls.find((c) => c.method === 'DELETE');
  assert.equal(del?.url, `${BASE}/stream/${s.id}`);
  await assert.rejects(s.finish(CTX));
  assert.ok(!f.calls.some((c) => c.url.endsWith('/command')));
});

test('a device rate change mid-turn stops streaming and falls back', async () => {
  const f = fakeFetch(okRoute());
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200), 1, 16000); await tick();
  s.push(pcm(9600), 1, 48000);
  await s.finish(CTX);
  assert.equal(s.stats.fallback, 'rate_change');
  assert.equal(s.stats.via, 'command');
});

test('PCM is capped at maxMs', async () => {
  const f = fakeFetch(okRoute());
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, maxMs: 500 });
  await s.start(CTX, { sampleRate: 16000 });
  for (let i = 0; i < 10; i++) s.push(pcm(1600));
  assert.equal(s.audioMs, 500);
  assert.equal(s.wav().length, 44 + 8000 * 2);
});

test('WAV header is a valid 16-bit PCM RIFF', () => {
  const w = Buffer.from(pcmToWav(new Int16Array([0, 1, -1, 32767, -32768]), 16000, 1));
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(4), 36 + 10);
  assert.equal(w.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(w.readUInt32LE(16), 16);
  assert.equal(w.readUInt16LE(20), 1); // PCM
  assert.equal(w.readUInt16LE(22), 1); // mono
  assert.equal(w.readUInt32LE(24), 16000);
  assert.equal(w.readUInt32LE(28), 32000); // byte rate
  assert.equal(w.readUInt16LE(32), 2); // block align
  assert.equal(w.readUInt16LE(34), 16); // bits
  assert.equal(w.toString('ascii', 36, 40), 'data');
  assert.equal(w.readUInt32LE(40), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => w.readInt16LE(44 + i * 2)), [0, 1, -1, 32767, -32768]);
});

test('PCM helpers: base64 matches Buffer, LE bytes, stereo down-mix, RMS dBFS', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 255]) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
    assert.equal(bytesToBase64(b), Buffer.from(b).toString('base64'));
  }
  const ab = int16ToArrayBuffer(new Int16Array([0x0102, -2]));
  assert.deepEqual([...new Uint8Array(ab)], [0x02, 0x01, 0xfe, 0xff]);
  assert.deepEqual([...toMonoInt16(new Int16Array([100, 300, -50, -150]), 2)], [200, -100]);
  assert.equal(rmsDb(new Int16Array(160)), -160);
  assert.ok(Math.abs(rmsDb(new Int16Array(160).fill(32767)) - 0) < 0.01);
  assert.ok(Math.abs(rmsDb(new Int16Array(160).fill(328)) - -40) < 0.1);
});

test('long poll: delivers partials between chunks, never spins when the server answers at once, stops on finish', async () => {
  let polls = 0;
  let rev = 0;
  const base = okRoute();
  const f = fakeFetch((c) => {
    if (step(c.url) === 'partial') {
      polls++;
      // answers immediately; a new partial only on every 3rd poll
      if (polls % 3 === 0) rev++;
      return { status: 200, body: { text: `p${rev}`, stable: '', unstable: `p${rev}`, rev } };
    }
    return base(c);
  });
  const seen: number[] = [];
  const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, longPoll: true, minPollGapMs: 20, onPartial: (p) => seen.push(p.rev) });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(800)); // below the flush threshold: no chunk responses, only the poll can bring partials
  await new Promise((r) => setTimeout(r, 200));
  await s.finish(CTX);
  const at = polls;
  await new Promise((r) => setTimeout(r, 60));
  // 200 ms with a 20 ms gap after empty polls (polls bringing a new rev go again at once): ~15, never a storm
  assert.ok(polls <= 30, `polls throttled (got ${polls})`);
  assert.ok(seen.length >= 2 && seen.every((r, i) => i === 0 || r > seen[i - 1]), `increasing revs ${seen}`);
  assert.ok(polls - at <= 1, 'polling stops after finish');
});

test('fastFinal: /end?fast=1 when on, fast=0 when off, no fast param when unset; config default is on', async () => {
  assert.equal(STREAM_FAST_FINAL, true);
  const fastOf = async (fastFinal?: boolean) => {
    const f = fakeFetch(okRoute());
    const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, id: 'ff', flushMs: 200, ...(fastFinal === undefined ? {} : { fastFinal }) });
    await s.start(CTX, { sampleRate: 16000 });
    for (let i = 0; i < 3; i++) { s.push(pcm(1600)); await tick(); }
    await s.finish(CTX);
    const end = new URL(f.calls.find((c) => step(c.url) === 'end')!.url);
    assert.ok(end.searchParams.has('seq'));
    return end.searchParams.get('fast');
  };
  assert.equal(await fastOf(true), '1');
  assert.equal(await fastOf(false), '0');
  assert.equal(await fastOf(undefined), null);
});

test('server without /stream (start 404) and connection refused → WAV fallback, no chunks, no /end', async () => {
  const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8794'), { code: 'ECONNREFUSED' }) });
  for (const [startReply, reason] of [[{ status: 404, body: { detail: 'Not Found' } }, 'start_http'], [refused(), 'start_network']] as const) {
    const base = okRoute();
    const f = fakeFetch((c) => (step(c.url) === 'start' ? startReply : base(c)));
    const reasons: string[] = [];
    const s = new StreamSession({ fetch: f.fetch, baseUrl: BASE, flushMs: 100, onFallback: (r) => reasons.push(r) });
    await s.start(CTX, { sampleRate: 16000 });
    for (let i = 0; i < 4; i++) { s.push(pcm(1600, i + 1)); await tick(); }
    const out = await s.finish(CTX, { skipTts: true });
    assert.equal(out.intent, 'OPEN_PAYOUTS');
    assert.equal(s.stats.via, 'command');
    assert.equal(s.stats.fallback, reason);
    assert.deepEqual(reasons, [reason]);
    assert.ok(!f.calls.some((c) => step(c.url) === 'chunk' || step(c.url) === 'end'), 'nothing streamed after a failed start');
    const wav = Buffer.from(JSON.parse(String(f.calls.find((c) => c.url === `${BASE}/command`)!.body)).audio, 'base64');
    assert.equal(wav.length, 44 + 4 * 1600 * 2, 'the whole clip is uploaded');
  }
});

test('fallback aborts the open long poll (no connection held while the WAV uploads)', async () => {
  const base = okRoute();
  let pollSignal: AbortSignal | undefined;
  const calls: string[] = [];
  const fetch = async (url: string, init: FetchInit) => {
    calls.push(`${init.method} ${step(url)}`);
    if (step(url) === 'partial') {
      pollSignal = init.signal;
      // a long poll that only ends when aborted
      await new Promise<void>((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    }
    if (step(url) === 'chunk') return res(500);
    const r = base({ url, method: init.method, body: init.body });
    return r instanceof Error ? Promise.reject(r) : res(r.status, r.body);
  };
  const s = new StreamSession({ fetch, baseUrl: BASE, longPoll: true, flushMs: 100 });
  await s.start(CTX, { sampleRate: 16000 });
  s.push(pcm(3200)); await tick(); await tick();
  assert.equal(s.stats.fallback, 'chunk_http');
  assert.equal(pollSignal?.aborted, true, 'the long poll was aborted at fallback');
  const out = await s.finish(CTX);
  assert.equal(out.intent, 'OPEN_PAYOUTS');
  assert.equal(calls.filter((c) => c === 'GET partial').length, 1, 'no new poll after fallback');
});
