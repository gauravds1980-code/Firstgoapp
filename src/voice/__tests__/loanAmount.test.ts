/**
 * v1.4.5 SET_LOAN_AMOUNT on the Asset screen: the server's answer (CONTRACT.md 3.1) and the phone's offline reading
 * (fieldResolver / optionResolver.resolveOnPhone) both set the loan slider, never navigate. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldDefaults } from './fieldFixtures';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, offlineVerdict, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import type { CommandResponse, VoiceField } from '../types';
import { autoToastText, candidateLabel, planTarget, shouldAutoExecute, slotsForSelect, undoSlotsFor, withCandidate } from '../voiceLogic';

const FIELD: VoiceField = { id: 'loan-amount', kind: 'amount', label: 'Loan amount', min: 30000, max: 150000, step: 5000, value: 135000 };
const ctx = applyFieldDefaults({ screen: 'Asset', fields: [FIELD] });
const phone = (text: string, c = ctx) => resolveOnPhone(text, c);

/** What the phone does with an answer: the slider value it sets (null = nothing set), auto or Confirm. */
function outcome(cmd: CommandResponse): { set: number | null; auto: boolean; nav: boolean } {
  const t = planTarget(cmd);
  const set = t.kind === 'select' ? slotsForSelect(t).loanAmount ?? null : null;
  return { set, auto: shouldAutoExecute(cmd, false), nav: t.kind === 'navigate' };
}

const EXPLICIT: [string, number][] = [
  ['loan amount 1 lakh', 100000], ['loan 1 lakh', 100000], ['set loan amount to 80000', 80000], ['1 lakh ka loan', 100000],
  ['loan dedh lakh karo', 150000], ['लोन अमाउंट एक लाख कर दो', 100000], ['loan amount 1.2 lakh', 120000], ['loan amount 1,02,500', 105000],
];
const BARE: [string, number][] = [['one lakh', 100000], ['ek lakh', 100000], ['95 thousand', 95000], ['1.2 lakh', 120000], ['1,10,000', 110000], ['dedh lakh', 150000], ['95k', 95000]];

test('offline: explicit loan amount sets the slider at once (Undo), rounded to the step', () => {
  for (const [text, want] of EXPLICIT) {
    const c = phone(text);
    assert.ok(c, text);
    assert.equal(c.intent, 'SET_LOAN_AMOUNT', text);
    assert.deepEqual(outcome(c), { set: want, auto: true, nav: false }, text);
    assert.deepEqual(undoSlotsFor(planTarget(c)), ['loan'], `${text}: Undo restores the slider`);
    assert.equal(autoToastText(c, planTarget(c)), `Loan amount ₹${want.toLocaleString('en-IN')}`);
  }
});

test('offline: a bare amount asks first ("Set loan amount to ₹1,00,000?")', () => {
  for (const [text, want] of BARE) {
    const c = phone(text)!;
    assert.equal(c.intent, 'SET_LOAN_AMOUNT', text);
    assert.deepEqual(outcome(c), { set: want, auto: false, nav: false }, text);
    assert.match(c.responseText ?? '', /^Set loan amount to ₹/);
  }
});

test('offline: over max / under min offers the clamped value; picking it sets that value', () => {
  const over = phone('loan amount 2 lakh')!;
  assert.equal(over.status, 'clarify');
  assert.equal(over.responseText, '₹2,00,000 is above the limit of ₹1,50,000. Set ₹1,50,000?');
  assert.equal(outcome(over).set, null, 'nothing set before the pick');
  const picked = withCandidate(over, over.candidates![0]);
  assert.equal(candidateLabel(over.candidates![0]), 'Set ₹1,50,000');
  assert.deepEqual(outcome(picked), { set: 150000, auto: false, nav: false });
  const under = phone('loan amount 20000')!;
  assert.equal(under.responseText, '₹20,000 is below the minimum of ₹30,000. Set ₹30,000?');
  assert.equal(slotsForSelect(planTarget(withCandidate(under, under.candidates![0])) as never).loanAmount, 30000);
});

test('offline: never navigates; "loan amount" alone asks for the number; off the vehicle screen it says where', () => {
  assert.equal(phone('loan amount')!.status, 'retry');
  assert.equal(phone('loan amount')!.responseText, 'Say the loan amount, like one lakh. It is ₹1,35,000 now.');
  const home = phone('loan amount 1 lakh', { screen: 'Home' })!;
  assert.equal(home.responseText, 'You can set the loan amount on the vehicle screen.');
  assert.equal(planTarget(home).kind, 'none');
  assert.equal(phone('one lakh', { screen: 'Home' }), null, 'a bare amount elsewhere is not a loan amount');
});

