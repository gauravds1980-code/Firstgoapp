/**
 * v1.4.2 live words on the phone recognizer: path reasons, error kinds, offline-locale check,
 * recognition-service fallback and the voice debug store (pure). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseAsrPath, classifyAsrError, explainAsrPath, hasInstalledLocale, normLocale, pickRecognitionService, type AsrEnv,
} from '../voiceMode';
import {
  asrDiagLine, clearAsrDiag, countAsrPartial, getAsrDiag, markAsrStarted, noteAsrError, resetAsrTurn, serviceLabel, subscribeAsrDiag,
} from '../asrDiag';

const env: AsrEnv = { platform: 'android', flagOn: true, moduleLoaded: true, recognitionAvailable: true, disabledThisSession: false };

test('explainAsrPath: device when everything lines up, a reason for every server turn', () => {
  assert.deepEqual(explainAsrPath(env), { path: 'device' });
  assert.deepEqual(explainAsrPath({ ...env, flagOn: false }), { path: 'server', reason: 'flag_off' });
  assert.deepEqual(explainAsrPath({ ...env, platform: 'web' }), { path: 'server', reason: 'web' });
  assert.deepEqual(explainAsrPath({ ...env, moduleLoaded: false }), { path: 'server', reason: 'no_module' });
  assert.deepEqual(explainAsrPath({ ...env, recognitionAvailable: false }), { path: 'server', reason: 'no_service' });
  assert.deepEqual(explainAsrPath({ ...env, disabledThisSession: true }), { path: 'server', reason: 'disabled_after_error' });
  assert.deepEqual(explainAsrPath({ ...env, disabledThisSession: true, disabledBy: 'permission' }), { path: 'server', reason: 'permission' });
  assert.deepEqual(explainAsrPath({ ...env, disabledThisSession: true, disabledBy: 'error' }), { path: 'server', reason: 'disabled_after_error' });
});

test('chooseAsrPath agrees with explainAsrPath', () => {
  const variants: AsrEnv[] = [
    env, { ...env, flagOn: false }, { ...env, platform: 'web' }, { ...env, moduleLoaded: false },
    { ...env, recognitionAvailable: false }, { ...env, disabledThisSession: true }, { ...env, platform: 'ios' },
  ];
  for (const v of variants) assert.equal(chooseAsrPath(v), explainAsrPath(v).path);
});

test('classifyAsrError: new kinds', () => {
  assert.equal(classifyAsrError('language-not-supported', { onDeviceRequested: true }), 'retry_network');
  assert.equal(classifyAsrError('language-not-supported', { onDeviceRequested: false }), 'disable');
  for (const c of ['client', 'audio-capture', 'unknown']) {
    assert.equal(classifyAsrError(c, { persistRequested: true, gotResult: false }), 'drop_persist', c);
    assert.equal(classifyAsrError(c, { persistRequested: true }), 'drop_persist', `${c} (gotResult missing)`);
    assert.equal(classifyAsrError(c, { persistRequested: true, gotResult: true }), 'fallback_turn', `${c} after a result`);
    assert.equal(classifyAsrError(c, { persistRequested: false }), 'fallback_turn', `${c} without persist`);
  }
  assert.equal(classifyAsrError('network', { persistRequested: true, gotResult: false }), 'fallback_turn', 'network is not a persist problem');
  assert.equal(classifyAsrError('too-many-requests'), 'fallback_turn');
});

test('classifyAsrError: old kinds unchanged (no context and empty context)', () => {
  const old: Record<string, string> = {
    aborted: 'cancelled', 'no-speech': 'no_speech', 'speech-timeout': 'no_speech', nomatch: 'no_speech', 'not-allowed': 'permission',
    'service-not-allowed': 'disable', 'language-not-supported': 'disable', 'bad-grammar': 'disable',
    network: 'fallback_turn', busy: 'fallback_turn', 'audio-capture': 'fallback_turn', interrupted: 'fallback_turn', client: 'fallback_turn',
    unknown: 'fallback_turn', 'something-new': 'fallback_turn',
  };
  for (const [code, kind] of Object.entries(old)) {
    assert.equal(classifyAsrError(code), kind, code);
    assert.equal(classifyAsrError(code, {}), kind, `${code} {}`);
  }
  assert.equal(classifyAsrError(undefined), 'fallback_turn');
  // Context does not change unrelated codes.
  assert.equal(classifyAsrError('no-speech', { persistRequested: true, onDeviceRequested: true }), 'no_speech');
  assert.equal(classifyAsrError('not-allowed', { persistRequested: true, onDeviceRequested: true }), 'permission');
  assert.equal(classifyAsrError('aborted', { persistRequested: true }), 'cancelled');
});

test('offline model locales are compared normalised', () => {
  assert.equal(normLocale('en_IN'), 'en-in');
  assert.equal(normLocale(' EN-in '), 'en-in');
  assert.equal(hasInstalledLocale(['en_IN'], 'en-IN'), true);
  assert.equal(hasInstalledLocale(['en-in', 'hi_IN'], 'hi-IN'), true);
  assert.equal(hasInstalledLocale(['en-US'], 'en-IN'), false);
  assert.equal(hasInstalledLocale([], 'en-IN'), false);
  assert.equal(hasInstalledLocale(undefined, 'en-IN'), false);
});

test('pickRecognitionService: default first, then Google packages in preference order', () => {
  assert.equal(pickRecognitionService(true, []), 'default');
  assert.equal(pickRecognitionService(true, ['com.google.android.tts']), 'default', 'explicit package only when the default is missing');
  assert.equal(pickRecognitionService(false, ['com.google.android.tts', 'com.google.android.googlequicksearchbox']), 'com.google.android.googlequicksearchbox');
  assert.equal(pickRecognitionService(false, ['com.google.android.tts', 'com.google.android.as']), 'com.google.android.as');
  assert.equal(pickRecognitionService(false, ['com.google.android.tts']), 'com.google.android.tts');
  assert.equal(pickRecognitionService(false, ['com.samsung.android.bixby.agent']), null);
  assert.equal(pickRecognitionService(false, []), null);
  assert.equal(pickRecognitionService(false, null), null);
});

test('asrDiag: partial count, first-partial ms, reset per turn, subscribers', () => {
  clearAsrDiag();
  let calls = 0;
  const unsub = subscribeAsrDiag(() => { calls++; });
  assert.equal(asrDiagLine(getAsrDiag()), null, 'no turn yet');
  resetAsrTurn('device');
  markAsrStarted({ service: 'com.google.android.googlequicksearchbox', onDevice: false, persist: true }, 1000);
  countAsrPartial(1620);
  countAsrPartial(1800);
  countAsrPartial(1900);
  countAsrPartial(2000);
  const d = getAsrDiag();
  assert.equal(d.turn, 1);
  assert.equal(d.partials, 4);
  assert.equal(d.firstPartialMs, 620);
  assert.equal(d.reason, undefined);
  assert.equal(asrDiagLine(d), 'Phone recogniser · Google app · network · audio copy on · 4 partials · first 620 ms');
  noteAsrError('client');
  assert.match(asrDiagLine(getAsrDiag()) ?? '', /error client$/);

  resetAsrTurn('server', 'no_service');
  const s = getAsrDiag();
  assert.equal(s.turn, 2);
  assert.equal(s.partials, 0);
  assert.equal(s.firstPartialMs, null);
  assert.equal(s.lastError, null);
  assert.equal(asrDiagLine(s), 'Voice server · no speech service on this phone');

  resetAsrTurn('device', 'no_service');
  assert.equal(getAsrDiag().reason, undefined, 'reason only on server turns');
  markAsrStarted({ service: 'default', onDevice: true, persist: false }, 0);
  countAsrPartial(300);
  assert.equal(asrDiagLine(getAsrDiag()), 'Phone recogniser · default service · on-device · audio copy off · 1 partial · first 300 ms');

  assert.ok(calls >= 8);
  unsub();
  const before = calls;
  countAsrPartial(400);
  assert.equal(calls, before, 'unsubscribed');
  clearAsrDiag();
  assert.equal(getAsrDiag().turn, 0);
});

test('serviceLabel', () => {
  assert.equal(serviceLabel('default'), 'default service');
  assert.equal(serviceLabel(null), 'default service');
  assert.equal(serviceLabel('com.google.android.as'), 'Android System Intelligence');
  assert.equal(serviceLabel('com.example.asr'), 'com.example.asr');
});
