/**
 * Pure voice tests (no React Native). Run: npm run test:voice
 * (compiles this folder with tsc into node_modules/.cache/voicetest, then runs node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpeech, parseResponse } from '../sttClient';
import type { CommandResponse } from '../types';
import {
  autoToastText, COMMAND_AUTO_THRESHOLD, COMMAND_CONFIRM_THRESHOLD, DESTRUCTIVE_INTENTS, OPTION_AUTO_THRESHOLD, shouldAutoExecute, undoSlotsFor,
  displayFields, expectFor, hideFieldForSelect, planTarget, safeTranscript, slotsForSelect, slotsFromFields, validFields, withCandidate, withTypedValue,
} from '../voiceLogic';
import { clearVoiceOptions, getVoiceOptions, matchVehicleRow, setVoiceOptions, vehicleLabel } from '../voiceOptions';

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

/* ---------------- v1.2.7: voice select for vehicle models and on-screen options ---------------- */

const XTREME_ACTION = { type: 'select', kind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' };

test('parseResponse accepts action.type select and candidate.option, never slots.otp', () => {
  const r = parseResponse({
    transcript: 'Select extreme 125.', confidence: 0.9, intent: 'SELECT_VEHICLE_MODEL', score: 0.92, status: 'ok',
    action: XTREME_ACTION,
    slots: { vehicle: 'Hero Xtreme 125R', assetId: 'hero-xtreme', brand: 'Hero MotoCorp', model: 'Xtreme 125R', otp: '482913' },
    candidates: [
      { intent: 'SELECT_VEHICLE_MODEL', phrase: 'Hero Xtreme 125R', score: 0.9, option: { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } },
      { intent: 'SELECT_OPTION', phrase: '24 months', score: 0.5, option: { id: 'tenure-24', kind: 'tenure', label: '24 months', value: 24 } },
      { intent: 'GO_HOME', phrase: 'go home', score: 0.3, option: { kind: 'x' } },
    ],
  });
  assert.deepEqual(r.action, XTREME_ACTION);
  assert.equal(r.slots?.assetId, 'hero-xtreme');
  assert.equal(r.slots?.vehicle, 'Hero Xtreme 125R');
  assert.equal(r.slots?.otp, undefined);
  assert.ok(!JSON.stringify(r).includes('482913'));
  assert.deepEqual(r.candidates?.[0].option, { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', value: 'hero-xtreme' });
  assert.deepEqual(r.candidates?.[1].option, { id: 'tenure-24', kind: 'tenure', label: '24 months', value: '24' });
  assert.equal(r.candidates?.[2].option, undefined); // malformed option dropped, candidate kept
  // A select action without id / label is not usable.
  assert.deepEqual(parseResponse({ transcript: 'x', action: { type: 'select', kind: 'vehicle_model' } }).action, { type: 'none' });
});

test('SELECT_VEHICLE_MODEL plans a select on this screen, not a navigate', () => {
  const t = planTarget(base({ intent: 'SELECT_VEHICLE_MODEL', status: 'ok', action: XTREME_ACTION as CommandResponse['action'] }));
  assert.equal(t.kind, 'select');
  assert.equal(t.kind === 'select' && t.id, 'hero-xtreme');
  assert.equal(t.kind === 'select' && t.label, 'Hero Xtreme 125R');
  // Intent alone (older action shape) still selects from slots; never falls into INTENT_ROUTE.
  const t2 = planTarget(base({ intent: 'SELECT_VEHICLE_MODEL', slots: { assetId: 'hero-xtreme', vehicle: 'Hero Xtreme 125R' } }));
  assert.deepEqual(t2, { kind: 'select', optionKind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' });
  // A select action wins even if the intent also has a route.
  assert.equal(planTarget(base({ intent: 'CHANGE_TENURE', action: XTREME_ACTION as CommandResponse['action'] })).kind, 'select');
  // SELECT_* with nothing to select does nothing.
  assert.equal(planTarget(base({ intent: 'SELECT_OPTION' })).kind, 'none');
});

test('clarify / retry select plan none until a candidate option re-stages it as select', () => {
  const options = [
    { intent: 'SELECT_VEHICLE_MODEL', phrase: 'Hero Xtreme 125R', score: 0.61, option: { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } },
    { intent: 'SELECT_VEHICLE_MODEL', phrase: 'Hero Splendor+', score: 0.58, option: { id: 'hero-splendor', kind: 'vehicle_model', label: 'Hero Splendor+', value: 'hero-splendor' } },
  ];
  for (const status of ['clarify', 'retry'] as const) {
    assert.equal(planTarget(base({ intent: 'SELECT_VEHICLE_MODEL', status, action: XTREME_ACTION as CommandResponse['action'], candidates: options })).kind, 'none', status);
  }
  const picked = withCandidate(base({ intent: 'SELECT_VEHICLE_MODEL', status: 'clarify', candidates: options }), options[0]);
  assert.equal(picked.status, 'ok');
  assert.equal(picked.candidates, undefined);
  assert.equal(picked.matchedPhrase, 'Hero Xtreme 125R');
  assert.deepEqual(picked.action, XTREME_ACTION);
  assert.equal(picked.slots?.assetId, 'hero-xtreme');
  assert.equal(picked.slots?.vehicle, 'Hero Xtreme 125R');
  const t = planTarget(picked);
  assert.equal(t.kind === 'select' && t.id, 'hero-xtreme');
  // Tenure option → tenureMonths slot.
  const tenure = withCandidate(base({ status: 'clarify' }), { intent: 'SELECT_OPTION', phrase: '24 months', score: 0.6, option: { id: 'tenure-24', kind: 'tenure', label: '24 months', value: '24' } });
  assert.equal(tenure.slots?.tenureMonths, 24);
  assert.equal(planTarget(tenure).kind, 'select');
  // Navigation candidates keep the INTENT_ROUTE path.
  assert.deepEqual(planTarget(withCandidate(base({ status: 'clarify' }), { intent: 'SCAN_QR', phrase: 'scan QR', score: 0.6 })), { kind: 'navigate', route: 'ScanQr' });
});

test('select commands never fill an Amount from a model number', () => {
  const cmd = base({ intent: 'SELECT_VEHICLE_MODEL', action: XTREME_ACTION as CommandResponse['action'],
    normalizedFields: [{ type: 'AMOUNT', value: '125', valid: true, display: '₹125' }] });
  assert.equal(hideFieldForSelect(cmd, cmd.normalizedFields![0]), true);
  assert.equal(hideFieldForSelect(base({ intent: 'CHANGE_DOWN_PAYMENT' }), cmd.normalizedFields![0]), false);
  const t = planTarget(cmd);
  assert.ok(t.kind === 'select');
  assert.deepEqual(slotsForSelect(t), { assetId: 'hero-xtreme', vehicle: 'Hero Xtreme 125R' });
});

test('slotsFromFields is unchanged for PHONE / AMOUNT / OTP', () => {
  assert.deepEqual(slotsFromFields([
    { type: 'PHONE', value: '919876543210', valid: true, display: '' },
    { type: 'AMOUNT', value: '15,000', valid: true, display: '' },
    { type: 'OTP', value: '482913', valid: true, display: '' },
  ]), { mobileNumber: '9876543210', downPayment: 15000, otp: '482913' });
  assert.deepEqual(slotsFromFields([{ type: 'PHONE', value: '12345', valid: true, display: '' }, { type: 'AMOUNT', value: '500', valid: false, display: '' }]), {});
});

const CATALOGUE = [
  { id: 'hero-splendor', brand: 'Hero MotoCorp', model: 'Splendor+' },
  { id: 'hero-xtreme', brand: 'Hero MotoCorp', model: 'Xtreme 125R' },
  { id: 'hero-vida', brand: 'Hero MotoCorp', model: 'Vida V2' },
  { id: 're-bullet', brand: 'Royal Enfield', model: 'Bullet 350' },
  { id: 'honda-activa', brand: 'Honda', model: 'Activa 6G' },
  { id: 'tvs-apache', brand: 'TVS', model: 'Apache RTR 160 4V' },
  { id: 'bajaj-pulsar', brand: 'Bajaj', model: 'Pulsar N250' },
  { id: 'ather-450x', brand: 'Ather', model: '450X' },
];

test('matchVehicleRow matches spoken / drafted model names to the catalogue', () => {
  for (const said of ['Select extreme 125.', 'extreme 125', 'Hero Xtreme 125R', 'xtreme 125r', 'hero-xtreme']) {
    assert.equal(matchVehicleRow(said, CATALOGUE)?.id, 'hero-xtreme', said);
  }
  for (const said of ['Splendor+', 'splendor plus', 'Hero Splendor Plus']) {
    assert.equal(matchVehicleRow(said, CATALOGUE)?.id, 'hero-splendor', said);
  }
  assert.equal(matchVehicleRow('Royal Enfield Bullet 350', CATALOGUE)?.id, 're-bullet');
  assert.equal(matchVehicleRow('apache rtr', CATALOGUE)?.id, 'tvs-apache');
  for (const said of ['go home', 'banana', 'Hero', '125', '', undefined]) {
    assert.equal(matchVehicleRow(said, CATALOGUE), null, String(said));
  }
});

test('option registry: labels, route scoping and token-safe clearing', () => {
  assert.equal(vehicleLabel({ brand: 'Hero MotoCorp', model: 'Xtreme 125R' }), 'Hero Xtreme 125R');
  assert.equal(vehicleLabel({ brand: 'Royal Enfield', model: 'Bullet 350' }), 'Royal Enfield Bullet 350');
  assert.equal(vehicleLabel({ brand: 'Maruti Suzuki', model: 'Swift' }), 'Maruti Swift');
  assert.equal(vehicleLabel({ brand: 'Tata Motors', model: 'Nexon' }), 'Tata Nexon');
  const a = setVoiceOptions([{ id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R' }], 'Asset');
  assert.equal(getVoiceOptions('Asset').length, 1);
  assert.equal(getVoiceOptions('FaceKyc').length, 0);
  const b = setVoiceOptions([{ id: 'tenure-24', kind: 'tenure', label: '24 months', value: '24' }]);
  clearVoiceOptions(a); // stale token: keeps b
  assert.equal(getVoiceOptions('Home').length, 1);
  clearVoiceOptions(b);
  assert.equal(getVoiceOptions().length, 0);
});

// ---------------------------------------------------------------------------------------------
// v1.2.7 auto-act on high-confidence voice commands
// ---------------------------------------------------------------------------------------------

const XTREME_SELECT = { type: 'select', kind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } as const;
const xtreme = (over: Partial<CommandResponse> = {}) => base({ intent: 'SELECT_VEHICLE_MODEL', status: 'ok', action: { ...XTREME_SELECT }, ...over });

test('parseResponse reads autoExecute / confidenceBand / autoReason and stays backward compatible', () => {
  const p = parseResponse({ transcript: 'go home', intent: 'GO_HOME', score: 0.9, autoExecute: true, confidenceBand: 'auto', autoReason: 'semantic', matchMethod: 'semantic' });
  assert.equal(p.autoExecute, true);
  assert.equal(p.confidenceBand, 'auto');
  assert.equal(p.autoReason, 'semantic');
  assert.equal(p.method, 'semantic');
  const old = parseResponse({ transcript: 'go home', intent: 'GO_HOME', score: 0.9 });
  assert.equal(old.autoExecute, undefined);
  assert.equal(old.confidenceBand, undefined);
  assert.equal(parseResponse({ transcript: 'x', confidenceBand: 'bogus', autoExecute: 'yes' }).confidenceBand, undefined);
  assert.equal(parseResponse({ transcript: 'x', autoExecute: 'yes' }).autoExecute, undefined);
});

test('option select auto-acts at 1.0 / 0.78 / 0.65, not at 0.58 or for clarify / retry', () => {
  assert.equal(OPTION_AUTO_THRESHOLD, 0.65);
  for (const score of [1.0, 0.78, 0.65]) {
    assert.equal(shouldAutoExecute(xtreme({ score, autoExecute: true, confidenceBand: 'auto', autoReason: 'option' }), false), true, `server ${score}`);
    assert.equal(shouldAutoExecute(xtreme({ score }), false), true, `fallback ${score}`);
  }
  // Slots-only SELECT_* intent (no action) also uses the fallback.
  assert.equal(shouldAutoExecute(base({ intent: 'SELECT_VEHICLE_MODEL', score: 0.7, slots: { assetId: 'hero-xtreme', vehicle: 'Hero Xtreme 125R' } }), false), true);
  assert.equal(shouldAutoExecute(xtreme({ score: 0.58 }), false), false);
  assert.equal(shouldAutoExecute(xtreme({ score: 0.58, autoExecute: false, confidenceBand: 'confirm' }), false), false);
  for (const status of ['clarify', 'retry', 'reprompt'] as const) {
    assert.equal(shouldAutoExecute(xtreme({ score: 0.9, status, autoExecute: true }), false), false, status);
  }
  // The server's explicit "no" wins over a high fallback score.
  assert.equal(shouldAutoExecute(xtreme({ score: 0.95, autoExecute: false }), false), false);
});

test('navigation / journeys auto-act at 0.65 (same band as options), not below', () => {
  assert.equal(COMMAND_AUTO_THRESHOLD, 0.65);
  assert.equal(COMMAND_CONFIRM_THRESHOLD, 0.5);
  for (const intent of ['GO_HOME', 'START_QR_JOURNEY', 'OPEN_PORTFOLIO', 'START_MOBILE_JOURNEY']) {
    for (const score of [0.65, 0.8, 0.9]) {
      assert.equal(shouldAutoExecute(base({ intent, score, method: 'semantic' }), false), true, `${intent} fallback ${score}`);
    }
    for (const score of [0.58, 0.49]) {
      assert.equal(shouldAutoExecute(base({ intent, score, method: 'semantic' }), false), false, `${intent} fallback ${score}`);
    }
    assert.equal(shouldAutoExecute(base({ intent, score: 0.65, method: 'semantic', autoExecute: true, confidenceBand: 'auto' }), false), true, `${intent} server auto`);
    assert.equal(shouldAutoExecute(base({ intent, score: 0.58, method: 'semantic', autoExecute: false, confidenceBand: 'confirm' }), false), false, `${intent} confirm`);
    assert.equal(shouldAutoExecute(base({ intent, score: 0.9, method: 'semantic', status: 'clarify' }), false), false, `${intent} clarify`);
  }
  // Older servers that call it matchMethod.
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 0.65, matchMethod: 'semantic' }), false), true);
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 0.58, matchMethod: 'semantic' }), false), false);
  // Non-exact keyword match without autoExecute: the client does not guess.
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 0.9, method: 'keyword' }), false), false);
  assert.equal(shouldAutoExecute(base({ intent: 'START_QR_JOURNEY', score: 0.7, method: 'keyword' }), false), false);
  // Unique exact keyword (0.95+) acts on the fallback path too.
  assert.equal(shouldAutoExecute(base({ intent: 'START_QR_JOURNEY', score: 0.95, method: 'keyword' }), false), true);
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 1, matchMethod: 'keyword' }), false), true);
  // Unique exact keyword the server marked auto.
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 1, method: 'keyword', autoExecute: true, autoReason: 'keyword_exact' }), false), true);
});

