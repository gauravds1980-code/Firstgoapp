/**
 * v1.4.5 OTP: phone parser (exactly 6 digits), the hands-off e-sign OTP step (server answer and offline phone
 * parse auto-proceed, no Confirm / clarify card, failure clears and re-prompts), other OTP screens fill only,
 * and masking in the sheet / logs / offline queue. Fake codes only (123456 / 482913). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideOtpTurn, ESIGN_RETRY_TEXT, ESIGN_VERIFY_TEXT, otpFromDraft, otpMaskFor, otpOfflineCommand, parseOtp, planOtpTurn } from '../otpParse';
import { localCommand, matchCommand } from '../intentMatcher';
import { parseResponse } from '../sttClient';
import { buildLogBody, isOtpTurn } from '../voiceTurnLog';
import { sanitizeQueuedBody } from '../voiceLogQueue';
import { displayFields, expectFor, planTarget, safeTranscript, shouldAutoExecute, slotsFromFields } from '../voiceLogic';

const SIX: string[] = [
  '1 2 3 4 5 6', '123456', '1-2-3-4-5-6', '12 34 56', '123 456', 'one two three four five six', 'twelve thirty four fifty six',
  'ek do teen char paanch chhe', 'एक दो तीन चार पांच छह', '१२३४५६', 'my otp is 1 2 3 4 5 6', 'OTP 123456 hai', 'one two three four five six.',
];

test('parser: every spoken form of a 6-digit code reads 123456', () => {
  for (const t of SIX) assert.deepEqual(parseOtp(t), { kind: 'ok', digits: '123456' }, t);
  assert.deepEqual(parseOtp('four eight two nine one three'), { kind: 'ok', digits: '482913' });
  assert.deepEqual(parseOtp('double four triple eight one'), { kind: 'ok', digits: '448881' });
  assert.deepEqual(parseOtp('four double eight two nine one'), { kind: 'ok', digits: '488291' });
  assert.deepEqual(parseOtp('zero oh one two three four'), { kind: 'ok', digits: '001234' });
});

test('parser: exactly 6 — 5 / 7 digits are rejected; sentences are not an OTP', () => {
  assert.equal(parseOtp('1 2 3 4 5').kind, 'wrong_length');
  assert.equal(parseOtp('1234567').kind, 'wrong_length');
  assert.equal(parseOtp('4829').kind, 'wrong_length', 'a 4-digit code never fills a 6-box screen');
  assert.equal(parseOtp('go home').kind, 'none');
  assert.equal(parseOtp('no').kind, 'none');
});

test('Esign is an OTP screen (expect otp), so the turn is masked and has no Whisper / parallel stream', () => {
  assert.equal(expectFor('Esign'), 'otp');
  assert.equal(expectFor('DealerOtp'), 'otp');
  assert.equal(expectFor('SearchMobile', { stage: 'otp' }), 'otp');
  assert.equal(expectFor('Home'), undefined);
});

test('Esign offline path: exactly 6 digits on the phone → fill + verify at once, masked, no card', () => {
  for (const t of SIX) {
    const plan = planOtpTurn(t);
    assert.equal(plan.kind, 'local', t);
    if (plan.kind !== 'local') continue;
    const d = decideOtpTurn(plan.command, 'Esign');
    assert.equal(d.kind, 'esign_auto', t);
    if (d.kind !== 'esign_auto') continue;
    assert.equal(d.code, '123456');
    assert.equal(d.command.responseText, ESIGN_VERIFY_TEXT);
    assert.equal(JSON.stringify(d.command).includes('123456'), false, `${t}: nothing shown / logged carries the digits`);
    assert.equal(d.command.status, 'ok');
    assert.ok(!d.command.candidates?.length, 'no "Did you mean"');
  }
});

test('Esign server path: S1 (band confirm) and the hands-off server (band auto) both auto-proceed, no Confirm card', () => {
  const field = [{ type: 'OTP', value: '482913', valid: true, display: '••••••', raw: '[otp]', readBack: 'OTP captured, six digits' }];
  for (const band of [{ confidenceBand: 'confirm', autoExecute: false, autoReason: 'esign_otp' }, { confidenceBand: 'auto', autoExecute: true, autoReason: 'esign_otp' }]) {
    const cmd = parseResponse({
      transcript: '[otp utterance]', intent: 'UNKNOWN', method: 'otp', action: { type: 'fill', field: 'otp', submit: true }, status: 'ok', otp: true, hasOtpField: true,
      normalizedFields: field, normalizedFieldsDisplay: [{ ...field[0], value: '••••••' }], ...band,
    });
    const d = decideOtpTurn(cmd, 'Esign');
    assert.equal(d.kind, 'esign_auto', band.confidenceBand);
    if (d.kind === 'esign_auto') assert.equal(d.code, '482913');
  }
});

test('Esign: 5 / 7 digits → masked "Say all 6 digits or type them", nothing filled, no auto-verify', () => {
  for (const t of ['1 2 3 4 5', '1 2 3 4 5 6 7']) {
    const plan = planOtpTurn(t);
    assert.equal(plan.kind, 'local');
    if (plan.kind !== 'local') continue;
    const d = decideOtpTurn(plan.command, 'Esign');
    assert.equal(d.kind, 'deliver', t);
    assert.equal(d.command.responseText, 'Say all 6 digits or type them.');
    assert.equal(d.command.status, 'retry');
    assert.deepEqual(slotsFromFields(d.command.normalizedFields ?? []), {}, 'nothing filled');
    assert.equal(planTarget(d.command).kind, 'none', 'no Confirm button');
    assert.ok(!/12345/.test(JSON.stringify(d.command)), 'masked');
  }
  const server7 = parseResponse({ transcript: '[otp utterance]', status: 'ok', hasOtpField: true, normalizedFields: [{ type: 'OTP', value: '1234567', valid: true, display: '•••••••' }] });
  assert.equal(decideOtpTurn(server7, 'Esign').kind, 'deliver');
  assert.equal(decideOtpTurn(server7, 'Esign').command.status, 'retry');
});

test('other OTP screens keep fill-only (toast + Undo, never verify): DealerOtp, SearchMobile otp stage', () => {
  const plan = planOtpTurn('1 2 3 4 5 6');
  assert.equal(plan.kind, 'local');
  if (plan.kind !== 'local') return;
  for (const screen of ['DealerOtp', 'SearchMobile']) {
    const d = decideOtpTurn(plan.command, screen);
    assert.equal(d.kind, 'deliver', screen);
    assert.equal(planTarget(d.command).kind, 'fill');
    assert.equal(shouldAutoExecute(d.command, false), true, 'auto-fill (Undo)');
    assert.deepEqual(slotsFromFields(d.command.normalizedFields ?? []), { otp: '123456' });
    assert.equal(displayFields(d.command)[0].value, '••••••');
  }
  assert.equal(otpFromDraft('123456', false), '123456');
  assert.equal(otpFromDraft('4829', false), null);
  assert.equal(otpFromDraft('123456', true), null);
});

test('offline: server unreachable on an OTP screen with a sentence → masked say-again (never "Sorry, say that again")', () => {
  const t = 'the code is one two three';
  const off = otpOfflineCommand(t, localCommand(t, matchCommand(t)));
  assert.equal(off.responseText, 'Say all 6 digits or type them.');
});

test('masking: pill / sheet / transcript never show the digits', () => {
  assert.equal(otpMaskFor('1 2 3 4 5 6'), '••••••');
  assert.equal(otpMaskFor('एक दो तीन चार पांच छह'), '••••••');
  const plan = planOtpTurn('482913');
  if (plan.kind === 'local') assert.equal(safeTranscript(plan.command), '[otp utterance]');
});

test('logs + offline queue: Esign turns are OTP turns (never posted), queued bodies are masked', () => {
  assert.equal(isOtpTurn({ screen: 'Esign' }), true);
  assert.equal(isOtpTurn({ route: 'DealerOtp' }), true);
  assert.equal(isOtpTurn({ screen: 'Home' }), false);
  assert.equal(buildLogBody({ turnId: 't1', path: 'device', screen: 'Esign', transcript: '1 2 3 4 5 6' } as never), null);
  const q = sanitizeQueuedBody({ turnId: 't2', screen: 'Esign', transcript: '1 2 3 4 5 6', deviceTranscript: 'four eight two nine one three', audioBase64: 'AAAA' });
  assert.ok(!JSON.stringify(q).includes('123456') && !/\d \d \d/.test(JSON.stringify(q)), JSON.stringify(q));
  assert.equal(q.audioBase64, undefined, 'never audio');
});

test('Esign screen: voice draft verifies through the same verify(); failure clears the boxes and re-prompts by voice', () => {
  const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'screens', 'EsignScreen.tsx'), 'utf8');
  assert.match(src, /if \(submit\) void verify\(code, true\)/);
  assert.match(src, /if \(byVoice\) \{ setOtp\(''\); voiceSay\(ESIGN_RETRY_TEXT, 'error'\); \}/);
  assert.equal(ESIGN_RETRY_TEXT, "That OTP didn't work. Say the 6 digits again.");
  const hook = readFileSync(join(__dirname, '..', '..', '..', 'src', 'voice', 'useVoiceCommand.ts'), 'utf8');
  assert.match(hook, /otpSubmit: true/, 'the hook marks the draft for auto-verify');
  assert.ok(!/console\.log\([^)]*otp/i.test(hook), 'never logs an OTP');
});
