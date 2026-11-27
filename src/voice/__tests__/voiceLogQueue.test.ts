/**
 * v1.4.5 /log offline queue: persistence, bounds, ordered flush, flush on recovery, OTP masking, never audio; and the
 * "No connection" rule when every route is down. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localCommand, matchCommand } from '../intentMatcher';
import { NO_CONNECTION, offlineVerdict } from '../optionResolver';
import type { CommandResponse } from '../types';
import { createLogQueue, isOtpLogBody, LOG_QUEUE_KEY, maskDigitRuns, OTP_MASK, sanitizeQueuedBody } from '../voiceLogQueue';
import { createRouteManager, type RouteFetch } from '../voiceRoutes';
import { createVoiceTurnLog, type FetchLike } from '../voiceTurnLog';

const memStore = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
};

test('digit runs: 4+ spaced digits or digit words are masked; short numbers stay', () => {
  assert.equal(maskDigitRuns('otp is 4 5 6 7'), `otp is ${OTP_MASK}`);
  assert.equal(maskDigitRuns('four five six seven please'), `${OTP_MASK} please`);
  assert.equal(maskDigitRuns('call 98765 43210 now'), `call ${OTP_MASK} now`);
  assert.equal(maskDigitRuns('ek do teen char'), OTP_MASK);
  assert.equal(maskDigitRuns('double five six seven'), OTP_MASK);
  assert.equal(maskDigitRuns('tenure 24 months'), 'tenure 24 months');
  assert.equal(maskDigitRuns('xtreme 125 r'), 'xtreme 125 r');
  assert.equal(maskDigitRuns('open payouts'), 'open payouts');
  assert.equal(maskDigitRuns('one two'), 'one two');
});

test('OTP turns: by flag, expect, or screen (Esign, DealerOtp, consent OTP)', () => {
  assert.equal(isOtpLogBody({}, true), true);
  assert.equal(isOtpLogBody({ expect: 'otp' }), true);
  assert.equal(isOtpLogBody({ screen: 'Esign' }), true);
  assert.equal(isOtpLogBody({ screen: 'DealerOtp' }), true);
  assert.equal(isOtpLogBody({ context: { route: 'ConsentOtp' } }), true);
  assert.equal(isOtpLogBody({ screen: 'Home' }), false);
});

test('sanitise: never audio; OTP transcript fully masked; digit runs masked elsewhere', () => {
  const otp = sanitizeQueuedBody({ turnId: 't', transcript: '1 2 3 4 5 6', deviceTranscript: 'one two three', screen: 'Esign', audioBase64: 'AAAA', mimeType: 'audio/wav' });
  assert.equal(otp.transcript, OTP_MASK);
  assert.equal(otp.deviceTranscript, OTP_MASK);
  assert.equal(otp.audioBase64, undefined);
  assert.equal(otp.mimeType, undefined);
  assert.equal(otp.otp, true);
  const plain = sanitizeQueuedBody({ transcript: 'mobile 9 8 7 6 5', candidates: [{ intent: 'X', phrase: '1 2 3 4' }], audioBase64: 'AAAA' });
  assert.equal(plain.transcript, `mobile ${OTP_MASK}`);
  assert.deepEqual(plain.candidates, [{ intent: 'X', phrase: OTP_MASK }]);
  assert.ok(!('audioBase64' in plain));
  assert.ok(!JSON.stringify(plain).includes('AAAA'));
});

test('queue: persisted, bounded (count and age, oldest dropped), resent in order, stops on a route failure', async () => {
  let t = 1_000_000;
  const store = memStore();
  const q = createLogQueue({ storage: store, now: () => t, max: 3, maxAgeMs: 60_000 });
  for (const i of [1, 2, 3, 4]) { await q.enqueue({ turnId: `t${i}` }); t += 1000; }
  assert.deepEqual((await q.peek()).map((e) => e.body.turnId), ['t2', 't3', 't4']);
  assert.equal(JSON.parse(store.m.get(LOG_QUEUE_KEY)!).length, 3);

  // A fresh queue (app restart) reads the file.
  const q2 = createLogQueue({ storage: store, now: () => t, max: 3, maxAgeMs: 60_000 });
  const sent: string[] = [];
  let up = true;
  const r = await q2.flush(async (b) => { if (!up) return 'route'; sent.push(String(b.turnId)); assert.equal(b.queued, true); if (b.turnId === 't3') up = false; return 'ok'; });
  assert.deepEqual(sent, ['t2', 't3']);
  assert.equal(r.left, 1);
  assert.deepEqual(JSON.parse(store.m.get(LOG_QUEUE_KEY)!).map((e: { body: { turnId: string } }) => e.body.turnId), ['t4']);

  // Older than a day (here 60 s): dropped on load.
  t += 120_000;
  const q3 = createLogQueue({ storage: store, now: () => t, max: 3, maxAgeMs: 60_000 });
  assert.equal((await q3.peek()).length, 0);
});

test('queue: the server refusing an entry (4xx JSON) drops it instead of retrying forever', async () => {
  const q = createLogQueue({ storage: memStore() });
  await q.enqueue({ turnId: 'bad' });
  await q.enqueue({ turnId: 'good' });
  const r = await q.flush(async (b) => (b.turnId === 'bad' ? 'app' : 'ok'));
  assert.deepEqual(r, { sent: 1, dropped: 1, left: 0 });
});

test('a file written by an older build is re-sanitised on load (no audio, no OTP digits)', async () => {
  const store = memStore();
  store.m.set(LOG_QUEUE_KEY, JSON.stringify([{ at: Date.now(), body: { turnId: 'x', transcript: '1 2 3 4 5 6', expect: 'otp', audioBase64: 'AAAA' } }]));
  const [e] = await createLogQueue({ storage: store }).peek();
  assert.equal(e.body.transcript, OTP_MASK);
  assert.equal(e.body.audioBase64, undefined);
});

/** /log end to end: route down → queued (no audio) → route recovers → flushed in order. */
test('postDeviceTurn: queued on a route failure, flushed when the route recovers', async () => {
  const store = memStore();
  const qStore = memStore();
  let up = false;
  const posted: Record<string, unknown>[] = [];
  const BASE = 'https://a.exp.direct/voice';
  const fetch: FetchLike = async (_url, init) => {
    if (!up) return { status: 404, headers: { get: () => 'text/html' }, text: async () => '<html>ngrok</html>' };
    posted.push(JSON.parse(init.body));
    return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => '{}' };
  };
  const probeFetch: RouteFetch = async () => (up ? { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}' } : Promise.reject(new TypeError('down')));
  let now = 5_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  const routes = createRouteManager({
    baked: [BASE], fetch: probeFetch, now: () => now,
    setTimer: (fn, ms) => { const x = { at: now + ms, fn }; timers.push(x); return x; },
    clearTimer: (h) => { const i = timers.indexOf(h as { at: number; fn: () => void }); if (i >= 0) timers.splice(i, 1); },
  });
  const queue = createLogQueue({ storage: qStore });
  const log = createVoiceTurnLog({
    fetch, storage: store, baseUrl: () => routes.current(), platform: 'android', appVersion: '1.4.5', queue,
    report: (b, o) => routes.report(b, o),
  });
  routes.onRecover(() => { void log.flushQueue(); });

  assert.equal(await log.postDeviceTurn({ turnId: 't1', outcome: 'executed', reason: 'auto', transcript: 'open payouts', audioBase64: 'CLIP', mimeType: 'audio/wav' }), false);
  assert.equal(await log.postDeviceTurn({ turnId: 't2', outcome: 'error', reason: 'network', transcript: 'mobile 9 8 7 6 5 4 3 2 1 0' }), false);
  assert.equal(await log.postDeviceTurn({ turnId: 't3', otp: true, transcript: '1 2 3 4 5 6' }), false, 'OTP turns are never posted');
  const saved = qStore.m.get('firstgo.voice.logQueue.v1')!;
  assert.ok(!saved.includes('CLIP'), 'no audio persisted');
  assert.ok(!saved.includes('9 8 7 6'), 'digit runs masked before persisting');
  assert.ok(!saved.includes('1 2 3 4 5 6'));
  assert.equal(routes.allDown(), true);

  up = true;
  now += 1000;
  const due = timers.splice(0).filter((x) => x.at <= now);
  for (const d of due) d.fn();
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  assert.equal(routes.allDown(), false);
  assert.deepEqual(posted.map((b) => b.turnId), ['t1', 't2']);
  assert.ok(posted.every((b) => b.queued === true && !('audioBase64' in b)));
  assert.equal(queue.size(), 0);
  routes.stop();
});