test('destructive intents never auto-act, even at 0.99 with autoExecute true', () => {
  for (const intent of ['CONFIRM_OFFER', 'START_ESIGN', 'SETUP_UPI_MANDATE', 'OPEN_UPI_APP', 'UPLOAD_RC', 'TAKE_DELIVERY_PHOTO']) {
    assert.ok(DESTRUCTIVE_INTENTS.has(intent), intent);
    const route = intent === 'OPEN_UPI_APP' ? { action: { type: 'navigate' as const, route: 'Mandate' } } : {};
    assert.equal(shouldAutoExecute(base({ intent, score: 0.99, method: 'semantic', autoExecute: true, confidenceBand: 'auto', ...route }), false), false, intent);
  }
  // Server-tagged destructive, and a navigate that presses a CTA.
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 0.99, autoExecute: true, autoReason: 'destructive' }), false), false);
  assert.equal(shouldAutoExecute(base({ intent: 'SOMETHING', score: 0.99, autoExecute: true, action: { type: 'navigate', route: 'Offer', filter: 'confirm' } }), false), false);
  assert.equal(shouldAutoExecute(base({ intent: 'VERIFY_OTP', score: 0.99, autoExecute: true, normalizedFields: OTP_REAL, hasOtpField: true }), false), false);
});

