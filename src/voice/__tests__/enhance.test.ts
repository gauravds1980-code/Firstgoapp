/**
 * v1.4.5 S2.3 Enhance-limit sheet by voice: open with the amount (filter=enhance), enhance-amount field fill with
 * Undo (never maxLoan / SET_LOAN_AMOUNT), amount split from the reason chip, under-min / over-cap explained, the
 * sheet's auto-advance ("15" typed then "1500000", over-cap, under-min, tap during the countdown), voice proceed and
 * the voice-confirmed Send request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoAdvancer } from '../autoAdvance';
import { findReason, resolveEnhance } from '../fieldResolver';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import type { VoiceField, VoiceOption } from '../types';
import { autoToastText, planTarget, sheetSlotsFor, shouldAutoExecute, slotsForSelect, undoSlotsFor, withCandidate } from '../voiceLogic';
import { decideAdvance, resolveAdvance, type VoiceStepSpec } from '../voiceStep';
import { ENHANCE_REASONS, ENHANCE_STEP, enhanceAmountError, enhanceCap } from '../../services/business';

const field = (sanctioned: number, value = sanctioned + ENHANCE_STEP): VoiceField =>
  ({ id: 'enhance-amount', kind: 'amount', label: 'New limit', min: sanctioned + ENHANCE_STEP, max: enhanceCap(sanctioned), step: ENHANCE_STEP, value, current: sanctioned });
const CHIPS: VoiceOption[] = ENHANCE_REASONS.map((r) => ({ id: r.key, kind: 'reason', label: r.label, value: r.key }));
const sheetCtx = (sanctioned = 1000000) => ({ screen: 'TaInf', fields: [field(sanctioned), { id: 'ta-repay', kind: 'amount' as const, utilised: 450000 }], options: CHIPS, context: { route: 'TaInf', sheet: 'enhance', step: 'amount' } });

test('sheet closed: "I need an enhancement of 15 lakhs" opens TaInf with ₹15,00,000 (never Want a loan); the draft carries it', () => {
  for (const [t, n] of [['I need an enhancement of 15 lakhs', 1500000], ['enhancement of 20 lakh', 2000000], ['enhance my limit to 20L', 2000000], ['enhance limit 1.5 million', 1500000]] as const) {
    const c = resolveOnPhone(t, { screen: 'Home' })!;
    assert.equal(c.intent, 'ENHANCE_TA_LIMIT', t);
    assert.deepEqual(c.action, { type: 'navigate', route: 'TaInf', filter: 'enhance', sheet: 'enhance', amount: n }, t);
    assert.equal(c.autoExecute, true);
    assert.deepEqual(sheetSlotsFor(c), { enhanceAmount: n }, `${t}: enhance amount, never a repay amount`);
    const local = localCommand(t, matchCommand(t));
    assert.equal(offlineReading(local, c).intent, 'ENHANCE_TA_LIMIT', `${t}: beats the command list offline`);
  }
  const plain = resolveOnPhone('enhance my limit', { screen: 'TaInf' })!;
  assert.equal(plain.responseText, 'Opening the limit enhancement form.');
  assert.deepEqual(sheetSlotsFor(plain), {});
  // Server answer (CONTRACT S2.3) parses the same way.
  const srv = parseResponse({ intent: 'ENHANCE_TA_LIMIT', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'enhance_sheet',
    action: { type: 'navigate', route: 'TaInf', filter: 'enhance', sheet: 'enhance', amount: 1500000, reason: { id: 'festive', kind: 'reason', label: 'Festive season', value: 'festive' } }, slots: { enhanceAmount: 1500000 } });
  assert.deepEqual(sheetSlotsFor(srv), { enhanceAmount: 1500000, enhanceReasonId: 'festive' });
  // Guard: an older server's START_NEW_LOAN on this amount sentence becomes the phone's enhance reading.
  const old = parseResponse({ transcript: 'I need an enhancement of 15 lakhs', intent: 'START_NEW_LOAN', score: 0.41, action: { type: 'navigate', route: 'SearchMobile' }, status: 'ok' });
  assert.equal(guardAnswer(old, old.transcript, { screen: 'Home' }).intent, 'ENHANCE_TA_LIMIT');
});

test('sheet open (10L facility): explicit phrase fills at once with Undo and advance; bare amount asks first', () => {
  const ctx = sheetCtx();
  const c = resolveOnPhone('I need an enhancement of 15 lakhs', ctx)!;
  assert.equal(c.intent, 'ENHANCE_TA_LIMIT');
  assert.equal(c.responseText, 'New limit set to ₹15,00,000.');
  assert.ok(shouldAutoExecute(c, false));
  const t = planTarget(c);
  assert.equal(t.kind, 'select');
  if (t.kind !== 'select') return;
  assert.deepEqual(slotsForSelect(t), { enhanceAmount: 1500000, enhanceAdvance: true });
  assert.deepEqual(undoSlotsFor(t), ['enhance', 'reason']);
  assert.equal(autoToastText(c, t), 'New limit ₹15,00,000');
  assert.equal(c.action.type === 'select' && c.action.previous, '1050000', 'Undo value');

  const bare = resolveOnPhone('20 lakh', ctx)!;
  assert.equal(bare.responseText, 'Set new limit to ₹20,00,000?');
  assert.equal(bare.confidenceBand, 'confirm');
  assert.ok(!shouldAutoExecute(bare, false));
  assert.notEqual(resolveOnPhone('15,00,000', ctx)?.intent, 'SET_LOAN_AMOUNT');
  assert.equal(resolveOnPhone('15,00,000', ctx)?.responseText, 'Set new limit to ₹15,00,000?');
  assert.equal(resolveOnPhone('20L', ctx)?.responseText, 'Set new limit to ₹20,00,000?', '20 lakh = exactly the cap is allowed');
});

test('amount split from the reason: the spoken reason selects the sheet chip', () => {
  const ctx = sheetCtx();
  const c = resolveOnPhone('enhance my limit to 15 lakh for more inventory', ctx)!;
  assert.equal(c.responseText, 'New limit set to ₹15,00,000. Reason: More inventory.');
  const t = planTarget(c);
  assert.ok(t.kind === 'select' && slotsForSelect(t).enhanceReasonId === 'inventory');
  assert.equal(findReason('festive season stock', CHIPS)?.id, 'festive');
  assert.equal(findReason('diwali', CHIPS)?.id, 'festive');
  assert.equal(findReason('new OEM', CHIPS)?.id, 'newOem');
  const r = resolveOnPhone('festive season', ctx)!;
  assert.equal(r.intent, 'SELECT_OPTION');
  const rt = planTarget(r);
  assert.ok(rt.kind === 'select' && slotsForSelect(rt).enhanceReasonId === 'festive');
  assert.deepEqual(rt.kind === 'select' && undoSlotsFor(rt), ['reason']);
});

test('under min / over cap: explained, no fill, no advance; one-tap candidate sets the limit', () => {
  const big = resolveOnPhone('enhance my limit to 15 lakh', sheetCtx(2500000))!;
  assert.equal(big.status, 'clarify');
  assert.equal(big.responseText, 'Must be above your current ₹25,00,000. Set ₹25,50,000?');
  assert.equal(planTarget(big).kind, 'none');
  const pick = withCandidate(big, big.candidates![0]);
  const pt = planTarget(pick);
  assert.ok(pt.kind === 'select' && slotsForSelect(pt).enhanceAmount === 2550000);
  const over = resolveOnPhone('enhance my limit to 25 lakh', sheetCtx())!;
  assert.equal(over.status, 'clarify');
  assert.equal(over.responseText, '₹25,00,000 is above the maximum of ₹20,00,000. Set ₹20,00,000?');
  const small = resolveOnPhone('15', sheetCtx())!;
  assert.equal(small.status, 'retry');
  assert.equal(small.responseText, 'Say the full amount, like 15 lakh.');
  assert.equal(resolveEnhance('aage badho', 'TaInf'), null, '"aage badho" is ADVANCE, never Enhance');
  assert.equal(resolveEnhance("don't enhance my limit", 'TaInf'), null);
});

test('server field fill (CONTRACT S2.3) keeps previous / advance / reason', () => {
  const srv = parseResponse({ intent: 'ENHANCE_TA_LIMIT', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'enhance_amount',
    action: { type: 'select', id: 'enhance-amount', kind: 'amount', label: '₹15,00,000', value: '1500000', previous: '1050000',
      reason: { id: 'inventory', kind: 'reason', label: 'More inventory', value: 'inventory' }, advance: true } });
  assert.deepEqual(srv.action, { type: 'select', id: 'enhance-amount', kind: 'amount', label: '₹15,00,000', value: '1500000', previous: '1050000', advance: true,
    reason: { id: 'inventory', kind: 'reason', label: 'More inventory', value: 'inventory' } });
  const t = planTarget(srv);
  assert.ok(t.kind === 'select');
  if (t.kind === 'select') assert.deepEqual(slotsForSelect(t), { enhanceAmount: 1500000, enhanceAdvance: true, enhanceReasonId: 'inventory' });
});

test('enhanceAmountError: the sheet rules (not maxLoan)', () => {
  assert.equal(enhanceAmountError(15, '15', 1000000), 'Must be above your current ₹10,00,000');
  assert.equal(enhanceAmountError(1500000, '1500000', 1000000), undefined);
  assert.equal(enhanceAmountError(2000000, '2000000', 1000000), undefined);
  assert.equal(enhanceAmountError(2050000, '2050000', 1000000), 'Up to ₹20,00,000 in this example');
  assert.equal(enhanceAmountError(1520000, '1520000', 1000000), 'Use steps of ₹50,000');
  assert.equal(enhanceAmountError(1500000, '1500000', 2500000), 'Must be above your current ₹25,00,000');
});

function fakeTimers() {
  let now = 0; let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    api: { set: (fn: () => void, ms: number) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; }, clear: (h: unknown) => { q.delete(h as number); } },
    tick(ms: number) { now += ms; for (const [id, t] of [...q]) if (t.at <= now) { q.delete(id); t.fn(); } },
  };
}
/** The sheet's typed path: each keystroke → AutoAdvancer.typed(valid). */
function sheet(sanctioned: number) {
  const clock = fakeTimers();
  let step = 'amount';
  const a = new AutoAdvancer(() => { step = 'reason'; }, 900, clock.api);
  return { clock, a, type: (t: string) => a.typed(!enhanceAmountError(Number(t), t, sanctioned)), get step() { return step; } };
}