test('flushQueue on app start resends what an earlier session queued', async () => {
  const qStore = memStore();
  qStore.m.set('firstgo.voice.logQueue.v1', JSON.stringify([{ at: Date.now(), body: { turnId: 'old1' } }, { at: Date.now(), body: { turnId: 'old2' } }]));
  const posted: string[] = [];
  const log = createVoiceTurnLog({
    fetch: async (_u, init) => { posted.push(JSON.parse(init.body).turnId); return { status: 200 }; },
    storage: memStore(), baseUrl: () => 'https://a.b/voice', platform: 'android', appVersion: '1.4.5', queue: createLogQueue({ storage: qStore }),
  });
  assert.deepEqual(await log.flushQueue(), { sent: 2, dropped: 0, left: 0 });
  assert.deepEqual(posted, ['old1', 'old2']);
});

// ---- "No connection" when every route is down ------------------------------------------------

const cmd = (over: Partial<CommandResponse>): CommandResponse => ({
  transcript: 'x', confidence: 0.9, intent: 'UNKNOWN', score: 0, matchedPhrase: null, action: { type: 'none' }, ...over,
});

test('no connection: every route down and the phone is unsure → NO_CONNECTION; sure results still run', () => {
  assert.equal(NO_CONNECTION, 'No connection — try again or tap it');
  const retry = localCommand('blorp zing wobble', matchCommand('blorp zing wobble'), 0.9);
  assert.equal(retry.status, 'retry');
  assert.equal(offlineVerdict(retry, true), 'no_connection');
  assert.equal(offlineVerdict(retry, false), 'deliver', 'with a route up nothing changes');
  assert.equal(offlineVerdict(cmd({ status: 'clarify', candidates: [{ intent: 'OPEN_PAYOUTS', phrase: 'open payouts', score: 0.7 }] }), true), 'no_connection');
  assert.equal(offlineVerdict(cmd({ status: 'ok', intent: 'OPEN_PAYOUTS', score: 0.7, action: { type: 'navigate', route: 'Payouts' }, confidenceBand: 'confirm', autoExecute: false }), true), 'no_connection', 'fuzzy Did you mean');
  const sure = localCommand('open payouts', matchCommand('open payouts'), 0.9);
  assert.equal(sure.autoExecute, true);
  assert.equal(offlineVerdict(sure, true), 'deliver');
  assert.equal(offlineVerdict(cmd({ status: 'ok', intent: 'SELECT_VEHICLE_MODEL', score: 0.95, action: { type: 'select', id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R' }, autoExecute: true, confidenceBand: 'auto' }), true), 'deliver', 'on-screen chip auto-select');
  assert.equal(offlineVerdict(cmd({ status: 'ok', intent: 'START_ESIGN', score: 0.95, action: { type: 'navigate', route: 'Esign' }, confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive' }), true), 'deliver');
});
