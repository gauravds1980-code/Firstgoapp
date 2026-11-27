/**
 * v1.4.5 S2.2 ADVANCE on the phone: grammar (Latin + Devanagari), context-sensitive press per registered step,
 * spoken confirm for destructive steps, "Nothing to continue here" when nothing is registered, never Go home /
 * Enhance / Change tenure; the AutoAdvancer debounce / cancel / isAdvancing guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoAdvancer } from '../autoAdvance';
import { answerPending, askVoiceConfirm } from '../voiceAsk';
import { localCommand, matchCommand } from '../intentMatcher';
import { parseResponse } from '../sttClient';
import { isDestructiveCommand } from '../voiceLogic';
import {
  advanceMatcherGuard, clearVoiceStep, decideAdvance, getVoiceStep, isAdvancePhrase, isAdvanceReply, isNegatedAdvance, isSubmitWord, NOTHING_TEXT,
  resolveAdvance, setVoiceStep, stepContext, type VoiceStepSpec,
} from '../voiceStep';

const PHRASES = ['proceed', 'continue', 'next', 'go ahead', 'aage chaliye', 'aage chalie', 'aage chalo', 'aage badho', 'आगे चलिए', 'आगे बढ़ो',
  'aage chaliye ji', 'aage badho ji', 'proceed please', 'ok continue', 'next step', 'move ahead', 'आगे चलो', 'आगे बढ़िए', 'carry on'];

const press = { n: 0 };
const step = (over: Partial<VoiceStepSpec['cta']> = {}, extra: Partial<VoiceStepSpec> = {}): VoiceStepSpec => ({
  route: 'TaInf', sheet: 'enhance', step: 'amount',
  cta: { id: 'enhance-proceed', label: 'Proceed', destructive: false, enabled: true, press: () => { press.n++; }, ...over },
  ...extra,
});

test('advance grammar: every proceed phrase (Latin and Devanagari) is ADVANCE; others are not', () => {
  for (const p of PHRASES) assert.ok(isAdvancePhrase(p), p);
  for (const p of ['go home', 'limit badhao', 'enhance my limit', 'change tenure', 'proceed with a new loan', 'next month EMI', 'home chalo']) assert.ok(!isAdvancePhrase(p), p);
  for (const p of ["don't proceed", 'mat aage badho', 'do not continue', 'मत आगे बढ़ो']) assert.ok(isNegatedAdvance(p), p);
  for (const p of ['submit', 'send request', 'pay now', 'confirm', 'disburse', 'start KYC']) assert.ok(isSubmitWord(p), p);
});

test('offline matcher: proceed phrases are ADVANCE — never GO_HOME, ENHANCE_TA_LIMIT or CHANGE_TENURE', () => {
  for (const p of PHRASES) {
    const c = advanceMatcherGuard(p, localCommand(p, matchCommand(p)));
    assert.equal(c.intent, 'ADVANCE', p);
    assert.equal(c.action.type, 'advance', p);
    assert.ok(!isDestructiveCommand(c), `${p}: ADVANCE itself is not destructive`);
  }
  assert.equal(advanceMatcherGuard('go ahead', localCommand('go ahead', matchCommand('go ahead'))).intent, 'ADVANCE', '"go ahead" never confirms Go home');
  assert.equal(advanceMatcherGuard('aage badho', localCommand('aage badho', matchCommand('aage badho'))).intent, 'ADVANCE', '"aage badho" never opens Enhance');
  assert.equal(localCommand('go home', matchCommand('go home')).intent, 'GO_HOME', 'go home still goes home');
});

test('nothing registered: "Nothing to continue here", no press', () => {
  clearVoiceStep();
  for (const p of ['proceed', 'go ahead', 'aage chalo']) {
    const c = resolveAdvance(p, getVoiceStep('Home'))!;
    assert.equal(c.intent, 'ADVANCE');
    assert.deepEqual(decideAdvance(c, getVoiceStep('Home')), { kind: 'nothing', text: NOTHING_TEXT });
  }
  assert.equal(resolveAdvance('submit', null), null, 'a submit word with no step goes to the normal matcher');
});

test('plain step: press at once (auto); destructive: spoken confirm with the step prompt; disabled: the hint', () => {
  press.n = 0;
  const plain = step();
  const c = resolveAdvance('aage chaliye', plain)!;
  assert.equal(c.confidenceBand, 'auto');
  assert.deepEqual(c.action, { type: 'advance', route: 'TaInf', sheet: 'enhance', step: 'amount', cta: 'enhance-proceed' });
  const d = decideAdvance(c, plain);
  assert.equal(d.kind, 'press');
  if (d.kind === 'press') d.control.press();
  assert.equal(press.n, 1);

  const send = step({ id: 'enhance-send', label: 'Send request', destructive: true, confirmPrompt: 'Send the request for ₹15,00,000?' }, { step: 'reason' });
  const c2 = resolveAdvance('proceed', send)!;
  assert.equal(c2.confidenceBand, 'confirm');
  assert.equal(c2.autoExecute, false);
  assert.deepEqual(decideAdvance(c2, send), { kind: 'confirm', control: send.cta, prompt: 'Send the request for ₹15,00,000?' });
  // "submit" / "yes" on a destructive sheet step = the same voice-confirm press
  assert.equal(decideAdvance(resolveAdvance('submit', send)!, send).kind, 'confirm');
  assert.equal(decideAdvance(resolveAdvance('haan', send)!, send).kind, 'confirm');

  const off = step({ enabled: false, hint: 'Say an amount between ₹10,50,000 and ₹20,00,000 first.' });
  const c3 = resolveAdvance('next', off)!;
  assert.equal(c3.status, 'retry');
  assert.ok(isAdvanceReply(c3));
  assert.deepEqual(decideAdvance(c3, off), { kind: 'blocked', text: 'Say an amount between ₹10,50,000 and ₹20,00,000 first.' });
  assert.equal(decideAdvance(parseResponse({ intent: 'ADVANCE', action: { type: 'advance' } }), off).kind, 'blocked', 'the app registration is the truth');
});

test('negated advance: "Okay, staying here." and nothing pressed', () => {
  const c = resolveAdvance("don't proceed", step())!;
  assert.equal(c.intent, 'UNKNOWN');
  assert.ok(isAdvanceReply(c));
  assert.deepEqual(decideAdvance(c, step()), { kind: 'nothing', text: 'Okay, staying here.' });
});

test('server answers (CONTRACT S2.2): advance action parsed; confirmed presses; named alt CTA is used', () => {
  const srv = parseResponse({ intent: 'ADVANCE', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'advance', method: 'advance',
    action: { type: 'advance', route: 'TaInf', sheet: 'enhance', step: 'amount', cta: 'enhance-proceed' }, responseText: 'Continuing.' });
  assert.deepEqual(srv.action, { type: 'advance', route: 'TaInf', sheet: 'enhance', step: 'amount', cta: 'enhance-proceed' });
  assert.equal(decideAdvance(srv, step()).kind, 'press');

  const destr = step({ id: 'confirm-kyc', label: 'Confirm & start KYC', destructive: true }, { route: 'Asset', sheet: undefined, step: undefined });
  const ask = parseResponse({ intent: 'ADVANCE', status: 'ok', confidenceBand: 'confirm', autoExecute: false, autoReason: 'advance_destructive', method: 'advance',
    action: { type: 'advance', route: 'Asset', cta: 'confirm-kyc', destructive: true }, responseText: 'Confirm and start KYC?', voiceConfirm: true });
  assert.equal(ask.voiceConfirm, true);
  assert.deepEqual(decideAdvance(ask, destr), { kind: 'confirm', control: destr.cta, prompt: 'Confirm and start KYC?' });
  const yes = parseResponse({ intent: 'ADVANCE', confidenceBand: 'auto', autoExecute: true, autoReason: 'advance_confirmed',
    action: { type: 'advance', route: 'Asset', cta: 'confirm-kyc', destructive: true, confirmed: true } });
  assert.equal(decideAdvance(yes, destr).kind, 'press');

  // "send request" on the enhance AMOUNT step: the server names the sheet's final CTA → the registered alt.
  const sendAlt = { id: 'enhance-send', label: 'Send request', destructive: true, enabled: false, hint: 'Pick a reason first.', press: () => {} };
  const withAlt = step({}, { alts: [sendAlt] });
  const srvSend = parseResponse({ intent: 'ADVANCE', confidenceBand: 'confirm', autoReason: 'advance_destructive', method: 'advance', action: { type: 'advance', cta: 'enhance-send', destructive: true } });
  assert.deepEqual(decideAdvance(srvSend, withAlt), { kind: 'blocked', text: 'Pick a reason first.' });
  assert.equal(resolveAdvance('send request', withAlt)?.status, 'retry', 'offline: same — the final CTA is not ready');
});

test('a longer sentence the command list matched to ADVANCE is "say again", not a press', () => {
  const fake = parseResponse({ intent: 'ADVANCE', score: 0.7, method: 'keyword', action: { type: 'advance' }, status: 'ok' });
  const g = advanceMatcherGuard('proceed with a new loan for ramesh', fake);
  assert.equal(g.intent, 'UNKNOWN');
  assert.equal(g.status, 'retry');
});

test('step registry: newest sheet wins, extras merge, route-scoped, press never sent', () => {
  clearVoiceStep();
  const a = setVoiceStep({ route: 'RcPendency', extra: { tab: 'pending', dealerState: 'MH' } });
  const b = setVoiceStep({ route: 'RcPendency', sheet: 'rc-entry', cta: { id: 'rc-submit', label: 'Submit', destructive: true, enabled: true, press: () => {} }, extra: { customer: { name: 'Vikram Rao', lan: 'L1' } } });
  const ctx = stepContext(getVoiceStep('RcPendency'));
  assert.deepEqual(ctx, { tab: 'pending', dealerState: 'MH', customer: { name: 'Vikram Rao', lan: 'L1' }, sheet: 'rc-entry', cta: { id: 'rc-submit', label: 'Submit', destructive: true, enabled: true } });
  assert.equal(getVoiceStep('Home'), null);
  clearVoiceStep(b);
  assert.deepEqual(stepContext(getVoiceStep('RcPendency')), { tab: 'pending', dealerState: 'MH' });
  clearVoiceStep(a);
  assert.equal(getVoiceStep('RcPendency'), null);
});

/** Manual timers for the AutoAdvancer. */
function fakeTimers() {
  let now = 0; let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    api: { set: (fn: () => void, ms: number) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; }, clear: (h: unknown) => { q.delete(h as number); } },
    tick(ms: number) { now += ms; for (const [id, t] of [...q]) if (t.at <= now) { q.delete(id); t.fn(); } },
  };
}

