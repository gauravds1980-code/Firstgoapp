/**
 * v1.4.5 S2.4 RC number entry by voice on RcPendency (FINDINGS §2 table): spoken plate grammar mirror, state-code
 * validation + snap to the dealer state, never an OTP, fill + read-back, voice-confirmed submit, "update <name>'s RC".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerOptions } from '../customerMatch';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, offlineVerdict, resolveOnPhone } from '../optionResolver';
import { isValidReg, parseRc, readBackReg, snapState } from '../rcParse';
import { isRcTurn, resolveRc, updateRcName } from '../rcResolve';
import { parseResponse } from '../sttClient';
import { autoToastText, planTarget, shouldAutoExecute, slotsForSelect, slotsFromFields, undoSlotsFor, validFields } from '../voiceLogic';
import { decideAdvance, resolveAdvance, type VoiceStepSpec } from '../voiceStep';
import { prettyReg, REG_REGEX } from '../../services/business';

const ROWS = customerOptions([
  { lan: 'L1', name: 'Vikram Rao', vehicle: 'Hero Splendor+', status: 'Pending' },
  { lan: 'L2', name: 'Rahul Sharma', vehicle: 'Honda Activa 6G', status: 'Pending' },
], (r) => r);
const SHEET = { screen: 'RcPendency', expect: 'reg' as const, options: ROWS, fields: [{ id: 'vehicle-reg', kind: 'reg' as const, value: '' }],
  context: { route: 'RcPendency', sheet: 'rc-entry', dealerState: 'MH', customer: { name: 'Vikram Rao', lan: 'L1' } } };
const LIST = { screen: 'RcPendency', options: ROWS, context: { route: 'RcPendency', tab: 'pending', dealerState: 'MH' } };

const PLATES: [string, string][] = [
  ['MH12BC1260', 'MH12BC1260'],
  ['MH 12 BC 1260', 'MH12BC1260'],
  ['registration number is MH12BC1260', 'MH12BC1260'],
  ['RC number is M H 12 B C 1 2 6 0', 'MH12BC1260'],
  ['M H twelve B C one two six zero', 'MH12BC1260'],
  ['em ech twelve bee see 1260', 'MH12BC1260'],
  ['M for Mumbai H for Hotel 12 B C 1260', 'MH12BC1260'],
  ['Mike Hotel 12 Bravo Charlie 1260', 'MH12BC1260'],
  ['22 BH 1234 AA', '22BH1234AA'],
  ['22BH1234AA', '22BH1234AA'],
  ['KH 12 BC 1260', 'MH12BC1260'],
  ['M H double one A B 1234', 'MH11AB1234'],
  ['एम एच 12 बी सी 1260', 'MH12BC1260'],
  ['KA 01 1234', 'KA011234'],
];

test('spoken plate grammar: every FINDINGS utterance → the storage form (REG_REGEX core)', () => {
  for (const [said, want] of PLATES) {
    const p = parseRc(said);
    assert.equal(p?.kind, 'valid', said);
    if (p?.kind !== 'valid') continue;
    assert.equal(p.value, want, said);
    assert.ok(REG_REGEX.test(p.value), `${said}: typed REG_REGEX accepts it`);
    assert.equal(p.display, prettyReg(want));
  }
  assert.equal(readBackReg('MH12BC1260'), 'M H twelve B C one two six zero');
  assert.equal(readBackReg('22BH1234AA'), 'two two B H one two three four A A');
  assert.equal(prettyReg('22BH1234AA'), '22 BH 1234 AA');
  const kh = parseRc('KH 12 BC 1260');
  assert.ok(kh?.kind === 'valid' && kh.snappedFrom === 'KH');
  assert.equal(snapState('KH', 'KA'), 'KA', 'snaps toward the dealer state');
  assert.equal(snapState('EP'), 'AP');
  assert.ok(!isValidReg('KH12BC1260'));
  assert.ok(isValidReg('MH 12 BC 1260'));
});

test('bad state code / shape: spoken correction, nothing filled; digits alone ask for the full number', () => {
  const xq = resolveRc('X Q 12 A B 1234', SHEET)!;
  assert.equal(xq.status, 'retry');
  assert.equal(xq.responseText, 'X Q is not an Indian state code. Say the RC number again, like M H 12 A B 1234.');
  assert.equal(planTarget(xq).kind, 'none');
  for (const t of ['double one', '1 2 6 0', 'M H 12']) {
    const c = resolveRc(t, SHEET)!;
    assert.equal(c.status, 'retry', t);
    assert.equal(c.responseText, 'Say the full RC number, like M H 12 A B 1234.', t);
    assert.ok(!(c.normalizedFields ?? []).some((f) => f.type === 'OTP'), `${t}: never an OTP`);
  }
});

test('RC sheet open: a valid plate fills the field at once (auto + Undo), reads it back, never an OTP', () => {
  assert.ok(isRcTurn(SHEET));
  assert.ok(!isRcTurn(LIST));
  const c = resolveOnPhone('RC number is M H 12 B C 1 2 6 0', SHEET)!;
  assert.equal(c.intent, 'SET_RC_NUMBER');
  assert.equal(c.responseText, 'M H twelve B C one two six zero.');
  assert.deepEqual(c.action, { type: 'fill', field: 'vehicle-reg', value: 'MH12BC1260', display: 'MH 12 BC 1260', customerLan: 'L1' });
  assert.ok(shouldAutoExecute(c, false));
  const t = planTarget(c);
  assert.equal(t.kind, 'fill');
  assert.deepEqual(slotsFromFields(validFields(c)), { rcNumber: 'MH12BC1260' });
  assert.deepEqual(undoSlotsFor(t), ['reg']);
  assert.equal(autoToastText(c, t), 'RC number MH 12 BC 1260');
  assert.equal(offlineVerdict(c, true), 'deliver', 'exact, works offline');
  // An older server's NUMBER 12 + OTP 1260 reading is replaced by the plate.
  const old = parseResponse({ transcript: 'RC number is M H 12 B C 1 2 6 0', intent: 'UNKNOWN', status: 'ok', action: { type: 'none' },
    normalizedFields: [{ type: 'NUMBER', value: '12', valid: true }, { type: 'OTP', value: '1260', valid: true }] });
  const g = guardAnswer(old, old.transcript, SHEET);
  assert.equal(g.intent, 'SET_RC_NUMBER');
  assert.ok(!(g.normalizedFields ?? []).some((f) => f.type === 'OTP'));
  // Same NUMBER + OTP reading on another screen: the plate is read back for Confirm, not an OTP fill.
  const off = guardAnswer(old, old.transcript, { screen: 'Home' });
  assert.equal(off.intent, 'SET_RC_NUMBER');
  assert.equal(off.responseText, 'RC number M H twelve B C one two six zero?');
  assert.ok(!shouldAutoExecute(off, false));
});

test('server SET_RC_NUMBER (CONTRACT S2.4) fills the same way', () => {
  const srv = parseResponse({ intent: 'SET_RC_NUMBER', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'rc_number', method: 'rc_reg',
    action: { type: 'fill', field: 'vehicle-reg', value: 'MH12BC1260', display: 'MH 12 BC 1260', customerLan: 'L1' }, slots: { rcNumber: 'MH12BC1260' },
    responseText: 'M H twelve B C one two six zero.', normalizedFields: [{ type: 'VEHICLE_REG', value: 'MH12BC1260', valid: true, readBack: 'M H twelve B C one two six zero', display: 'MH 12 BC 1260' }] });
  assert.equal(srv.action.type, 'fill');
  assert.ok(shouldAutoExecute(srv, false));
  assert.deepEqual(slotsFromFields(validFields(srv)), { rcNumber: 'MH12BC1260' });
  assert.equal(guardAnswer(srv, 'RC number is M H 12 B C 1 2 6 0', SHEET), srv, 'a field answer is never second-guessed');
});

test('submit is a spoken confirm "Submit MH12BC1260 for Vikram Rao?"; no number → "Say the RC number first"', () => {
  let submitted = 0;
  const step = (valid: boolean): VoiceStepSpec => ({ route: 'RcPendency', sheet: 'rc-entry',
    cta: { id: 'rc-submit', label: 'Submit for verification', destructive: true, enabled: valid, hint: 'Say the RC number first, like M H 12 A B 1234.',
      confirmPrompt: 'Submit MH12BC1260 for Vikram Rao?', press: () => { submitted++; } } });
  for (const t of ['submit', 'proceed', 'aage chaliye', 'haan']) {
    const d = decideAdvance(resolveAdvance(t, step(true))!, step(true));
    assert.equal(d.kind, 'confirm', t);
    assert.equal(d.kind === 'confirm' && d.prompt, 'Submit MH12BC1260 for Vikram Rao?', t);
  }
  assert.equal(submitted, 0, 'never submitted without the spoken yes');
  assert.deepEqual(decideAdvance(resolveAdvance('submit', step(false))!, step(false)), { kind: 'blocked', text: 'Say the RC number first, like M H 12 A B 1234.' });
  // "submit MH 12 BC 1260" — the plate with the submit word: fill + the question naming that plate.
  const both = resolveRc('submit M H 12 B C 1260', SHEET)!;
  assert.equal(both.intent, 'ADVANCE');
  assert.equal(both.action.type === 'advance' && both.action.reg, 'MH12BC1260');
  const d = decideAdvance(both, { ...step(false), cta: { ...step(false).cta!, enabled: true, confirmPrompt: 'Submit  for Vikram Rao?' } });
  assert.equal(d.kind === 'confirm' && d.prompt, 'Submit MH12BC1260 for Vikram Rao?');
  const yes = parseResponse({ intent: 'ADVANCE', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'advance_confirmed', method: 'advance',
    action: { type: 'advance', route: 'RcPendency', sheet: 'rc-entry', cta: 'rc-submit', destructive: true, confirmed: true, reg: 'MH12BC1260', customerLan: 'L1' } });
  assert.equal(decideAdvance(yes, step(true)).kind, 'press');
});

test('"I want to update Vikram Rao\'s RC" opens the row (never Start new loan); off RcPendency it opens RcPendency with the name', () => {
  for (const t of ["I want to update Vikram Rao's RC", "update Vikram Rao's RC", 'update Vikram Rao']) {
    const c = resolveOnPhone(t, LIST)!;
    assert.equal(c.intent, 'SELECT_OPTION', t);
    const st = planTarget(c);
    assert.ok(st.kind === 'select' && slotsForSelect(st).customerLan === 'L1', t);
    const local = localCommand(t, matchCommand(t));
    assert.equal(offlineReading(local, c).intent, 'SELECT_OPTION', `${t}: beats the command list offline`);
    const srvOld = parseResponse({ transcript: t, intent: 'START_NEW_LOAN', score: 0.516, action: { type: 'navigate', route: 'SearchMobile' }, status: 'ok' });
    assert.equal(guardAnswer(srvOld, t, LIST).intent, 'SELECT_OPTION', `${t}: an older server's Start new loan is overridden`);
  }
  assert.equal(updateRcName("I want to update Vikram Rao's RC"), 'Vikram Rao');
  const home = parseResponse({ transcript: "I want to update Vikram Rao's RC", intent: 'START_NEW_LOAN', score: 0.516, action: { type: 'navigate', route: 'SearchMobile' }, status: 'ok' });
  const g = guardAnswer(home, home.transcript, { screen: 'Home' });
  assert.equal(g.intent, 'SHOW_RC_PENDENCY');
  assert.deepEqual(g.action, { type: 'navigate', route: 'RcPendency', customerName: 'Vikram Rao' });
  assert.equal(g.slots?.customerName, 'Vikram Rao');
  const srv = parseResponse({ intent: 'SHOW_RC_PENDENCY', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'rc_customer_by_name',
    action: { type: 'navigate', route: 'RcPendency', customerName: 'Vikram Rao' }, slots: { customerName: 'Vikram Rao' } });
  assert.equal(srv.action.type === 'navigate' && srv.action.customerName, 'Vikram Rao');
  assert.equal(planTarget(srv).kind, 'navigate');
});

test('dealer state biases the snap; a plate on the list (sheet closed) is a Confirm, not a fill', () => {
  const ka = resolveRc('K H 01 A B 1234', { ...SHEET, context: { ...SHEET.context, dealerState: 'KA' } })!;
  assert.equal(ka.action.type === 'fill' && ka.action.value, 'KA01AB1234');
  const list = resolveRc('MH 12 BC 1260', LIST)!;
  assert.equal(list.confidenceBand, 'confirm');
  assert.equal(resolveRc('show pending disbursals', SHEET), null);
});

test('a plain command with an update verb on the RC list is not stolen by the row matcher', () => {
  const nav = parseResponse({ transcript: 'open portfolio', intent: 'OPEN_PORTFOLIO', score: 1, action: { type: 'navigate', route: 'Portfolio' }, status: 'ok', confidenceBand: 'auto', autoExecute: true });
  assert.equal(guardAnswer(nav, 'open portfolio', LIST).intent, 'OPEN_PORTFOLIO');
  const home = parseResponse({ transcript: 'go home', intent: 'GO_HOME', score: 1, action: { type: 'navigate', route: 'Home' }, status: 'ok' });
  assert.equal(guardAnswer(home, 'go home', SHEET).intent, 'GO_HOME');
});