test('offline: the field answer beats the command list and is delivered with every route down', () => {
  for (const [text] of [...EXPLICIT, ...BARE]) {
    const local = localCommand(text, matchCommand(text));
    const off = offlineReading(local, phone(text));
    assert.equal(off.intent, 'SET_LOAN_AMOUNT', text);
    assert.equal(offlineVerdict(off, true), 'deliver', text);
  }
  assert.equal(offlineVerdict(phone('loan amount 2 lakh')!, true), 'deliver', 'clamp offer is exact, not a fuzzy guess');
});

test('Asset chips still work next to the field: "select Vida", "extreme 125 r", "24 months"', () => {
  const chips = { ...ctx, options: [
    { id: 'hero-vida', kind: 'vehicle_model', label: 'Hero Vida V2', brand: 'Hero MotoCorp', model: 'Vida V2', value: 'hero-vida' },
    { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', brand: 'Hero MotoCorp', model: 'Xtreme 125R', value: 'hero-xtreme' },
    { id: 'tenure-24', kind: 'tenure', label: '24 months', value: '24' },
  ] };
  assert.equal(phone('select Vida', chips)?.action.type === 'select' && (phone('select Vida', chips)!.action as { id: string }).id, 'hero-vida');
  assert.equal((phone('extreme 125 r', chips)!.action as { id: string }).id, 'hero-xtreme');
  assert.equal(phone('extreme 125 r', chips)!.autoExecute, true);
  assert.equal((phone('24 months', chips)!.action as { id: string }).id, 'tenure-24');
});

const server = (body: Record<string, unknown>) => parseResponse({ transcript: 'x', confidence: 0.9, ...body });

test('server: SET_LOAN_AMOUNT auto / bare confirm / clamp clarify are consumed as a slider set', () => {
  const auto = server({
    transcript: 'loan amount 1 lakh', intent: 'SET_LOAN_AMOUNT', method: 'amount', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'loan_amount', score: 0.95,
    action: { type: 'select', id: 'loan-amount', kind: 'amount', label: '₹1,00,000', value: '100000', previous: '135000' }, slots: { loanAmount: 100000 },
    responseText: 'Loan amount set to ₹1,00,000.',
  });
  assert.deepEqual(outcome(guardAnswer(auto, auto.transcript, ctx)), { set: 100000, auto: true, nav: false });
  const bare = server({ ...auto, transcript: 'one lakh', confidenceBand: 'confirm', autoExecute: false, autoReason: 'loan_amount_bare' });
  assert.deepEqual(outcome(bare), { set: 100000, auto: false, nav: false });
  const clamp = server({
    transcript: 'loan amount 2 lakh', intent: 'SET_LOAN_AMOUNT', method: 'amount', status: 'clarify', confidenceBand: 'clarify', autoExecute: false, action: { type: 'none' },
    responseText: '₹2,00,000 is above the limit of ₹1,50,000. Set ₹1,50,000?',
    candidates: [{ intent: 'SET_LOAN_AMOUNT', phrase: 'Set ₹1,50,000', score: 0.6, option: { id: 'loan-amount', kind: 'amount', label: '₹1,50,000', value: '150000' } }],
  });
  assert.equal(outcome(clamp).set, null);
  assert.equal(outcome(withCandidate(clamp, clamp.candidates![0])).set, 150000);
  assert.equal(slotsForSelect(planTarget(auto) as never).downPayment, undefined, 'never a down payment');
});

test('server: an older server that navigates on an amount is overridden (never START_NEW_LOAN / SearchMobile)', () => {
  for (const [text, intent] of [['loan 1 lakh', 'START_MOBILE_JOURNEY'], ['set loan amount to 80000', 'START_MOBILE_JOURNEY'], ['loan amount 1 lakh', 'START_NEW_LOAN']] as const) {
    const old = server({ transcript: text, intent, status: 'ok', autoExecute: true, confidenceBand: 'auto', score: 0.9, action: { type: 'navigate', route: 'SearchMobile' } });
    const g = guardAnswer(old, text, ctx);
    assert.equal(g.intent, 'SET_LOAN_AMOUNT', text);
    assert.equal(outcome(g).nav, false, text);
    const off = guardAnswer(old, text, { screen: 'Home' });
    assert.equal(outcome(off).nav, false, `${text} on Home`);
    assert.equal(off.responseText, 'You can set the loan amount on the vehicle screen.');
  }
  const start = server({ transcript: 'start a new loan of 1 lakh', intent: 'START_NEW_LOAN', status: 'ok', action: { type: 'navigate', route: 'SearchMobile' } });
  assert.equal(guardAnswer(start, start.transcript, ctx), start, 'an explicit start verb keeps the journey');
});