test('Ask before acting ON always shows Confirm, even at 0.99', () => {
  assert.equal(shouldAutoExecute(xtreme({ score: 0.99, autoExecute: true, confidenceBand: 'auto' }), true), false);
  assert.equal(shouldAutoExecute(base({ intent: 'GO_HOME', score: 0.99, method: 'semantic', autoExecute: true }), true), false);
  assert.equal(shouldAutoExecute(base({ hasOtpField: true, normalizedFields: OTP_REAL, autoExecute: true, autoReason: 'field:OTP' }), true), false);
});

test('a valid OTP field auto-FILLS only; the toast and display stay masked', () => {
  const cmd = base({ transcript: '[otp utterance]', intent: 'UNKNOWN', hasOtpField: true, normalizedFields: OTP_REAL, normalizedFieldsDisplay: OTP_SHOWN, autoExecute: true, confidenceBand: 'auto', autoReason: 'field:OTP' });
  assert.equal(shouldAutoExecute(cmd, false), true);
  const t = planTarget(cmd);
  assert.equal(t.kind, 'fill');
  assert.deepEqual(undoSlotsFor(t), ['otp']);
  const text = autoToastText(cmd, t);
  assert.equal(text, 'OTP captured, six digits');
  assert.ok(!/\d/.test(text));
  // Regression: display copies still masked.
  assert.equal(displayFields(cmd)[0].display, '••••••');
  assert.ok(!JSON.stringify(displayFields(cmd)).includes('482913'));
  assert.equal(safeTranscript(base({ transcript: '4 8 2 9 1 3', hasOtpField: true })), '[otp utterance]');
  // Invalid OTP never auto-fills (it stays reprompt / say again).
  const bad = base({ hasOtpField: true, status: 'reprompt', normalizedFields: [{ type: 'OTP', value: '48', valid: false, display: '••' }], autoExecute: false });
  assert.equal(shouldAutoExecute(bad, false), false);
  // Fallback (no autoExecute): a valid phone fill auto-acts.
  const phone = base({ normalizedFields: [{ type: 'PHONE', value: '9876543210', valid: true, display: '98765 43210' }] });
  assert.equal(shouldAutoExecute(phone, false), true);
  assert.equal(autoToastText(phone, planTarget(phone)), 'Mobile number 98765 43210');
  assert.deepEqual(undoSlotsFor(planTarget(phone)), ['mobile']);
});