test('typed "15" then "1500000": no advance on "15", one advance 900 ms after the last keystroke', () => {
  const s = sheet(1000000);
  s.type('15'); s.clock.tick(3000);
  assert.equal(s.step, 'amount', '"15" is not complete / valid');
  for (const t of ['150', '1500', '15000', '150000', '1500000']) { s.type(t); s.clock.tick(200); }
  assert.equal(s.step, 'amount');
  s.clock.tick(700);
  assert.equal(s.step, 'reason');
});

test('typed over-cap / under-min never advance; editing back to valid does', () => {
  const s = sheet(1000000);
  s.type('2500000'); s.clock.tick(5000);
  assert.equal(s.step, 'amount', 'over cap');
  s.type('1000000'); s.clock.tick(5000);
  assert.equal(s.step, 'amount', 'not above the current limit');
  s.type('1800000'); s.clock.tick(900);
  assert.equal(s.step, 'reason');
});

test('tap Proceed during the countdown: one advance (isAdvancing), the timer is cancelled', () => {
  const s = sheet(1000000);
  let n = 0;
  s.a.setAdvance(() => { n++; });
  s.type('1500000'); s.clock.tick(300);
  assert.ok(s.a.press());
  s.clock.tick(3000);
  assert.equal(n, 1);
  assert.equal(s.a.voice(true), false, 'a voice proceed right after does not double-advance');
});

