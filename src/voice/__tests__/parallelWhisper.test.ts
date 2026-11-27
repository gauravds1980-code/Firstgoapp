/**
 * v1.4.2 early-Whisper source (TurnStreams) + device-path parallel stream (settleParallel, auto-off), against a
 * fake fetch and a real StreamSession. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from '../confidenceGate';
import { getEarlyWhisper, setEarlyWhisperSource } from '../earlyWhisper';
import {
  isParallelBroken, isParallelClash, isSilentCapture, parallelDiagText, PARALLEL_ERROR_WINDOW_MS, registerTurnStreams, resetParallelBroken,
  settleParallel, TurnStreams, wantParallelStream, type ParallelCapture, type ParallelOffReason,
} from '../parallelWhisper';
import { rmsDb, StreamSession, type FetchInit } from '../serverStream';
import type { CommandResponse } from '../types';

const BASE = 'http://voice.test';
const CTX = { sessionId: 'sess-1', screen: 'home', expect: undefined };
const turn = (id: number) => ({ id, ctx: CTX, releasedAt: 0 });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Fake voice server: /end answers with a transcript naming the stream id, so each turn's promise is distinguishable. */
function fakeServer(o: { endStatus?: number; transcript?: (id: string) => string } = {}) {
  const calls: { url: string; method: string }[] = [];
  const fetch = async (url: string, init: FetchInit) => {
    calls.push({ url, method: init.method });
    const path = new URL(url).pathname.split('/');
    const id = path[2];
    const step = path[3] ?? '';
    let status = 200;
    let body: unknown = { ok: true };
    if (step === 'chunk') body = { ok: true, partial: null };
    if (step === 'end') {
      status = o.endStatus ?? 200;
      const transcript = o.transcript ? o.transcript(id) : `open payouts ${id}`;
      body = { transcript, confidence: 0.9, intent: 'OPEN_PAYOUTS', score: 0.92, matchedPhrase: 'open payouts', action: { type: 'navigate', route: '/payouts' } };
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

/** What usePcmStream does: push ~100 ms buffers into a StreamSession, track the peak level, hand back finish/cancel. */
async function capture(fetch: ReturnType<typeof fakeServer>['fetch'], id: string, level: number, buffers = 10): Promise<ParallelCapture> {
  const s = new StreamSession({ fetch, baseUrl: BASE, id, flushMs: 200 });
  await s.start(CTX, { sampleRate: 16000 });
  let peakDb = -160;
  for (let i = 0; i < buffers; i++) {
    const b = new Int16Array(1600).fill(level);
    peakDb = Math.max(peakDb, rmsDb(b));
    s.push(b);
    await tick();
  }
  return { kind: 'stream', peakDb, buffers, finish: (ctx, x) => s.finish(ctx, x), cancel: () => s.cancel() };
}

test('registered source returns the stream /end result for the right turn id; null for other turns', async () => {
  resetParallelBroken();
  const srv = fakeServer();
  const streams = new TurnStreams();
  const unmount = registerTurnStreams(streams);
  const offs: ParallelOffReason[] = [];
  streams.set(7, settleParallel(capture(srv.fetch, 'turn7', 3000), CTX, (r) => offs.push(r)));
  const p7 = getEarlyWhisper(turn(7));
  assert.ok(p7, 'a stream is running for turn 7');
  assert.equal(getEarlyWhisper(turn(8)), null, 'no stream for turn 8');
  assert.equal((await p7)?.transcript, 'open payouts turn7');
  // A newer turn replaces the old one (only the latest turn is kept).
  streams.set(8, settleParallel(capture(srv.fetch, 'turn8', 3000), CTX, (r) => offs.push(r)));
  assert.equal(getEarlyWhisper(turn(7)), null);
  assert.equal((await getEarlyWhisper(turn(8)))?.transcript, 'open payouts turn8');
  assert.ok(srv.calls.some((c) => c.url.startsWith(`${BASE}/stream/turn8/end`)), 'turn 8 finished via /end');
  assert.deepEqual(offs, []);
  assert.equal(isParallelBroken(), false);
  unmount();
});

test('null when no stream; null with no source; a rejected stream promise becomes null', async () => {
  const streams = new TurnStreams();
  setEarlyWhisperSource(null);
  assert.equal(getEarlyWhisper(turn(1)), null, 'no source registered');
  const unmount = registerTurnStreams(streams);
  assert.equal(getEarlyWhisper(turn(1)), null, 'source registered, nothing streamed');
  streams.set(2, Promise.reject(new Error('boom')));
  assert.equal(await getEarlyWhisper(turn(2)), null);
  unmount();
});

test('unmount clears the source and its results; it does not clear a newer registration', async () => {
  const a = new TurnStreams();
  const unmountA = registerTurnStreams(a);
  a.set(3, Promise.resolve({ transcript: 'x' } as CommandResponse));
  assert.ok(getEarlyWhisper(turn(3)));
  unmountA();
  assert.equal(getEarlyWhisper(turn(3)), null, 'cleared on unmount');
  assert.equal(a.has(3), false, 'results dropped');
  // Remount order: B registers before A's (late) cleanup runs; A's cleanup must leave B in place.
  const a2 = new TurnStreams();
  const unmountA2 = registerTurnStreams(a2);
  const b = new TurnStreams();
  const unmountB = registerTurnStreams(b);
  b.set(4, Promise.resolve({ transcript: 'y' } as CommandResponse));
  unmountA2();
  assert.equal((await getEarlyWhisper(turn(4)))?.transcript, 'y');
  unmountB();
});

test('silent stream (mic given to the recogniser) → null, no /end, DELETE sent, auto-off for the session + debug text', async () => {
  resetParallelBroken();
  const srv = fakeServer();
  const streams = new TurnStreams();
  const unmount = registerTurnStreams(streams);
  const offs: ParallelOffReason[] = [];
  streams.set(5, settleParallel(capture(srv.fetch, 'quiet', 0), CTX, (r) => offs.push(r)));
  assert.equal(await getEarlyWhisper(turn(5)), null);
  await tick();
  assert.equal(srv.calls.some((c) => c.url.includes('/end')), false, 'no /end for a silent stream');
  assert.equal(srv.calls.some((c) => c.method === 'DELETE'), true, 'stream cancelled');
  assert.deepEqual(offs, ['silent']);
  assert.equal(isParallelBroken(), true);
  assert.equal(wantParallelStream({ path: 'device', settingOn: true, otp: false, pcmAvailable: true }), false, 'off for the rest of the session');
  assert.equal(parallelDiagText('silent'), 'parallel stream off (silent)');
  assert.equal(parallelDiagText('paused'), 'parallel stream paused (silent)');
  // Very low room noise (-66 dBFS) also counts as silence; a real voice does not.
  assert.equal(isSilentCapture(rmsDb(new Int16Array(1600).fill(16)), 10), true);
  assert.equal(isSilentCapture(rmsDb(new Int16Array(1600).fill(1000)), 10), false);
  assert.equal(isSilentCapture(-20, 0), true, 'no buffers at all');
  unmount();
  resetParallelBroken();
});

test('capture failed to start → null + auto-off (mic busy); too short / prompted → null, no auto-off', async () => {
  resetParallelBroken();
  const offs: ParallelOffReason[] = [];
  assert.equal(await settleParallel(Promise.resolve({ kind: 'too_short' }), CTX, (r) => offs.push(r)), null);
  assert.equal(await settleParallel(Promise.resolve({ kind: 'permission_prompted' }), CTX, (r) => offs.push(r)), null);
  assert.equal(await settleParallel(Promise.resolve(null), CTX, (r) => offs.push(r)), null);
  assert.equal(isParallelBroken(), false);
  assert.equal(await settleParallel(Promise.resolve({ kind: 'fallback' }), CTX, (r) => offs.push(r)), null);
  assert.deepEqual(offs, ['capture_failed']);
  assert.equal(isParallelBroken(), true);
  resetParallelBroken();
});

test('Whisper failed or heard nothing → null for the gate, feature stays on', async () => {
  resetParallelBroken();
  const empty = fakeServer({ transcript: () => '' });
  assert.equal(await settleParallel(capture(empty.fetch, 'e1', 3000), CTX, () => {}), null);
  const busy = fakeServer({ endStatus: 409 });
  assert.equal(await settleParallel(capture(busy.fetch, 'b1', 3000), CTX, () => {}), null);
  assert.equal(isParallelBroken(), false);
});

test('start rules: device path + setting on + not OTP + PCM available; recogniser clash codes within the window', () => {
  resetParallelBroken();
  const on = { path: 'device' as const, settingOn: true, otp: false, pcmAvailable: true };
  assert.equal(wantParallelStream(on), true);
  assert.equal(wantParallelStream({ ...on, settingOn: false }), false, 'default off');
  assert.equal(wantParallelStream({ ...on, otp: true }), false, 'never on OTP turns');
  assert.equal(wantParallelStream({ ...on, path: 'server' }), false, 'server path streams anyway');
  assert.equal(wantParallelStream({ ...on, pcmAvailable: false }), false);
  for (const c of ['audio-capture', 'busy', 'client', 'interrupted']) assert.equal(isParallelClash(c, 300), true, c);
  assert.equal(isParallelClash('no-speech', 300), false);
  assert.equal(isParallelClash('network', 300), false);
  assert.equal(isParallelClash('client', PARALLEL_ERROR_WINDOW_MS + 1), false, 'late errors are not blamed on the stream');
  assert.equal(isParallelClash(undefined, 0), false);
});

test('gate: a shaky phone result takes the stream answer as Whisper (stream) without waiting for the cap', async () => {
  resetParallelBroken();
  const srv = fakeServer({ transcript: () => 'open payouts' });
  const streams = new TurnStreams();
  const unmount = registerTurnStreams(streams);
  streams.set(9, settleParallel(capture(srv.fetch, 'g9', 3000), CTX, () => {}));
  const device = { transcript: 'open pay', confidence: 0.4, intent: 'UNKNOWN', score: 0.3, status: 'retry' } as CommandResponse;
  let t = 0;
  const g = await runGate({ shaky: true, wantCheck: false, device, releasedAt: 0, now: () => t, early: getEarlyWhisper(turn(9)), sleep: () => new Promise(() => {}) });
  t = 1;
  assert.equal(g.decision, 'whisper_early');
  assert.equal(g.use, 'whisper');
  assert.equal(g.command.intent, 'OPEN_PAYOUTS');
  unmount();
});

// ---- TurnCheck: one Whisper check per turn (stream /end via earlyWhisper.ts, or the WAV upload) ----
import { TurnCheck } from '../parallelWhisper';
import { voiceTranscript } from '../voiceTranscript';

const answer = (transcript: string): CommandResponse => ({ transcript, confidence: 0.9, intent: 'OPEN_PAYOUTS', score: 0.92, matchedPhrase: 'open payouts', action: { type: 'navigate', route: '/payouts' } } as CommandResponse);

/** What useVoiceCommand does: deliver = onCheck → (use_server) publishes `live` with source 'server' → the transcript. */
function hookLike(turnId: number) {
  const got: { text: string; from: string }[] = [];
  const check = new TurnCheck((r, from) => {
    got.push({ text: r.transcript, from });
    voiceTranscript.live({ text: r.transcript, final: true, source: 'server', turn: turnId });
  });
  return { check, got };
}

test('check: the streamed /end (read through getEarlyWhisper) is the turn\'s Whisper check; the later WAV answer is dropped', async () => {
  voiceTranscript.clear();
  const streams = new TurnStreams();
  const off = registerTurnStreams(streams);
  const { check, got } = hookLike(7);
  // Phone final first (device line), then release registers the stream, then the turn is handled.
  voiceTranscript.live({ text: 'show my pay outs', final: true, source: 'device', turn: 7 });
  streams.set(7, Promise.resolve(answer('show my payouts')));
  void getEarlyWhisper(turn(7))?.then((r) => check.stream(r));
  check.ready();
  await tick();
  assert.deepEqual(got, [{ text: 'show my payouts', from: 'stream' }]);
  assert.equal(check.needWav, false, 'no WAV upload once the stream answered');
  check.wav(answer('show my payouts')); // a WAV check already in flight lands later
  assert.equal(got.length, 1);
  const dealer = voiceTranscript.entries().filter((e) => e.role === 'dealer');
  assert.equal(dealer.length, 1, 'one line for the turn, corrected in place');
  assert.equal(dealer[0].role === 'dealer' && dealer[0].source, 'server');
  assert.equal(dealer[0].role === 'dealer' && dealer[0].text, 'show my payouts');
  off();
  voiceTranscript.clear();
});

test('check: a stream answer before the phone final is held until ready(); WAV first wins and the stream is dropped', async () => {
  const a = hookLike(1);
  a.check.stream(answer('go home'));
  assert.equal(a.got.length, 0, 'held: the turn has no phone result yet');
  a.check.ready();
  assert.deepEqual(a.got, [{ text: 'go home', from: 'stream' }]);

  const b = hookLike(2);
  b.check.ready();
  b.check.wav(answer('open leads'));
  b.check.stream(answer('open leads'));
  assert.deepEqual(b.got, [{ text: 'open leads', from: 'wav' }]);
});

test('check: null / empty stream answers are ignored (WAV still runs); settle() (gate used Whisper) drops both', () => {
  const a = hookLike(3);
  a.check.ready();
  a.check.stream(null);
  a.check.stream(answer('  '));
  assert.equal(a.check.needWav, true);
  a.check.wav(answer('open payouts'));
  assert.equal(a.got.length, 1);

  const b = hookLike(4);
  b.check.stream(answer('go home')); // held
  b.check.settle();
  b.check.ready();
  b.check.wav(answer('go home'));
  assert.equal(b.got.length, 0);
  assert.equal(b.check.needWav, false);
});

test('check + gate: a shaky turn gets the stream answer once, whether the gate or the check sees it first', async () => {
  const streams = new TurnStreams();
  const off = registerTurnStreams(streams);
  streams.set(9, Promise.resolve(answer('open payouts')));
  let gateResolve: ((r: CommandResponse | null) => void) | null = null;
  const whisper = new Promise<CommandResponse | null>((res) => { gateResolve = res; });
  let reconciled = 0;
  // onCheck: hands the answer to the waiting gate, else reconciles.
  const check = new TurnCheck((r) => { if (gateResolve) { const g = gateResolve; gateResolve = null; g(r); } else reconciled += 1; });
  void getEarlyWhisper(turn(9))?.then((r) => check.stream(r));
  check.ready();
  const device: CommandResponse = { transcript: 'open pay', confidence: 0.4, intent: 'OPEN_PAYOUTS', score: 0.6, status: 'clarify', matchedPhrase: 'open payouts', action: { type: 'navigate', route: '/payouts' } } as CommandResponse;
  const g = await runGate({ shaky: true, wantCheck: true, device, releasedAt: Date.now(), now: () => Date.now(), whisper, early: getEarlyWhisper(turn(9)) });
  assert.equal(g.use, 'whisper');
  if (g.use === 'whisper') check.settle();
  check.wav(answer('open payouts'));
  assert.equal(reconciled, 0, 'no second reconcile after the gate used Whisper');
  off();
});

test('streaming fails mid-turn (chunk 500): the early-Whisper source resolves with the WAV /command answer', async () => {
  resetParallelBroken();
  const calls: { url: string; method: string }[] = [];
  const fetch = async (url: string, init: FetchInit) => {
    calls.push({ url, method: init.method });
    const p = new URL(url).pathname;
    const fail = p.endsWith('/chunk') && new URL(url).searchParams.get('seq') === '1';
    const body = p === '/command'
      ? { transcript: 'open payouts via wav', confidence: 0.9, intent: 'OPEN_PAYOUTS', score: 0.92, matchedPhrase: 'open payouts', action: { type: 'navigate', route: '/payouts' } }
      : { ok: true, partial: null };
    const status = fail ? 500 : 200;
    return { ok: !fail, status, json: async () => body };
  };
  const streams = new TurnStreams();
  const unmount = registerTurnStreams(streams);
  const cap = await capture(fetch, 's-fail', 3000);
  streams.set(7, settleParallel(Promise.resolve(cap), CTX, () => assert.fail('no auto-off on a stream failure')));
  const r = await getEarlyWhisper(turn(7));
  assert.equal(r?.transcript, 'open payouts via wav');
  assert.ok(calls.some((c) => new URL(c.url).pathname === '/command' && c.method === 'POST'), 'whole-clip WAV upload used');
  assert.ok(!calls.some((c) => c.url.includes('/end')), 'no /end after the stream failed');
  assert.ok(calls.some((c) => c.method === 'DELETE'));
  assert.equal(isParallelBroken(), false);
  unmount();
});