test('auto-advance: "15" typed then "1500000" advances once, 900 ms after the last keystroke', () => {
  const clock = fakeTimers();
  let n = 0;
  const a = new AutoAdvancer(() => { n++; }, 900, clock.api);
  const valid = (v: number) => v >= 1050000 && v <= 2000000;
  a.typed(valid(15));            // "15": below min, no countdown
  clock.tick(2000);
  assert.equal(n, 0);
  for (const v of [150, 1500, 15000, 150000, 1500000]) { a.typed(valid(v)); clock.tick(300); }
  assert.equal(n, 0, 'still inside the debounce');
  clock.tick(600);
  assert.equal(n, 1);
  a.typed(true); clock.tick(2000);
  assert.equal(n, 1, 'isAdvancing: one advance per step');
});

test('auto-advance: over-cap / under-min never advance; an edit cancels; voice advances at once', () => {
  const clock = fakeTimers();
  let n = 0;
  const a = new AutoAdvancer(() => { n++; }, 900, clock.api);
  a.typed(false); clock.tick(5000); // 25 lakh on a 20 lakh cap
  assert.equal(n, 0);
  a.typed(true); clock.tick(500); a.typed(false); clock.tick(5000); // edited to an invalid value mid-countdown
  assert.equal(n, 0);
  a.typed(true); clock.tick(500); a.cancel(); clock.tick(5000); // slider drag cancels
  assert.equal(n, 0);
  assert.equal(a.voice(false), false);
  assert.equal(a.voice(true), true);
  assert.equal(n, 1);
});

