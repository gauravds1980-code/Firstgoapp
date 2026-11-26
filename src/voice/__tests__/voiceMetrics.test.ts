/**
 * v1.4.0 voice latency metrics + mode / fallback logic (pure). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceMetrics, maskDigits, percentile } from '../voiceMetrics';
import {
  chooseAsrPath, classifyAsrError, contextualStrings, createEndpointer, didYouMeanFrom, oneTapActs, reconcile, recognizerLang, defaultOnDeviceAsr,
} from '../voiceMode';
import { localCommand, matchCommand } from '../intentMatcher';
import { shouldAutoExecute } from '../voiceLogic';

test('percentile: nearest rank p50 / p95', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(xs, 50), 50);
  assert.equal(percentile(xs, 95), 95);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([300, 100, 200], 50), 200);
  assert.equal(percentile([1, 2, 3, 4, 1000], 95), 1000);
});

test('turn spans, summary and the 50-turn rolling buffer', () => {
  let t = 0;
  const m = createVoiceMetrics({ clock: () => t });
  for (let i = 0; i < 60; i++) {
    t = i * 1000;
    const id = m.start({ mode: 'ptt' });
    m.mark(id, 'feedback', t + 20 + (i % 10));
    m.mark(id, 'release', t + 500);
    m.mark(id, 'finalText', t + 500 + 100);
    m.mark(id, 'action', t + 500 + 150 + i);
    m.end(id, { path: 'device', matcher: 'keyword', outcome: 'auto' });
  }
  assert.equal(m.turns().length, 50);
  const s = m.summary();
  assert.equal(s.pressToFeedback.n, 50);
  assert.equal(s.releaseToText.p50, 100);
  assert.equal(s.releaseToAction.max, 150 + 59);
  assert.equal(s.releaseToAction.target, 700);
  assert.equal(s.releaseToAudio.n, 0);
  assert.equal(s.releaseToAudio.p95, null);
});

test('first mark wins; marks on unknown turns are ignored', () => {
  let t = 0;
  const m = createVoiceMetrics({ clock: () => t });
  const id = m.start();
  m.mark(id, 'feedback', 30);
  m.mark(id, 'feedback', 90);
  m.mark(999, 'feedback', 5);
  assert.equal(m.span(m.turns()[0], 'pressToFeedback'), 30);
});

test('OTP safety: notes / outcomes are digit-masked and log lines carry no digits from text', () => {
  const lines: string[] = [];
  const m = createVoiceMetrics({ clock: () => 0, log: (l) => lines.push(l) });
  const id = m.start({ note: 'otp 482913' });
  m.end(id, { outcome: 'filled 482913', note: 'my otp is 4 8 2 9 1 3' });
  const t = m.turns()[0];
  assert.equal(t.note?.includes('4'), false);
  assert.equal(t.outcome?.includes('482913'), false);
  assert.equal(lines.length, 1);
  assert.equal(/482913|4 8 2 9/.test(lines[0]), false);
  assert.equal(maskDigits('OTP 1234'), 'OTP ••••');
  // The Turn type has no transcript field at all.
  assert.equal(Object.keys(t).includes('transcript'), false);
});

test('ASR path: device only when flag + native module + service are all there', () => {
  const env = { platform: 'android', flagOn: true, moduleLoaded: true, recognitionAvailable: true, disabledThisSession: false };
  assert.equal(chooseAsrPath(env), 'device');
  assert.equal(chooseAsrPath({ ...env, platform: 'web' }), 'server');
  assert.equal(chooseAsrPath({ ...env, flagOn: false }), 'server');
  assert.equal(chooseAsrPath({ ...env, moduleLoaded: false }), 'server', 'Expo Go / old dev build');
  assert.equal(chooseAsrPath({ ...env, recognitionAvailable: false }), 'server', 'no recognition service');
  assert.equal(chooseAsrPath({ ...env, disabledThisSession: true }), 'server');
  assert.equal(defaultOnDeviceAsr('web'), false);
  assert.equal(defaultOnDeviceAsr('android'), true);
  assert.equal(defaultOnDeviceAsr('ios'), true);
});

test('recognizer errors: disable for the session, fall back for the turn, or say again', () => {
  assert.equal(classifyAsrError('service-not-allowed'), 'disable');
  assert.equal(classifyAsrError('language-not-supported'), 'disable');
  assert.equal(classifyAsrError('network'), 'fallback_turn');
  assert.equal(classifyAsrError('busy'), 'fallback_turn');
  assert.equal(classifyAsrError(undefined), 'fallback_turn');
  assert.equal(classifyAsrError('no-speech'), 'no_speech');
  assert.equal(classifyAsrError('aborted'), 'cancelled');
  assert.equal(classifyAsrError('not-allowed'), 'permission');
});

test('locale + glossary biasing (no digit strings ever)', () => {
  assert.equal(recognizerLang('en-IN'), 'en-IN');
  assert.equal(recognizerLang('hi-IN'), 'hi-IN');
  assert.equal(recognizerLang('auto'), 'en-IN');
  const cs = contextualStrings(['Ramesh Kumar', '482913', 'Hero Xtreme 125R', 'ramesh kumar']);
  assert.equal(cs[0], 'Ramesh Kumar');
  assert.ok(cs.includes('Hero Xtreme 125R'));
  assert.ok(!cs.includes('482913'));
  assert.equal(cs.filter((s) => s.toLowerCase() === 'ramesh kumar').length, 1);
  for (const w of ['EMI', 'KYC', 'RC', 'UPI', 'TA', 'payouts', 'portfolio', 'mandate', 'e-sign']) assert.ok(cs.includes(w), w);
  assert.ok(contextualStrings([], 10).length === 10);
});

test('hands-free fallback endpointer: speech then silence ends the turn; caps at 15 s', () => {
  const e = createEndpointer({ silenceMs: 700 });
  assert.equal(e.push(-80, 0), 'listen');
  assert.equal(e.push(-20, 300), 'listen');
  assert.equal(e.push(-20, 900), 'listen');
  assert.equal(e.push(-80, 1200), 'listen');
  assert.equal(e.push(-80, 1650), 'end');
  const q = createEndpointer({ noSpeechMs: 5000 });
  assert.equal(q.push(-90, 0), 'listen');
  assert.equal(q.push(-90, 5000), 'no_speech');
  const long = createEndpointer();
  long.push(-10, 0);
  assert.equal(long.push(-10, 15000), 'max');
});

test('Whisper second check: never silently flips', () => {
  const dev = localCommand('open payouts', matchCommand('open payouts'));
  const same = localCommand('show payouts', matchCommand('show payouts'));
  const other = { ...localCommand('open portfolio', matchCommand('open portfolio')), score: 0.9 };
  const weak = { ...other, score: 0.5 };
  assert.deepEqual(reconcile(dev, same, 'acted'), { kind: 'keep' });
  assert.deepEqual(reconcile(dev, other, 'preview'), { kind: 'did_you_mean' });
  assert.deepEqual(reconcile(dev, other, 'acted'), { kind: 'offer_undo' });
  assert.deepEqual(reconcile(dev, other, 'confirmed'), { kind: 'keep' });
  assert.deepEqual(reconcile(dev, weak, 'preview'), { kind: 'keep' }, 'a weak Whisper guess does not override');
  const retry = localCommand('zxqv', matchCommand('zxqv'));
  assert.deepEqual(reconcile(retry, other, 'nothing'), { kind: 'use_server' });
  const dym = didYouMeanFrom(dev, other);
  assert.equal(dym.status, 'clarify');
  assert.equal(dym.candidates?.[0].intent, 'OPEN_PORTFOLIO');
  assert.equal(dym.candidates?.[1].intent, 'OPEN_PAYOUTS');
  assert.equal(shouldAutoExecute(dym, false), false);
});

test('one-tap "Did you mean" acts unless destructive', () => {
  assert.equal(oneTapActs(localCommand('open payouts', matchCommand('open payouts'))), true);
  assert.equal(oneTapActs(localCommand('start e-sign', matchCommand('start e-sign'))), false);
  assert.equal(oneTapActs(localCommand('set up UPI mandate', matchCommand('set up UPI mandate'))), false);
});