test('toast text for select and navigation', () => {
  const sel = xtreme({ score: 0.9 });
  assert.equal(autoToastText(sel, planTarget(sel)), 'Selected Hero Xtreme 125R');
  assert.deepEqual(undoSlotsFor(planTarget(sel)), ['asset']);
  const qr = base({ intent: 'START_QR_JOURNEY', responseText: 'Sure! Opening the QR scanner for you. Point it at the code?' });
  assert.equal(autoToastText(qr, planTarget(qr), 'Scan customer QR'), 'Opening QR journey');
  assert.equal(autoToastText(base({ intent: 'GO_HOME' }), planTarget(base({ intent: 'GO_HOME' }))), 'Opening Home');
  assert.equal(autoToastText(base({ intent: 'START_MOBILE_JOURNEY' }), planTarget(base({ intent: 'START_MOBILE_JOURNEY' }))), 'Starting the mobile number journey');
  const port = base({ intent: 'OPEN_PORTFOLIO', responseText: 'Opening your portfolio.' });
  assert.equal(autoToastText(port, planTarget(port), 'Portfolio'), 'Opening your portfolio');
  const longer = base({ intent: 'OPEN_PAYOUTS', responseText: 'Here are your payouts. Want me to filter them by month?' });
  assert.equal(autoToastText(longer, planTarget(longer), 'Payouts'), 'Opening Payouts');
  const tenure = base({ intent: 'SELECT_OPTION', action: { type: 'select', kind: 'tenure', id: 'tenure-24', label: '24 months', value: '24' } });
  assert.deepEqual(undoSlotsFor(planTarget(tenure)), ['tenure']);
});