test('auto-advance: a tap during the countdown advances once (no double navigation); reset re-arms', () => {
  const clock = fakeTimers();
  let n = 0;
  const a = new AutoAdvancer(() => { n++; }, 900, clock.api);
  a.typed(true); clock.tick(400);
  assert.equal(a.pending, true);
  assert.equal(a.press(), true);
  clock.tick(2000);
  assert.equal(n, 1, 'the timer was cancelled by the tap');
  assert.equal(a.press(), false, 'second tap ignored');
  assert.equal(a.voice(true), false, 'voice proceed ignored too');
  a.reset();
  a.typed(true); clock.tick(900);
  assert.equal(n, 2);
});

test('an advance phrase answers an open spoken question as yes ("Confirm and start KYC?" → "aage chaliye")', () => {
  let yes = 0;
  const withdraw = askVoiceConfirm({ prompt: 'Confirm and start KYC?', onYes: () => { yes++; } });
  assert.equal(answerPending('show payouts', undefined, isAdvancePhrase), null, 'a command is not an answer');
  assert.equal(answerPending('aage chaliye', undefined, isAdvancePhrase), 'yes');
  assert.equal(yes, 1);
  withdraw();
  askVoiceConfirm({ prompt: 'Send request?', onYes: () => { yes++; } });
  assert.equal(answerPending("don't proceed", undefined, isAdvancePhrase), 'no');
  assert.equal(yes, 1);
});
