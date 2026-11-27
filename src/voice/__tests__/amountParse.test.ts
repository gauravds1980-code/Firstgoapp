/**
 * v1.4.5 shared amount parser (phone mirror of the server's amounts.find_amount), the numeric field registry and
 * the local matcher's "an amount never navigates" guard. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampOffer, findAmount, formatInr, hasScaledAmount, roundToStep } from '../amountParse';
import { amountBlocksNavigation, localCommand, matchCommand, needsServerText, payIsNotMandate } from '../intentMatcher';
import { clearVoiceFields, getVoiceField, getVoiceFields, setVoiceFields } from '../voiceOptions';
import { planTarget } from '../voiceLogic';

const AMOUNTS: [string, number][] = [
  ['loan amount 1 lakh', 100000], ['loan 1 lakh', 100000], ['set loan amount to 80000', 80000], ['one lakh', 100000],
  ['ek lakh', 100000], ['एक लाख', 100000], ['95 thousand', 95000], ['95k', 95000], ['80 hazaar', 80000], ['पचानवे हज़ार', 95000],
  ['1.2 lakh', 120000], ['1.25 lakh', 125000], ['2.5L', 250000], ['5 L', 500000], ['1,10,000', 110000], ['110,000', 110000],
  ['₹1,35,000', 135000], ['२ लाख', 200000], ['dedh lakh', 150000], ['sava lakh', 125000], ['sava do lakh', 225000],
  ['dhai lakh', 250000], ['saade teen lakh', 350000], ['paune do lakh', 175000], ['1 lakh 20 thousand', 120000],
  ['one lakh twenty thousand', 120000], ['1 lakh ka loan', 100000], ['लोन अमाउंट एक लाख कर दो', 100000], ['pay 80000', 80000],
  ['pay 80k', 80000], ['pay 5 lakh', 500000], ['80 hazaar jama karo', 80000], ['loan dedh lakh karo', 150000],
];

test('amounts: every RCA form parses to the same rupees as the server (1.2 lakh is 1,20,000, never 3 lakh)', () => {
  for (const [text, want] of AMOUNTS) {
    const hit = findAmount(text);
    assert.ok(hit, text);
    assert.equal(hit.value, want, text);
    assert.equal(hit.scaled, true, `${text}: money-looking`);
  }
});

test('amounts: tenures, model numbers, phones and plain words are not amounts', () => {
  for (const text of ['24 months', '2 saal', 'select extreme 125 r', 'bullet 350', 'xtreme 125', '9876543210', 'pay full', 'loan amount kar do', 'select vida', '']) {
    assert.equal(findAmount(text), null, text);
  }
  assert.equal(hasScaledAmount('24 months'), false);
});

test('amounts: Indian grouping is money, never a PIN code; formatInr uses Indian grouping', () => {
  assert.deepEqual(findAmount('1,10,000'), { value: 110000, scaled: true, raw: '110000' });
  assert.equal(formatInr(100000), '₹1,00,000');
  assert.equal(formatInr(1250000), '₹12,50,000');
  assert.equal(formatInr(95000), '₹95,000');
  assert.equal(formatInr(500), '₹500');
});

test('amounts: step rounding is half up; clamp offers the limit on the step grid', () => {
  assert.equal(roundToStep(102500, 5000), 105000);
  assert.equal(roundToStep(102499, 5000), 100000);
  assert.equal(roundToStep(123, undefined), 123);
  assert.deepEqual(clampOffer(200000, { min: 30000, max: 150000, step: 5000 }), ['over', 150000]);
  assert.deepEqual(clampOffer(20000, { min: 30000, max: 150000, step: 5000 }), ['under', 30000]);
  assert.deepEqual(clampOffer(20000, { min: 32000, max: 150000, step: 5000 }), ['under', 35000]);
  assert.equal(clampOffer(100000, { min: 30000, max: 150000, step: 5000 }), null);
});

test('fields: register / route-scope / clear like setVoiceOptions', () => {
  const tok = setVoiceFields([{ id: 'loan-amount', kind: 'amount', min: 30000, max: 150000, step: 5000, value: 135000 }], 'Asset');
  assert.equal(getVoiceFields('Asset').length, 1);
  assert.equal(getVoiceFields('Home').length, 0, 'never leaks to another route');
  assert.equal(getVoiceField('loan-amount', getVoiceFields('Asset'))?.max, 150000);
  clearVoiceFields(tok + 1); // stale token: no effect
  assert.equal(getVoiceFields('Asset').length, 1);
  clearVoiceFields(tok);
  assert.equal(getVoiceFields('Asset').length, 0);
});

test('fields: a screen with fields always asks the server text path', () => {
  assert.equal(needsServerText('pay full', { fields: [{ id: 'ta-repay' }] }), true);
  assert.equal(needsServerText('one lakh'), true);
  assert.equal(needsServerText('पचानवे हज़ार'), true);
  assert.equal(needsServerText('open payouts'), false);
});

test('matcher: an amount phrase never maps locally to START_NEW_LOAN / "want a loan" or any navigation', () => {
  for (const text of ['loan amount 1 lakh', 'loan 1 lakh', 'set loan amount to 80000', 'one lakh', 'ek lakh', '95 thousand', '1.2 lakh', '1,10,000', '1 lakh ka loan', 'loan amount 2 lakh']) {
    assert.equal(amountBlocksNavigation(text), true, text);
    const m = matchCommand(text);
    const c = localCommand(text, m);
    assert.ok(!['START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'NEW_TWO_WHEELER_LOAN', 'SEARCH_MOBILE_NUMBER'].includes(c.intent), `${text}: ${c.intent}`);
    assert.ok(!(c.candidates ?? []).some((x) => x.intent === 'START_NEW_LOAN' || x.phrase.toLowerCase() === 'want a loan'), `${text}: no "Want a loan"`);
    const t = planTarget(c);
    assert.notEqual(t.kind, 'navigate', `${text}: never navigates`);
    assert.notEqual(c.autoExecute, true, `${text}: nothing acts from the command list alone`);
  }
});

test('matcher: an explicit start verb keeps the journey; down payment keeps its route', () => {
  assert.equal(amountBlocksNavigation('start a new loan of 1 lakh'), false);
  assert.equal(matchCommand('start a new loan of 1 lakh').intent, 'START_NEW_LOAN');
  assert.equal(amountBlocksNavigation('down payment 15000'), false);
  assert.equal(matchCommand('want a loan').intent, 'START_NEW_LOAN');
});

test('matcher: "pay <amount>" never suggests Auto pay; "auto pay" is still the mandate', () => {
  for (const text of ['pay 80000', 'pay 80k', 'repay 80000', 'pay 5 lakh', 'pay full', 'pay']) {
    assert.equal(payIsNotMandate(text), true, text);
    const c = localCommand(text, matchCommand(text));
    assert.notEqual(c.intent, 'SETUP_UPI_MANDATE', text);
    assert.ok(!(c.candidates ?? []).some((x) => x.intent === 'SETUP_UPI_MANDATE'), `${text}: no "Auto pay" candidate`);
    assert.notEqual(c.autoExecute, true, `${text}: a repay is never auto`);
  }
  assert.equal(matchCommand('auto pay').intent, 'SETUP_UPI_MANDATE');
  assert.equal(matchCommand('set up UPI mandate').intent, 'SETUP_UPI_MANDATE');
});
