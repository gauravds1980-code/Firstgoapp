/**
 * v1.4.2 voice backtest logging (pure core). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLogBody, createVoiceTurnLog, deliveredOutcome, failureOutcome, INSTALL_ID_KEY, isOtpTurn, newTurnId, normalizeOutcome, reasonToken, sha256Hex,
  shouldAttachClip, turnEndRecord, TURN_OUTCOMES, type FetchLike, type KeyValueStorage,
} from '../voiceTurnLog';

function memStorage(init: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: async (k) => data[k] ?? null, set: async (k, v) => { data[k] = v; } };
}

function recorder() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  return { calls, fetch };
}

const setup = (over: { fetch?: FetchLike; storage?: KeyValueStorage; base?: string } = {}) => {
  const rec = recorder();
  const storage = over.storage ?? memStorage();
  const log = createVoiceTurnLog({
    fetch: over.fetch ?? rec.fetch, storage, baseUrl: () => over.base ?? 'http://test:8797', platform: 'android', appVersion: '1.4.2',
  });
  return { log, calls: rec.calls, storage };
};

test('sha256Hex matches known vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('a'.repeat(1000)).length, 64);
});

test('OTP turns are never posted', async () => {
  const { log, calls } = setup();
  assert.equal(await log.postDeviceTurn({ turnId: 'o1', expect: 'otp', deviceTranscript: '482917' }), false);
  assert.equal(await log.postDeviceTurn({ turnId: 'o2', otp: true, deviceTranscript: '482917' }), false);
  assert.equal(await log.postDeviceTurn({ turnId: 'o3', hasOtpField: true, deviceTranscript: '4829' }), false);
  assert.equal(calls.length, 0);
  assert.equal(buildLogBody({ expect: 'OTP', audioBase64: 'AAAA' }), null);
  assert.ok(isOtpTurn({ expect: ' otp ' }));
  assert.ok(!isOtpTurn({ expect: 'phone' }));
});

test('non-OTP turn posts /log with the expected fields', async () => {
  const { log, calls } = setup();
  const ok = await log.postDeviceTurn({
    turnId: 't-1', path: 'device', deviceTranscript: 'open portfolio', deviceConfidence: 0.9, transcript: 'open portfolio',
    intent: 'OPEN_PORTFOLIO', score: 0.97, band: 'auto', method: 'keyword', screen: 'Home', context: { route: 'Home' }, outcome: 'auto',
    candidates: [{ intent: 'OPEN_PORTFOLIO', score: 0.97, phrase: 'open portfolio' }], audioBase64: 'UklGRg==',
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const [{ url, body }] = calls;
  assert.equal(url, 'http://test:8797/log');
  for (const [k, v] of Object.entries({
    turnId: 't-1', path: 'device', deviceTranscript: 'open portfolio', deviceConfidence: 0.9, intent: 'OPEN_PORTFOLIO', score: 0.97,
    band: 'auto', method: 'keyword', screen: 'Home', outcome: 'executed', reason: 'auto', appVersion: '1.4.2', platform: 'android', audioBase64: 'UklGRg==', mimeType: 'audio/wav',
  })) assert.deepEqual(body[k], v, k);
  assert.match(String(body.deviceIdHash), /^[0-9a-f]{64}$/);
  assert.ok(!('otp' in body));
});

test('fire-and-forget never throws into the caller', async () => {
  const { log } = setup({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(await log.postDeviceTurn({ turnId: 'x', deviceTranscript: 'hi' }), false);
  const broken: KeyValueStorage = { get: async () => { throw new Error('keystore'); }, set: async () => { throw new Error('keystore'); } };
  const b = setup({ storage: broken });
  assert.equal(await b.log.postDeviceTurn({ turnId: 'y', deviceTranscript: 'hi' }), true);
  assert.ok(!('deviceIdHash' in b.calls[0].body));
  // Synchronous throw from fetch is caught too.
  const s = setup({ fetch: () => { throw new Error('sync'); } });
  assert.equal(await s.log.postDeviceTurn({ deviceTranscript: 'hi' }), false);
});

test('voice not configured: nothing is posted', async () => {
  const { log, calls } = setup({ base: '' });
  assert.equal(await log.postDeviceTurn({ deviceTranscript: 'open portfolio' }), false);
  assert.equal(calls.length, 0);
});

test('device id is hashed and stable; raw id never on the wire', async () => {
  const storage = memStorage({ [INSTALL_ID_KEY]: 'raw-install-id-1234' });
  const { log, calls } = setup({ storage });
  await log.postDeviceTurn({ deviceTranscript: 'open cases' });
  await log.postDeviceTurn({ deviceTranscript: 'open offer' });
  const wire = JSON.stringify(calls.map((c) => c.body));
  assert.ok(!wire.includes('raw-install-id-1234'));
  assert.equal(calls[0].body.deviceIdHash, sha256Hex('raw-install-id-1234'));
  assert.equal(calls[1].body.deviceIdHash, calls[0].body.deviceIdHash);
  assert.equal(log.meta({ turnId: 'm' }).deviceIdHash, sha256Hex('raw-install-id-1234'));

  const fresh = memStorage();
  const f = setup({ storage: fresh });
  const h = await f.log.deviceIdHash();
  assert.ok(fresh.data[INSTALL_ID_KEY] && fresh.data[INSTALL_ID_KEY].length >= 16);
  assert.equal(h, sha256Hex(fresh.data[INSTALL_ID_KEY]));
});

test('turn ids are short and unique', () => {
  const a = newTurnId(1_700_000_000_000);
  const b = newTurnId(1_700_000_000_000);
  assert.match(a, /^[0-9a-z]+-[0-9a-f]{6}$/);
  assert.notEqual(a, b);
});

test('no consent / recording copy in the logging modules', () => {
  // Compiled tests run from .voicetest/voice/__tests__; the sources live in src/voice.
  const root = join(__dirname, '..', '..', '..', 'src', 'voice');
  for (const f of ['voiceTurnLog.ts', 'voiceTurnLogApp.ts']) {
    const src = readFileSync(join(root, f), 'utf8').toLowerCase();
    for (const bad of ['consent', "don't record", 'do not record', 'opt out', 'opt-out', 'we record', 'recording is on']) {
      assert.ok(!src.includes(bad), `${f} contains "${bad}"`);
    }
  }
});

// ---- v1.4.2 outcomes: executed | confirm | unmatched | dropped | error ---------------------------------------

test('old outcome values are mapped to the five outcomes at the helper', () => {
  const cases: [string, string, string][] = [
    ['auto', 'executed', 'auto'], ['confirmed', 'executed', 'confirmed'], ['preview', 'confirm', 'preview'], ['clarify', 'confirm', 'clarify'],
    ['retry', 'unmatched', 'retry'], ['too_short', 'dropped', 'too_short'], ['cancelled', 'dropped', 'cancelled'], ['prompted', 'dropped', 'prompted'],
    ['permission_denied', 'dropped', 'permission'], ['no_speech', 'error', 'no_speech'], ['network', 'error', 'network'], ['timeout', 'error', 'timeout'],
    ['http', 'error', 'http'], ['asr_fallback_turn', 'error', 'asr_fallback_turn'], ['busy', 'error', 'busy'], ['Weird Thing!', 'error', 'weird_thing'],
  ];
  for (const [old, outcome, reason] of cases) {
    assert.deepEqual(normalizeOutcome(old), { outcome, reason }, old);
    assert.deepEqual(buildLogBody({ turnId: 't', outcome: old }), { turnId: 't', outcome, reason }, old);
  }
  // New values pass through with their reason; an explicit reason wins over the legacy one.
  assert.deepEqual(normalizeOutcome('unmatched', 'below_floor'), { outcome: 'unmatched', reason: 'below_floor' });
  assert.deepEqual(normalizeOutcome('retry', 'below_floor'), { outcome: 'unmatched', reason: 'below_floor' });
  assert.deepEqual(normalizeOutcome(undefined, 'too_short'), { outcome: 'dropped', reason: 'too_short' });
  assert.deepEqual(normalizeOutcome(undefined, undefined), {});
  assert.equal(reasonToken('  ASR busy-now '), 'asr_busy_now');
  assert.equal(reasonToken('x'.repeat(80))!.length, 32);
  for (const o of TURN_OUTCOMES) assert.equal(normalizeOutcome(o).outcome, o);
});

test('delivered results: executed / confirm / unmatched with a reason', () => {
  const ok = { status: 'ok', intent: 'OPEN_PORTFOLIO', score: 0.97, transcript: 'open portfolio' };
  assert.deepEqual(deliveredOutcome(ok, true), { outcome: 'executed', reason: 'auto' });
  assert.deepEqual(deliveredOutcome(ok, false), { outcome: 'confirm', reason: 'preview' });
  assert.deepEqual(deliveredOutcome({ ...ok, status: 'clarify' }, false), { outcome: 'confirm', reason: 'clarify' });
  assert.deepEqual(deliveredOutcome({ status: 'clarify', intent: 'UNKNOWN', score: 0.6, transcript: 'open port', candidates: [{}] }, false),
    { outcome: 'confirm', reason: 'did_you_mean' });
  assert.deepEqual(deliveredOutcome({ status: 'retry', intent: 'UNKNOWN', score: 0.5, transcript: 'x', candidates: [{}] }, false),
    { outcome: 'confirm', reason: 'did_you_mean' });
  // The Vida case: "select Vida" → fuzzy 0.412 below the floor, band retry, no candidates.
  assert.deepEqual(deliveredOutcome({ status: 'retry', intent: 'UNKNOWN', score: 0.412, transcript: 'select Vida', candidates: [] }, false),
    { outcome: 'unmatched', reason: 'below_floor' });
  assert.deepEqual(deliveredOutcome({ status: 'retry', intent: 'UNKNOWN', score: 0, transcript: 'blah' }, false), { outcome: 'unmatched', reason: 'no_candidates' });
  assert.deepEqual(deliveredOutcome({ status: 'retry', intent: 'UNKNOWN', score: 0, transcript: '' }, false), { outcome: 'unmatched', reason: 'nothing' });
  assert.deepEqual(deliveredOutcome({ status: 'reprompt', intent: 'FILL_PHONE', score: 0, transcript: 'um' }, false), { outcome: 'unmatched', reason: 'retry' });
});

test('failures: dropped vs error with a reason', () => {
  assert.deepEqual(failureOutcome('too_short'), { outcome: 'dropped', reason: 'too_short' });
  assert.deepEqual(failureOutcome('cancelled'), { outcome: 'dropped', reason: 'cancelled' });
  assert.deepEqual(failureOutcome('permission'), { outcome: 'dropped', reason: 'permission' });
  assert.deepEqual(failureOutcome('asr_permission'), { outcome: 'dropped', reason: 'permission' });
  assert.deepEqual(failureOutcome('prompted'), { outcome: 'dropped', reason: 'prompted' });
  assert.deepEqual(failureOutcome('no_speech'), { outcome: 'error', reason: 'no_speech' });
  assert.deepEqual(failureOutcome('network'), { outcome: 'error', reason: 'network' });
  assert.deepEqual(failureOutcome('timeout'), { outcome: 'error', reason: 'timeout' });
  assert.deepEqual(failureOutcome('http'), { outcome: 'error', reason: 'http' });
  assert.deepEqual(failureOutcome('asr_retry_network'), { outcome: 'error', reason: 'asr_retry_network' });
  assert.deepEqual(failureOutcome(undefined), { outcome: 'error', reason: 'error' });
  // A failure code that happens to be a "success" word is still not a success.
  assert.deepEqual(failureOutcome('auto'), { outcome: 'error', reason: 'auto' });
});

test('fail / too_short / cancel / no_speech turns are posted to /log with what was heard', async () => {
  const { log, calls } = setup();
  const base = { path: 'device+check' as const, screen: 'Asset', route: 'Asset' };
  const ends = [
    { turnId: 'e1', ...failureOutcome('network'), deviceText: 'select Vida', deviceConfidence: 0.7 },
    { turnId: 'e2', ...failureOutcome('timeout'), deviceText: 'select Vida' },
    { turnId: 'd1', ...failureOutcome('too_short') },
    { turnId: 'd2', ...failureOutcome('cancelled'), partial: 'select vi' },
    { turnId: 'e3', ...failureOutcome('no_speech') },
  ];
  for (const e of ends) assert.equal(await log.postDeviceTurn(turnEndRecord({ ...base, ...e })!), true);
  assert.equal(calls.length, 5);
  const by = Object.fromEntries(calls.map((c) => [c.body.turnId, c.body]));
  assert.equal(by.e1.outcome, 'error'); assert.equal(by.e1.reason, 'network');
  assert.equal(by.e1.deviceTranscript, 'select Vida'); assert.equal(by.e1.transcript, 'select Vida'); assert.equal(by.e1.deviceConfidence, 0.7);
  assert.deepEqual(by.e1.context, { route: 'Asset' }); assert.equal(by.e1.screen, 'Asset'); assert.equal(by.e1.path, 'device+check');
  assert.equal(by.e2.reason, 'timeout');
  assert.equal(by.d1.outcome, 'dropped'); assert.equal(by.d1.reason, 'too_short'); assert.ok(!('transcript' in by.d1));
  assert.equal(by.d2.outcome, 'dropped'); assert.equal(by.d2.reason, 'cancelled'); assert.equal(by.d2.transcript, 'select vi');
  assert.equal(by.e3.outcome, 'error'); assert.equal(by.e3.reason, 'no_speech');
  for (const c of calls) assert.ok(TURN_OUTCOMES.includes(c.body.outcome as never));
});

test('dropped / error turns attach the clip when one exists and no check took it', async () => {
  assert.equal(shouldAttachClip({ audioUri: 'file:///c.wav', checkStarted: false }), true);
  assert.equal(shouldAttachClip({ audioUri: 'file:///c.wav', checkStarted: true }), false);
  assert.equal(shouldAttachClip({ audioUri: null }), false);
  assert.equal(shouldAttachClip({ audioUri: 'file:///c.wav', otp: true }), false);
  const { log, calls } = setup();
  await log.postDeviceTurn(turnEndRecord({ turnId: 'c1', path: 'device+check', ...failureOutcome('too_short'), audioBase64: 'UklGRg==' })!);
  await log.postDeviceTurn(turnEndRecord({ turnId: 'c2', path: 'device', ...failureOutcome('asr_fallback_turn'), partial: 'open', audioBase64: 'UklGRg==' })!);
  for (const c of calls) { assert.equal(c.body.audioBase64, 'UklGRg=='); assert.equal(c.body.mimeType, 'audio/wav'); }
  assert.equal(calls[1].body.outcome, 'error'); assert.equal(calls[1].body.reason, 'asr_fallback_turn');
});

test('OTP turns that fail or drop are still never posted', async () => {
  const { log, calls } = setup();
  assert.equal(turnEndRecord({ turnId: 'o1', path: 'device', ...failureOutcome('network'), otp: true, deviceText: '482917', audioBase64: 'AAAA' }), null);
  assert.equal(turnEndRecord({ turnId: 'o2', path: 'server', ...failureOutcome('too_short'), expect: 'otp', partial: '4829' }), null);
  // Even if a record slipped through with an OTP flag, the poster refuses it.
  assert.equal(await log.postDeviceTurn({ turnId: 'o3', outcome: 'error', reason: 'network', expect: 'otp', deviceTranscript: '482917' }), false);
  assert.equal(calls.length, 0);
});

test('after-the-fact outcome lines carry the new vocabulary', async () => {
  const { log, calls } = setup();
  await log.postDeviceTurn({ turnId: 'p1', outcome: 'executed', reason: 'confirmed' });
  await log.postDeviceTurn({ turnId: 'p2', outcome: 'confirmed' });
  await log.postDeviceTurn({ turnId: 'p3', outcome: 'dropped', reason: 'dismissed' });
  assert.deepEqual(calls.map((c) => [c.body.outcome, c.body.reason]), [['executed', 'confirmed'], ['executed', 'confirmed'], ['dropped', 'dismissed']]);
});

test('useVoiceCommand: every turn ending also posts /log', () => {
  // Thin hook guard (the hook needs React Native, so read its source): each voiceMetrics.end(...) is paired with a
  // /log helper on the same or the next line, so no ending (drop, error, delivered) is missing from the server log.
  const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'voice', 'useVoiceCommand.ts'), 'utf8').split('\n');
  const ends = src.map((l, i) => [l, i] as const).filter(([l]) => l.includes('voiceMetrics.end('));
  assert.ok(ends.length >= 10, `found ${ends.length} endings`);
  for (const [l, i] of ends) {
    const near = `${l}\n${src[i + 1] ?? ''}`;
    assert.match(near, /logTurnEnd\(|logDelivered\(/, `line ${i + 1}: ${l.trim()}`);
  }
  assert.ok(!src.join('\n').includes('logDeviceTurn('), 'deliver() goes through logDelivered');
});
