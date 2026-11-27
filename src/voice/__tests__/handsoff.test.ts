/**
 * v1.4.5 S2.5–S2.7 hands-off screens: Asset "Confirm & start KYC" voice-confirm, TA drawdown amount + Continue +
 * voice-confirmed disburse (and TA repay Pay), SearchMobile / DealerLogin auto-send OTP, Cases / Portfolio rows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerOptions } from '../customerMatch';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import { AutoAdvancer, AUTO_ADVANCE_MS } from '../autoAdvance';
import { autoToastText, expectFor, planTarget, shouldAutoExecute, slotsForSelect, slotsFromFields, undoSlotsFor, validFields } from '../voiceLogic';
import { decideAdvance, resolveAdvance, type VoiceStepSpec } from '../voiceStep';

const asset = (blocked = false): VoiceStepSpec => ({ route: 'Asset', extra: { loanAmount: 100000 },
  cta: { id: 'confirm-kyc', label: 'Confirm & start KYC', destructive: true, enabled: !blocked, confirmPrompt: 'Confirm and start KYC?',
    hint: 'EMI ₹6,100 is above the ₹5,000 UPI AutoPay cap. Say 36 months, or lower the loan amount.', press: () => {} } });

test('Asset: proceed / confirm / start KYC / aage chaliye = spoken confirm "Confirm and start KYC?"; never automatic', () => {
  for (const t of ['proceed', 'confirm', 'start KYC', 'aage chaliye', 'go ahead', 'आगे चलिए']) {
    const c = resolveAdvance(t, asset())!;
    assert.equal(c.autoExecute, false, t);
    const d = decideAdvance(c, asset());
    assert.equal(d.kind, 'confirm', t);
    assert.equal(d.kind === 'confirm' && d.prompt, 'Confirm and start KYC?', t);
  }
  // A spoken yes after the server's question arrives as confirmed:true → press.
  const yes = parseResponse({ intent: 'ADVANCE', confidenceBand: 'auto', autoExecute: true, autoReason: 'advance_confirmed', method: 'advance', action: { type: 'advance', route: 'Asset', cta: 'confirm-kyc', destructive: true, confirmed: true } });
  assert.equal(decideAdvance(yes, asset()).kind, 'press');
});

test('Asset: blocked over the UPI cap → the reason, no press; a loan amount phrase is still SET_LOAN_AMOUNT', () => {
  const d = decideAdvance(resolveAdvance('proceed', asset(true))!, asset(true));
  assert.deepEqual(d, { kind: 'blocked', text: 'EMI ₹6,100 is above the ₹5,000 UPI AutoPay cap. Say 36 months, or lower the loan amount.' });
  assert.equal(resolveAdvance('loan amount 1 lakh', asset()), null);
  const c = resolveOnPhone('loan amount 1 lakh', { screen: 'Asset', fields: [{ id: 'loan-amount', kind: 'amount', min: 30000, max: 150000, step: 5000, value: 135000 }] })!;
  assert.equal(c.intent, 'SET_LOAN_AMOUNT');
});

const DD = { screen: 'TaInf', fields: [{ id: 'ta-repay', kind: 'amount' as const, utilised: 450000 },
  { id: 'drawdown-amount', kind: 'amount' as const, label: 'Drawdown amount', min: 50000, max: 450000, step: 10000, value: 100000 }],
  context: { route: 'TaInf', sheet: 'disburse', step: 'amount' } };

test('TA drawdown amount: "2 lakh" / "disburse 2 lakh" fill at once with Undo and move on; over available → Set ₹4,50,000?', () => {
  for (const t of ['2 lakh', 'disburse 2 lakh', 'draw 200000', 'do lakh']) {
    const c = resolveOnPhone(t, DD)!;
    assert.equal(c.intent, 'SET_DRAWDOWN_AMOUNT', t);
    assert.equal(c.responseText, 'Drawdown amount set to ₹2,00,000.', t);
    assert.ok(shouldAutoExecute(c, false), t);
    const st = planTarget(c);
    assert.ok(st.kind === 'select');
    if (st.kind !== 'select') continue;
    assert.deepEqual(slotsForSelect(st), { drawdownAmount: 200000, drawdownAdvance: true });
    assert.deepEqual(undoSlotsFor(st), ['drawdown']);
    assert.equal(autoToastText(c, st), 'Drawdown ₹2,00,000');
  }
  const over = resolveOnPhone('5 lakh', DD)!;
  assert.equal(over.status, 'clarify');
  assert.equal(over.responseText, '₹5,00,000 is above your available ₹4,50,000. Set ₹4,50,000?');
  const under = resolveOnPhone('20000', DD)!;
  assert.equal(under.responseText, '₹20,000 is below the minimum of ₹50,000. Set ₹50,000?');
  assert.equal(resolveOnPhone('pay 80000', DD)?.intent, 'TA_REPAY', 'a repay is never a drawdown');
  assert.equal(resolveOnPhone('2 lakh', { ...DD, fields: [DD.fields[0]] }), null, 'no drawdown field: not a drawdown');
  const srv = parseResponse({ intent: 'SET_DRAWDOWN_AMOUNT', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'drawdown_amount', method: 'drawdown',
    action: { type: 'select', id: 'drawdown-amount', kind: 'amount', label: '₹2,00,000', value: '200000', advance: true } });
  const t2 = planTarget(srv);
  assert.ok(t2.kind === 'select' && slotsForSelect(t2).drawdownAmount === 200000);
});

test('TA drawdown steps: Continue by voice (plain, guarded), final disburse and repay Pay are spoken confirms', () => {
  let cont = 0; let paid = 0;
  const amountStep = (err?: string): VoiceStepSpec => ({ route: 'TaInf', sheet: 'disburse', step: 'amount',
    cta: { id: 'disburse-continue', label: 'Continue', destructive: false, enabled: !err, hint: err, press: () => { cont++; } } });
  const d = decideAdvance(resolveAdvance('continue', amountStep())!, amountStep());
  assert.equal(d.kind, 'press');
  if (d.kind === 'press') d.control.press();
  assert.equal(cont, 1);
  assert.deepEqual(decideAdvance(resolveAdvance('next', amountStep('Only ₹4,50,000 is available.'))!, amountStep('Only ₹4,50,000 is available.')),
    { kind: 'blocked', text: 'Only ₹4,50,000 is available.' });
  const confirmStep: VoiceStepSpec = { route: 'TaInf', sheet: 'disburse', step: 'confirm',
    cta: { id: 'disburse-confirm', label: 'Confirm · disburse ₹2,00,000', destructive: true, enabled: true, confirmPrompt: 'Disburse ₹2,00,000?', press: () => { paid++; } } };
  for (const t of ['disburse', 'proceed', 'confirm', 'aage badho']) {
    const x = decideAdvance(resolveAdvance(t, confirmStep)!, confirmStep);
    assert.equal(x.kind === 'confirm' && x.prompt, 'Disburse ₹2,00,000?', t);
  }
  const srv = parseResponse({ intent: 'ADVANCE', confidenceBand: 'confirm', autoExecute: false, autoReason: 'advance_destructive', method: 'advance',
    action: { type: 'advance', route: 'TaInf', sheet: 'disburse', step: 'confirm', cta: 'disburse-confirm', destructive: true }, responseText: 'Disburse ₹2,00,000?', voiceConfirm: true });
  assert.equal(decideAdvance(srv, confirmStep).kind, 'confirm');
  assert.equal(paid, 0, 'never disbursed without the spoken yes');
  const repay: VoiceStepSpec = { route: 'TaInf', sheet: 'repay',
    cta: { id: 'repay-pay', label: 'Pay ₹80,000', destructive: true, enabled: true, confirmPrompt: 'Pay ₹80,000 now?', press: () => { paid++; } } };
  for (const t of ['pay', 'haan', 'proceed']) assert.equal(decideAdvance(resolveAdvance(t, repay)!, repay).kind, 'confirm', t);
});

function clock() {
  let now = 0; let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    api: { set: (fn: () => void, ms: number) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; }, clear: (h: unknown) => { q.delete(h as number); } },
    tick(ms: number) { now += ms; for (const [id, t] of [...q]) if (t.at <= now) { q.delete(id); t.fn(); } },
  };
}

test('SearchMobile / DealerLogin: a valid 10-digit number sends the OTP once, 900 ms after the last edit', () => {
  const c = clock();
  let sent = 0;
  const own = '9812345678';
  const validMobile = (m: string) => /^[6-9]\d{9}$/.test(m) && m !== own;
  const a = new AutoAdvancer(() => { sent++; }, AUTO_ADVANCE_MS, c.api);
  for (const d of ['9', '98', '987', '9876', '98765', '987654', '9876543', '98765432', '987654321']) { a.typed(validMobile(d)); c.tick(150); }
  c.tick(3000);
  assert.equal(sent, 0, 'a partial number never sends');
  a.typed(validMobile('9876543210')); c.tick(500);
  a.typed(validMobile('987654321')); c.tick(3000); // backspace during the countdown cancels it
  assert.equal(sent, 0);
  a.typed(validMobile('9876543210')); c.tick(899);
  assert.equal(sent, 0);
  c.tick(1);
  assert.equal(sent, 1);
  a.typed(true); c.tick(3000);
  assert.ok(!a.press(), 'a tap after the auto-send does not send twice');
  assert.equal(sent, 1);
  a.reset(); a.typed(validMobile(own)); c.tick(3000);
  assert.equal(sent, 1, "the dealer's own number is never sent");
  assert.ok(AUTO_ADVANCE_MS >= 800 && AUTO_ADVANCE_MS <= 1000);
});

test('S2.6 mobile fill (server) parses; DealerLogin expects a phone number', () => {
  const srv = parseResponse({ intent: 'UNKNOWN', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'field:PHONE',
    action: { type: 'fill', field: 'mobile', value: '9876543210', sendOtp: true }, sendOtp: true,
    normalizedFields: [{ type: 'PHONE', value: '9876543210', valid: true, readBack: 'nine eight seven six five, four three two one zero', display: '98765 43210' }] });
  assert.equal(srv.sendOtp, true);
  assert.deepEqual(srv.action, { type: 'fill', field: 'mobile', value: '9876543210', sendOtp: true });
  assert.ok(shouldAutoExecute(srv, false));
  assert.deepEqual(slotsFromFields(validFields(srv)), { mobileNumber: '9876543210' });
  assert.equal(expectFor('DealerLogin'), 'phone');
  assert.equal(expectFor('SearchMobile', { stage: 'enter' }), 'phone');
  assert.equal(expectFor('SearchMobile', { stage: 'otp' }), 'otp');
  // Voice "send OTP" / "proceed" on the mobile step = the plain Get OTP / Send consent OTP press (not destructive).
  let n = 0;
  const step: VoiceStepSpec = { route: 'SearchMobile', cta: { id: 'send-otp', label: 'Send consent OTP', destructive: false, enabled: true, press: () => { n++; } } };
  const d = decideAdvance(resolveAdvance('proceed', step)!, step);
  if (d.kind === 'press') d.control.press();
  assert.equal(n, 1);
});

test('Cases / Portfolio rows by name: "open Rahul Sharma" opens the row (auto + Undo), duplicates clarify, unknown says so', () => {
  const rows = customerOptions([
    { lan: 'TW-1', name: 'Rahul Sharma', vehicle: 'Honda Activa 6G' },
    { lan: 'TW-2', name: 'Priya Kulkarni', vehicle: 'Hero Splendor+' },
    { lan: 'TW-3', name: 'Priya Kulkarni', vehicle: 'TVS Jupiter' },
  ], (r) => r);
  const ctx = { screen: 'Cases', options: rows };
  const c = resolveOnPhone('open Rahul Sharma', ctx)!;
  assert.equal(c.intent, 'SELECT_OPTION');
  assert.equal(c.responseText, 'Open Rahul Sharma?');
  assert.ok(shouldAutoExecute(c, false));
  const t = planTarget(c);
  assert.ok(t.kind === 'select' && slotsForSelect(t).customerLan === 'TW-1');
  assert.deepEqual(t.kind === 'select' && undoSlotsFor(t), ['customer']);
  const dup = resolveOnPhone('open Priya Kulkarni', { screen: 'Portfolio', options: rows })!;
  assert.equal(dup.status, 'clarify');
  assert.equal(dup.responseText, 'Priya Kulkarni, Hero Splendor+ or Priya Kulkarni, TVS Jupiter?');
  const none = resolveOnPhone('open Sanjay Pawar', ctx)!;
  assert.equal(none.responseText, 'Sanjay Pawar is not on this list.');
  // Server answer (CONTRACT S2.7) is the same select.
  const srv = parseResponse({ intent: 'SELECT_OPTION', method: 'token:customer', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'option',
    action: { type: 'select', kind: 'customer', id: 'TW-1', label: 'Rahul Sharma', value: 'TW-1' }, responseText: 'Open Rahul Sharma?' });
  const st = planTarget(srv);
  assert.ok(st.kind === 'select' && slotsForSelect(st).customerLan === 'TW-1');
  // Plain commands on these screens are not stolen by the rows.
  const nav = parseResponse({ transcript: 'open payouts', intent: 'OPEN_PAYOUTS', score: 1, action: { type: 'navigate', route: 'Payouts' }, status: 'ok' });
  assert.equal(guardAnswer(nav, 'open payouts', ctx).intent, 'OPEN_PAYOUTS');
});

test('offline on a list screen: a sure command ("open TA") beats an absent-name reading', () => {
  const rows = customerOptions([{ lan: 'TW-1', name: 'Rahul Sharma', vehicle: 'Activa' }], (r) => r);
  for (const t of ['open TA', 'open payouts', 'go home']) {
    const off = offlineReading(localCommand(t, matchCommand(t)), resolveOnPhone(t, { screen: 'Cases', options: rows }));
    assert.notEqual(off.intent, 'UNKNOWN', t);
  }
  const absent = offlineReading(localCommand('open Sanjay Pawar', matchCommand('open Sanjay Pawar')), resolveOnPhone('open Sanjay Pawar', { screen: 'Cases', options: rows }));
  assert.equal(absent.responseText, 'Sanjay Pawar is not on this list.');
});