test('clarify xtrem pair: picking a candidate plans a select (not clarify) and drops stale server flags', () => {
  const pair = [
    { intent: 'SELECT_VEHICLE_MODEL', phrase: 'Hero Xtreme 125R', score: 0.62, option: { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } },
    { intent: 'SELECT_VEHICLE_MODEL', phrase: 'Hero Xtreme 160R', score: 0.61, option: { id: 'hero-xtreme-160', kind: 'vehicle_model', label: 'Hero Xtreme 160R', value: 'hero-xtreme-160' } },
  ];
  const cmd = base({ transcript: 'xtrem', intent: 'SELECT_VEHICLE_MODEL', status: 'clarify', candidates: pair, autoExecute: false, confidenceBand: 'clarify' });
  assert.equal(shouldAutoExecute(cmd, false), false);
  const picked = withCandidate(cmd, pair[1]);
  assert.equal(picked.status, 'ok');
  assert.equal(picked.confidenceBand, undefined);
  assert.equal(picked.autoExecute, undefined);
  const t = planTarget(picked);
  assert.equal(t.kind, 'select');
  assert.equal(t.kind === 'select' && t.id, 'hero-xtreme-160');
  // Either Confirm or auto is fine after a manual pick; this one is a boolean decision, not clarify.
  assert.equal(typeof shouldAutoExecute(picked, false), 'boolean');
  assert.equal(shouldAutoExecute(picked, true), false);
});

