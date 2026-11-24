/**
 * Pure voice tests (no React Native). Run: npm run test:voice
 * (compiles this folder with tsc into node_modules/.cache/voicetest, then runs node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpeech, parseResponse } from '../sttClient';
import type { CommandResponse } from '../types';
import {
  displayFields, expectFor, planTarget, safeTranscript, slotsFromFields, validFields, withCandidate, withTypedValue,
} from '../voiceLogic';

const base = (over: Partial<CommandResponse> = {}): CommandResponse => ({
  transcript: 'x', confidence: 1, intent: 'UNKNOWN', score: 0.9, matchedPhrase: null, action: { type: 'none' }, ...over,
});

test('START_QR_JOURNEY maps to ScanQr even without an action', () => {
  assert.deepEqual(planTarget(base({ intent: 'START_QR_JOURNEY' })), { kind: 'navigate', route: 'ScanQr' });
  assert.deepEqual(planTarget(base({ intent: 'SCAN_QR' })), { kind: 'navigate', route: 'ScanQr' });
});

test('START_MOBILE_JOURNEY and new-loan intents map to SearchMobile', () => {
  for (const intent of ['START_MOBILE_JOURNEY', 'START_NEW_LOAN', 'NEW_TWO_WHEELER_LOAN', 'NEW_CAR_LOAN', 'NEW_CONSUMER_DURABLE_LOAN']) {
    const t = planTarget(base({ intent }));
    assert.equal(t.kind, 'navigate', intent);
    assert.equal(t.kind === 'navigate' && t.route, 'SearchMobile', intent);
  }
});

test('server action wins over the fallback map', () => {
  const t = planTarget(base({ intent: 'START_QR_JOURNEY', action: { type: 'navigate', route: 'Home' } }));
  assert.deepEqual(t, { kind: 'navigate', route: 'Home' });
});

test('clarify / retry / reprompt never plan an action until resolved', () => {
  for (const status of ['clarify', 'retry', 'reprompt'] as const) {
    assert.equal(planTarget(base({ intent: 'START_QR_JOURNEY', status })).kind, 'none', status);
  }
  const picked = withCandidate(base({ status: 'clarify', candidates: [
    { intent: 'START_QR_JOURNEY', phrase: 'scan QR', score: 0.6 }, { intent: 'START_MOBILE_JOURNEY', phrase: 'search by mobile', score: 0.58 },
  ] }), { intent: 'START_MOBILE_JOURNEY', phrase: 'search by mobile', score: 0.58 });
  assert.deepEqual(planTarget(picked), { kind: 'navigate', route: 'SearchMobile' });
});

const OTP_REAL = [{ type: 'OTP', value: '482913', valid: true, display: '482913', raw: '482913' }];
const OTP_SHOWN = [{ type: 'OTP', value: '••••••', valid: true, display: '••••••', raw: '[otp]' }];

test('OTP display uses masked fields, never the real digits', () => {
  const cmd = base({ transcript: '[otp utterance]', hasOtpField: true, normalizedFields: OTP_REAL, normalizedFieldsDisplay: OTP_SHOWN });
  const rows = displayFields(cmd);
  assert.equal(rows[0].display, '••••••');
  assert.ok(!JSON.stringify(rows).includes('482913'));
  // Even when the server forgot the masked copy, the client masks.
  const rows2 = displayFields(base({ hasOtpField: true, normalizedFields: OTP_REAL }));
  assert.equal(rows2[0].display, '••••••');
  assert.ok(!JSON.stringify(rows2).includes('482913'));
  // Transcript with digits is hidden for OTP utterances.
  assert.equal(safeTranscript(base({ transcript: '4 8 2 9 1 3', hasOtpField: true })), '[otp utterance]');
});

test('a digit-only OTP utterance plans a fill and fills the real digits on Confirm', () => {
  const cmd = base({ status: 'ok', hasOtpField: true, normalizedFields: OTP_REAL, normalizedFieldsDisplay: OTP_SHOWN });
  const t = planTarget(cmd);
  assert.equal(t.kind, 'fill');
  assert.deepEqual(slotsFromFields(validFields(cmd)), { otp: '482913' });
});

test('phone and amount fields go to mobileNumber / downPayment', () => {
  assert.deepEqual(slotsFromFields([
    { type: 'PHONE', value: '9876543210', valid: true, display: '98765 43210' },
    { type: 'AMOUNT', value: '15000', valid: true, display: '₹15,000' },
  ]), { mobileNumber: '9876543210', downPayment: 15000 });
  assert.deepEqual(slotsFromFields([{ type: 'PHONE', value: '12345', valid: false, display: '' }]), {});
});

test('typing an OTP keeps it masked in the display copy and re-stages as ok', () => {
  const cmd = withTypedValue(base({ status: 'reprompt' }), -1, 'OTP', '123456');
  assert.equal(cmd.status, 'ok');
  assert.equal(displayFields(cmd)[0].display, '••••••');
  assert.ok(!JSON.stringify(cmd.normalizedFieldsDisplay).includes('123456'));
  assert.equal(planTarget(cmd).kind, 'fill');
});

test('expect is derived from the route', () => {
  assert.equal(expectFor('DealerOtp'), 'otp');
  assert.equal(expectFor('SearchMobile', { stage: 'otp' }), 'otp');
  assert.equal(expectFor('SearchMobile', { stage: 'enter' }), 'phone');
  assert.equal(expectFor('SearchMobile', undefined), 'phone');
  assert.equal(expectFor('Home'), undefined);
});

test('parseResponse reads the new fields; empty OTP transcript is not no_speech', () => {
  const parsed = parseResponse({
    transcript: '', intent: 'UNKNOWN', score: 0, action: { type: 'none' }, status: 'ok', hasOtpField: true,
    normalizedFields: OTP_REAL, normalizedFieldsDisplay: OTP_SHOWN, readBack: 'OTP captured, six digits',
    candidates: [{ intent: 'SCAN_QR', phrase: 'scan qr', score: 0.5 }], repromptCount: 1, offerKeyboard: false,
    slots: { otp: '482913' },
  });
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.readBack, 'OTP captured, six digits');
  assert.equal(parsed.candidates?.[0].intent, 'SCAN_QR');
  assert.equal(parsed.slots?.otp, undefined); // OTP never comes in through server slots
  assert.doesNotThrow(() => checkSpeech(parsed));
  assert.throws(() => checkSpeech(parseResponse({ transcript: '  ' })), /no_speech/);
});
