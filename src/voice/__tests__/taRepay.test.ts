/**
 * v1.4.5 TA_REPAY / ENHANCE_TA_LIMIT on TaInf (server answer per CONTRACT.md 3.2 / 3.3 and the offline phone
 * resolver) and the generic spoken yes / no confirm (voiceAsk). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, offlineVerdict, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import type { CommandResponse, VoiceField } from '../types';
import { answerPending, askVoiceConfirm, parseYesNo, pendingQuestion, subscribeVoiceAsk } from '../voiceAsk';
import { isDestructiveCommand, planTarget, shouldAutoExecute, withCandidate } from '../voiceLogic';
import { oneTapActs } from '../voiceMode';

const TA: VoiceField = { id: 'ta-repay', kind: 'amount', label: 'Repay amount', utilised: 450000 };
const onTa = { screen: 'TaInf', fields: [TA] };
const phone = (text: string, ctx: Parameters<typeof resolveOnPhone>[1] = onTa) => resolveOnPhone(text, ctx);
const sheet = (c: CommandResponse) => (c.action.type === 'navigate' ? c.action : null);

const AMOUNT: [string, number][] = [['pay 80000', 80000], ['pay 80k', 80000], ['repay 80000', 80000], ['repay 80k', 80000], ['pay 5 lakh', 500000], ['80 hazaar jama karo', 80000], ['pay 1,20,000', 120000]];

test('offline: "pay 80000" is ALWAYS a Confirm card "Repay ₹80,000 on Trade Advance?" that opens the repay sheet', () => {
  for (const [text, want] of AMOUNT.filter(([, n]) => n <= 450000)) {
    const c = phone(text)!;
    assert.equal(c.intent, 'TA_REPAY', text);
    assert.equal(c.status, 'ok');
    assert.equal(c.confidenceBand, 'confirm');
    assert.equal(shouldAutoExecute(c, false), false, `${text}: never auto`);
    assert.equal(isDestructiveCommand(c), true);
    assert.equal(c.responseText, `Repay ₹${want.toLocaleString('en-IN')} on Trade Advance?`);
    assert.deepEqual(sheet(c), { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', amount: want });
    assert.equal(planTarget(c).kind, 'navigate', 'Confirm opens the sheet on TaInf (same screen)');
  }
});

test('offline: full / over utilised / nothing / no amount', () => {
  for (const text of ['pay full', 'repay full amount', 'poora chuka do']) {
    const c = phone(text)!;
    assert.equal(c.responseText, 'Repay the full ₹4,50,000 on Trade Advance?', text);
    assert.deepEqual(sheet(c), { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', full: true, amount: 450000 });
    assert.equal(c.slots?.repayAll, true);
  }
  const over = phone('pay 5 lakh')!;
  assert.equal(over.status, 'clarify');
  assert.equal(over.responseText, 'Repay the full ₹4,50,000?');
  const staged = withCandidate(over, over.candidates![0]);
  assert.equal(staged.status, 'ok');
  assert.deepEqual(sheet(staged), { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', full: true, amount: 450000 });
  assert.equal(oneTapActs(staged), false, 'the full repay still needs Confirm');
  const none = phone('pay 80000', { screen: 'TaInf', fields: [{ ...TA, utilised: 0 }] })!;
  assert.equal(none.responseText, 'Nothing to repay.');
  assert.equal(planTarget(none).kind, 'none');
  for (const text of ['pay', 'repay']) {
    const c = phone(text)!;
    assert.equal(c.responseText, 'How much?', text);
    assert.equal(c.expectNext, 'amount');
    assert.equal(c.status, 'retry');
  }
  const next = phone('80000', { ...onTa, expect: 'amount' })!;
  assert.equal(next.responseText, 'Repay ₹80,000 on Trade Advance?', 'the next bare amount answers "How much?"');
});

test('offline: never Auto pay; "auto pay" is still the mandate; "don\'t pay" is not a repay', () => {
  for (const [text] of AMOUNT) {
    const local = localCommand(text, matchCommand(text));
    const off = offlineReading(local, phone(text));
    assert.equal(off.intent, 'TA_REPAY', text);
    assert.ok(!(off.candidates ?? []).some((c) => c.intent === 'SETUP_UPI_MANDATE'), text);
    assert.equal(offlineVerdict(off, true), 'deliver', `${text}: exact, delivered with every route down`);
  }
  assert.equal(phone('auto pay'), null);
  assert.equal(localCommand('auto pay', matchCommand('auto pay')).intent, 'SETUP_UPI_MANDATE');
  assert.equal(phone("don't pay"), null);
});

test('offline + server: "enhance my limit" / "limit badhao" open the Enhance sheet in place', () => {
  for (const text of ['enhance my limit', 'limit badhao', 'increase limit']) {
    const c = phone(text)!;
    assert.equal(c.intent, 'ENHANCE_TA_LIMIT', text);
    assert.deepEqual(sheet(c), { type: 'navigate', route: 'TaInf', filter: 'enhance', sheet: 'enhance' });
    assert.equal(shouldAutoExecute(c, false), true, 'opening the form is reversible; submit stays a tap');
  }
});

const server = (b: Record<string, unknown>) => parseResponse({ confidence: 0.9, ...b });

test('server: TA_REPAY contract answers are consumed the same way (sheet amount / full parsed, Confirm only)', () => {
  const c = server({
    transcript: 'pay 80000', intent: 'TA_REPAY', method: 'ta_repay', status: 'ok', confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive', score: 0.9,
    action: { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', amount: 80000 }, slots: { repayAmount: 80000 }, responseText: 'Repay ₹80,000 on Trade Advance?',
  });
  assert.deepEqual(sheet(c), { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', amount: 80000 });
  assert.equal(shouldAutoExecute(c, false), false);
  assert.equal(guardAnswer(c, 'pay 80000', onTa), c);
  const over = server({
    transcript: 'pay 5 lakh', intent: 'TA_REPAY', status: 'clarify', action: { type: 'none' }, responseText: 'Repay the full ₹4,50,000?',
    candidates: [{ intent: 'TA_REPAY', phrase: 'Repay the full ₹4,50,000', score: 0.6, action: { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', full: true, amount: 450000 },
      slots: { repayAll: true, repayAmount: 450000 }, option: { id: 'ta-repay', kind: 'amount', label: '₹4,50,000', value: '450000', full: true } }],
  });
  const staged = withCandidate(over, over.candidates![0]);
  assert.deepEqual(sheet(staged), { type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', full: true, amount: 450000 });
  assert.equal(staged.slots?.repayAll, true);
});

test('server: an older server mapping "pay 80000" to the mandate is replaced by the repay reading', () => {
  for (const text of ['pay 80000', 'pay 80k']) {
    const old = server({ transcript: text, intent: 'SETUP_UPI_MANDATE', score: 0.5, status: 'ok', action: { type: 'navigate', route: 'Mandate' } });
    const g = guardAnswer(old, text, onTa);
    assert.equal(g.intent, 'TA_REPAY', text);
    assert.notEqual(planTarget(g).kind === 'navigate' && (g.action as { route: string }).route, 'Mandate');
  }
  const auto = server({ transcript: 'auto pay', intent: 'SETUP_UPI_MANDATE', score: 1, status: 'ok', action: { type: 'navigate', route: 'Mandate' } });
  assert.equal(guardAnswer(auto, 'auto pay', onTa), auto, '"auto pay" stays the mandate');
});

test('voiceAsk: parseYesNo reads short yes / no answers only', () => {
  for (const t of ['yes', 'Yes.', 'haan', 'haan ji', 'ok', 'yes pay', 'हाँ', 'ji haan', 'confirm', 'theek hai']) assert.equal(parseYesNo(t, ['pay']), 'yes', t);
  for (const t of ['no', 'cancel', 'nahi', "don't pay", 'नहीं', 'no stop']) assert.equal(parseYesNo(t, ['pay']), 'no', t);
  for (const t of ['open payouts', 'pay 80000', 'kar do', '', 'yes yes yes yes yes yes']) assert.equal(parseYesNo(t, ['pay']), null, t);
});

test('voiceAsk: a spoken yes runs the same onYes as the button; no runs onNo; withdraw clears it', () => {
  const events: string[] = [];
  const off = subscribeVoiceAsk((e) => events.push(e.kind === 'ask' ? `ask:${e.q.prompt}` : e.kind));
  let paid = 0; let closed = 0;
  const withdraw = askVoiceConfirm({ prompt: 'Pay ₹80,000 now? Say yes to pay.', onYes: () => { paid++; }, onNo: () => { closed++; }, yesWords: ['pay'] });
  assert.deepEqual(events, ['ask:Pay ₹80,000 now? Say yes to pay.']);
  assert.equal(answerPending('open payouts'), null, 'a command is not an answer; the question stays');
  assert.ok(pendingQuestion());
  assert.equal(answerPending('yes pay'), 'yes');
  assert.equal(paid, 1);
  assert.equal(pendingQuestion(), null, 'answered once');
  assert.equal(answerPending('yes'), null, 'no second payment');
  askVoiceConfirm({ prompt: 'Pay ₹80,000 now? Say yes to pay.', onYes: () => { paid++; }, onNo: () => { closed++; } });
  assert.equal(answerPending('nahi'), 'no');
  assert.equal(closed, 1);
  assert.equal(paid, 1);
  const w2 = askVoiceConfirm({ prompt: 'x', onYes: () => { paid++; } });
  w2();
  assert.equal(answerPending('yes'), null, 'withdrawn when the sheet closed');
  withdraw();
  const expired = askVoiceConfirm({ prompt: 'x', onYes: () => { paid++; }, ttlMs: 10 });
  assert.equal(answerPending('yes', Date.now() + 1000), null, 'expired');
  expired();
  assert.equal(paid, 1);
  off();
});