// ---- v1.3.0: Help & tutorials ----

test('help / tutorial intents navigate to Help', () => {
  for (const intent of ['OPEN_HELP', 'OPEN_TUTORIALS', 'SHOW_TUTORIALS', 'HOW_TO']) {
    assert.deepEqual(planTarget(base({ intent })), { kind: 'navigate', route: 'Help' }, intent);
  }
});

test('spoken "help", "tutorial", "how to" open Help instead of the generic read-out', () => {
  for (const transcript of ['help', 'show me the tutorial', 'tutorials', 'how to do the mandate', 'any how-to videos']) {
    const helpIntent = base({ intent: 'HELP', transcript, action: { type: 'assistant', action: 'help' } });
    assert.deepEqual(planTarget(helpIntent), { kind: 'navigate', route: 'Help' }, `HELP: ${transcript}`);
    assert.deepEqual(planTarget(base({ intent: 'UNKNOWN', transcript })), { kind: 'navigate', route: 'Help' }, `UNKNOWN: ${transcript}`);
  }
  assert.equal(autoToastText(base({ intent: 'HELP', transcript: 'help' }), { kind: 'navigate', route: 'Help' }), 'Opening Help & tutorials');
});

test('tutorial words never override a specific intent, a non-help read-out or a spoken number', () => {
  assert.deepEqual(planTarget(base({ intent: 'GO_HOME', transcript: 'help me go home' })), { kind: 'navigate', route: 'Home' });
  // HELP without a tutorial word ("what can you do") keeps the read-out.
  assert.deepEqual(planTarget(base({ intent: 'HELP', transcript: 'what can you do', action: { type: 'assistant', action: 'help' } })), { kind: 'assistant' });
  const fill = base({ intent: 'UNKNOWN', transcript: 'help 9876543210', normalizedFields: [{ type: 'PHONE', value: '9876543210', display: '98765 43210', valid: true }] });
  assert.equal(planTarget(fill).kind, 'fill');
});