test('voice proceed on the amount step: Proceed when valid, the reason when not; Send request is a spoken confirm', () => {
  let proceeded = 0; let sent = 0;
  const amountStep = (err?: string): VoiceStepSpec => ({ route: 'TaInf', sheet: 'enhance', step: 'amount',
    cta: { id: 'enhance-proceed', label: 'Proceed', destructive: false, enabled: !err, hint: err, press: () => { proceeded++; } },
    alts: [{ id: 'enhance-send', label: 'Send request', destructive: true, enabled: false, hint: 'Say proceed, then pick a reason.', press: () => { sent++; } }] });
  const ok = decideAdvance(resolveAdvance('aage chaliye', amountStep())!, amountStep());
  assert.equal(ok.kind, 'press');
  if (ok.kind === 'press') ok.control.press();
  assert.equal(proceeded, 1);
  const bad = amountStep('Up to ₹20,00,000 in this example.');
  assert.deepEqual(decideAdvance(resolveAdvance('proceed', bad)!, bad), { kind: 'blocked', text: 'Up to ₹20,00,000 in this example.' });
  assert.equal(resolveAdvance('send request', amountStep())?.responseText, 'Say proceed, then pick a reason.');
  const reasonStep: VoiceStepSpec = { route: 'TaInf', sheet: 'enhance', step: 'reason',
    cta: { id: 'enhance-send', label: 'Send request', destructive: true, enabled: true, confirmPrompt: 'Send the request for a new limit of ₹15,00,000?', press: () => { sent++; } } };
  const d = decideAdvance(resolveAdvance('send request', reasonStep)!, reasonStep);
  assert.deepEqual(d.kind === 'confirm' && d.prompt, 'Send the request for a new limit of ₹15,00,000?');
  assert.equal(sent, 0, 'never sent without the spoken yes');
  const noReason: VoiceStepSpec = { ...reasonStep, cta: { ...reasonStep.cta!, enabled: false, hint: 'Pick a reason first: more inventory, festive demand, new OEM or other.' } };
  assert.equal(decideAdvance(resolveAdvance('proceed', noReason)!, noReason).kind, 'blocked');
});
