/**
 * v1.4.8 Payout statement by voice: phrases → intents (phone-side, no server needed), the answer (period / filter /
 * line / query, spoken statement fields), and that Money in flight, alerts, payouts and proceed / aage chaliye keep
 * their own readings. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDealerProfile } from '../../services/dealer';
import { statementInvoicesFor } from '../../services/payoutStatement';
import { answerPayoutQuery, parsePayoutQuery, payoutQueryFor } from '../payoutVoice';
import { parseMoneyQuery } from '../moneyVoice';
import { parseAlertsQuery } from '../alertsVoice';
import { resolveAdvance } from '../voiceStep';

const L1 = '9800001111', HERO = '9800004444';
const inv = (m: string) => statementInvoicesFor(m, mockDealerProfile(m).profile);

test('statement phrases → SHOW_PAYOUT_STATEMENT with the right period', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['payout statement dikhao', {}], ['mera payout statement dikhao', {}], ['show my payout statement', {}], ['commission statement', {}],
    ['is mahine ka payout', { period: 'thisMonth' }], ['is mahine ka statement', { period: 'thisMonth' }], ["this month's payout", { period: 'thisMonth' }],
    ['pichhle mahine ka payout', { period: 'lastMonth' }], ['last month payout statement', { period: 'lastMonth' }],
    ['last 3 months ka payout', { period: 'last3Months' }], ['October ka statement', { month: 9 }], ['november ka payout', { month: 10 }],
    ['पेआउट स्टेटमेंट दिखाओ', {}],
  ];
  for (const [t, extra] of cases) {
    const q = parsePayoutQuery(t);
    assert.ok(q, t);
    assert.equal(q!.intent, 'SHOW_PAYOUT_STATEMENT', t);
    for (const [k, v] of Object.entries(extra)) assert.equal((q as unknown as Record<string, unknown>)[k], v, `${t} ${k}`);
  }
});

test('short-pay phrases → SHOW_SHORT_PAYS (never Money in flight)', () => {
  for (const t of ['short payment kahan hai', 'short pay kahan hai', 'any short pay', 'show short payments', 'kam payout kahan hai', 'difference dikhao', 'koi short payment hai', 'short paid dikhao']) {
    assert.equal(parsePayoutQuery(t)?.intent, 'SHOW_SHORT_PAYS', t);
    assert.equal(parseMoneyQuery(t), null, `MIF must not read: ${t}`);
    assert.equal(parseAlertsQuery(t), null, `alerts must not read: ${t}`);
  }
});

test('line + query phrases', () => {
  assert.deepEqual(parsePayoutQuery('CR-20320 ka payout'), { kind: 'line', intent: 'SHOW_PAYOUT_LINE', lan: 'CR-20320' });
  assert.deepEqual(parsePayoutQuery('Arjun Mehta ka commission'), { kind: 'line', intent: 'SHOW_PAYOUT_LINE', name: 'arjun mehta' });
  assert.deepEqual(parsePayoutQuery("show Kavya's payout"), { kind: 'line', intent: 'SHOW_PAYOUT_LINE', name: 'kavya' });
  assert.equal(parsePayoutQuery('is file ka payout kitna aaya')?.intent, 'SHOW_PAYOUT_LINE');
  assert.equal(parsePayoutQuery('short pay pe query')?.intent, 'RAISE_PAYOUT_QUERY');
  assert.equal(parsePayoutQuery('payout pe query daalo')?.intent, 'RAISE_PAYOUT_QUERY');
  // A bare "raise a query" is Money in flight's — except on the Payouts screen.
  assert.equal(parsePayoutQuery('raise a query'), null);
  assert.equal(parseMoneyQuery('raise a query')?.intent, 'RAISE_QUERY');
  assert.equal(parsePayoutQuery('raise a query', true)?.intent, 'RAISE_PAYOUT_QUERY');
  assert.equal(parsePayoutQuery('is pe query daalo', true)?.intent, 'RAISE_PAYOUT_QUERY');
  assert.equal(payoutQueryFor({ intent: 'RAISE_QUERY', transcript: 'query raise karo' }, true)?.intent, 'RAISE_PAYOUT_QUERY');
  assert.equal(payoutQueryFor({ intent: 'RAISE_QUERY', transcript: 'query raise karo' }, false), null);
  // A server intent keeps the transcript's details.
  assert.deepEqual(payoutQueryFor({ intent: 'SHOW_PAYOUT_STATEMENT', transcript: 'pichhle mahine ka payout' }), { kind: 'statement', intent: 'SHOW_PAYOUT_STATEMENT', period: 'lastMonth' });
});

test('existing phrases keep their readings (payouts, MIF, alerts, advance, proceed / aage chaliye)', () => {
  for (const t of ['open payouts', 'payouts kholo', 'show my commission', 'my payouts', 'payouts dikhao', 'unpaid payout dikhao', 'kitna claim karna hai', 'advance payout chahiye']) {
    assert.equal(parsePayoutQuery(t), null, t);
  }
  for (const t of ['mera paisa kahan hai', 'aaj kitna credit hua', 'kaunsi file atki hai', 'Ramesh ka paisa aaya', 'alerts dikhao', 'read my alerts', 'proceed', 'aage chaliye', 'go home']) {
    assert.equal(parsePayoutQuery(t), null, t);
    assert.equal(parsePayoutQuery(t, true), null, `${t} (on Payouts)`);
  }
  assert.equal(parseMoneyQuery('mera paisa kahan hai')?.intent, 'SHOW_MONEY_IN_FLIGHT');
  assert.equal(parseAlertsQuery('alerts dikhao')?.intent, 'SHOW_ALERTS');
  assert.equal(resolveAdvance('aage chaliye', { route: 'Payouts', sheet: 'payout-line', cta: { id: 'payout-raise-query', label: 'Raise a query', press: () => {} } })?.intent, 'ADVANCE');
});

test('answers: statement summary, short-pays (opens October on Short paid), line by name / LAN, query on the short line', () => {
  const invoices = inv(L1);
  const st = answerPayoutQuery(parsePayoutQuery('payout statement dikhao')!, { invoices });
  assert.deepEqual(st.params, { period: 'thisMonth', filter: 'all' }); // approved default period
  assert.match(st.say, /^November statement: expected 32 thousand 775 rupees, paid 11 thousand 25 rupees\. 21 thousand 750 rupees ready to claim\./);
  const last = answerPayoutQuery(parsePayoutQuery('pichhle mahine ka payout')!, { invoices });
  assert.deepEqual(last.params, { period: 'lastMonth', filter: 'all' });
  assert.match(last.say, /1 thousand 150 rupees difference found on 1 file, Arjun Mehta, CR-20320/);
  const oct = answerPayoutQuery(parsePayoutQuery('October ka statement')!, { invoices });
  assert.deepEqual(oct.params, { period: 'lastMonth', filter: 'all' });
  const sh = answerPayoutQuery(parsePayoutQuery('short payment kahan hai')!, { invoices });
  assert.deepEqual(sh.params, { period: 'lastMonth', filter: 'short' });
  assert.equal(sh.say, '1 short payment. Arjun Mehta, Maruti Swift, expected 5 thousand 100 rupees, paid 3 thousand 950 rupees, reason scheme cap.');
  const byName = answerPayoutQuery(parsePayoutQuery('Kavya Nair ka commission')!, { invoices });
  assert.deepEqual(byName.params, { invoice: 'INV/26-27/1188', lan: 'CR-20354' });
  assert.match(byName.say, /advance recovery, paid 4 thousand 200 rupees\. Matched\.$/);
  const byLan = answerPayoutQuery(parsePayoutQuery('CR-20320 ka payout')!, { invoices });
  assert.deepEqual(byLan.params, { invoice: 'INV/26-27/1176', lan: 'CR-20320' });
  const q = answerPayoutQuery(parsePayoutQuery('short pay pe query')!, { invoices });
  assert.deepEqual(q.params, { invoice: 'INV/26-27/1176', lan: 'CR-20320', query: true });
  // "is pe query daalo" on an open line queries THAT line.
  const onLine = answerPayoutQuery(parsePayoutQuery('is pe query daalo', true)!, { invoices, openLine: { invoice: 'INV/26-27/1188', lan: 'CR-20354' } });
  assert.deepEqual(onLine.params, { invoice: 'INV/26-27/1188', lan: 'CR-20354', query: true });
  assert.equal(answerPayoutQuery(parsePayoutQuery('Zubin ka payout')!, { invoices }).kind, 'absent');
});

test('new-TW-only Hero gets the statement by voice too (commission is for every dealer)', () => {
  const a = answerPayoutQuery(parsePayoutQuery('is mahine ka payout')!, { invoices: inv(HERO) });
  assert.equal(a.kind, 'open');
  assert.match(a.say, /4 thousand 410 rupees ready to claim\. 600 rupees difference found on 1 file, Nitin Sawant, TW-184133\./);
  const none = answerPayoutQuery(parsePayoutQuery('any short pay')!, { invoices: inv('9800002222') });
  assert.equal(none.say, 'No short payments in the last 3 months.');
});
