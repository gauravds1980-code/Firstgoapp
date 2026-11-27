/**
 * v1.4.5 regression: EVERY phrase from the four RCAs (loan amount, TA pay, e-sign OTP, RC pendency), on the phone,
 * through both paths the hook takes:
 *   server answer → guardAnswer (deliver)                              — the server's CONTRACT.md reply
 *   server unreachable → offlineReading(local, resolveOnPhone) → guard — the phone alone (tunnel flap)
 * Fake OTPs only (123456 / 482913). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerOptions } from '../customerMatch';
import { localCommand, matchCommand } from '../intentMatcher';
import { decideOtpTurn, planOtpTurn } from '../otpParse';
import { guardAnswer, offlineReading, offlineVerdict, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import type { CommandContext, CommandResponse, VoiceOption } from '../types';
import { planTarget, shouldAutoExecute, slotsForSelect } from '../voiceLogic';

type Ctx = Pick<CommandContext, 'screen' | 'options' | 'fields' | 'expect'>;
const ASSET_CHIPS: VoiceOption[] = [
  { id: 'hero-vida', kind: 'vehicle_model', label: 'Hero Vida V2', brand: 'Hero MotoCorp', model: 'Vida V2', value: 'hero-vida' },
  { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', brand: 'Hero MotoCorp', model: 'Xtreme 125R', value: 'hero-xtreme' },
  { id: 'tenure-12', kind: 'tenure', label: '12 months', value: '12' },
  { id: 'tenure-24', kind: 'tenure', label: '24 months', value: '24' },
];
const ASSET: Ctx = { screen: 'Asset', options: ASSET_CHIPS, fields: [{ id: 'loan-amount', kind: 'amount', label: 'Loan amount', min: 30000, max: 150000, step: 5000, value: 135000 }] };
const TA: Ctx = { screen: 'TaInf', fields: [{ id: 'ta-repay', kind: 'amount', label: 'Repay amount', utilised: 450000 }] };
const RC: Ctx = { screen: 'RcPendency', options: customerOptions([
  { lan: 'L1', name: 'Vikram Rao', vehicle: 'Hero Splendor+', status: 'Pending' },
  { lan: 'L2', name: 'Rahul Sharma', status: 'Pending' },
  { lan: 'L3', name: 'Vikram Singh', vehicle: 'TVS Apache', status: 'Pending' },
], (r) => r) };

const offline = (text: string, ctx: Ctx): CommandResponse => guardAnswer(offlineReading(localCommand(text, matchCommand(text)), resolveOnPhone(text, ctx)), text, ctx);
const viaServer = (body: Record<string, unknown>, ctx: Ctx): CommandResponse => {
  const c = parseResponse({ confidence: 0.9, ...body });
  return guardAnswer(c, c.transcript, ctx);
};

type Want = { intent: string; set?: Record<string, unknown>; nav?: { route: string; filter?: string }; auto: boolean; line?: string | RegExp; status?: string };
function check(label: string, c: CommandResponse, w: Want) {
  assert.equal(c.intent, w.intent, `${label}: intent`);
  const t = planTarget(c);
  if (w.set) { assert.equal(t.kind, 'select', `${label}: select`); if (t.kind === 'select') assert.deepEqual(slotsForSelect(t), w.set, label); }
  if (w.nav) { assert.equal(t.kind, 'navigate', `${label}: navigate`); if (t.kind === 'navigate') assert.deepEqual({ route: t.route, ...(t.filter ? { filter: t.filter } : {}) }, w.nav, label); }
  if (!w.nav) assert.notEqual(t.kind, 'navigate', `${label}: never navigates`);
  assert.equal(shouldAutoExecute(c, false), w.auto, `${label}: auto`);
  if (w.status) assert.equal(c.status ?? 'ok', w.status, `${label}: status`);
  if (w.line) typeof w.line === 'string' ? assert.equal(c.responseText, w.line, label) : assert.match(c.responseText ?? '', w.line, label);
  assert.ok(!['START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'SETUP_UPI_MANDATE'].includes(c.intent) || w.intent === c.intent, label);
  assert.ok(!(c.candidates ?? []).some((x) => x.intent === 'START_NEW_LOAN' || x.intent === 'SETUP_UPI_MANDATE') || w.intent === 'SETUP_UPI_MANDATE', `${label}: no "Want a loan" / "Auto pay" suggestion`);
}

// ---- loan amount (Asset) ---------------------------------------------------------------------------------------
const loanSel = (n: number) => ({ type: 'select', id: 'loan-amount', kind: 'amount', label: `₹${n.toLocaleString('en-IN')}`, value: String(n) });
const LOAN: [string, number, boolean][] = [
  ['loan amount 1 lakh', 100000, true], ['loan 1 lakh', 100000, true], ['set loan amount to 80000', 80000, true],
  ['one lakh', 100000, false], ['ek lakh', 100000, false], ['95 thousand', 95000, false], ['1.2 lakh', 120000, false], ['1,10,000', 110000, false],
];
test('RCA loan amount: every phrase sets the slider (explicit = auto + Undo, bare = Confirm), never navigates — both paths', () => {
  for (const [text, n, auto] of LOAN) {
    const want: Want = { intent: 'SET_LOAN_AMOUNT', set: { loanAmount: n }, auto, line: auto ? `Loan amount set to ₹${n.toLocaleString('en-IN')}.` : `Set loan amount to ₹${n.toLocaleString('en-IN')}?` };
    check(`offline "${text}"`, offline(text, ASSET), want);
    check(`server "${text}"`, viaServer({ transcript: text, intent: 'SET_LOAN_AMOUNT', method: 'amount', status: 'ok', score: auto ? 0.95 : 0.8, action: loanSel(n),
      slots: { loanAmount: n }, confidenceBand: auto ? 'auto' : 'confirm', autoExecute: auto, responseText: want.line }, ASSET), want);
  }
});
test('RCA loan amount: the v1.4.4 server answers (START_MOBILE_JOURNEY auto / PINCODE 110000 / AMOUNT 300000) no longer act', () => {
  for (const text of ['loan 1 lakh', 'set loan amount to 80000', 'loan amount 2 lakh']) {
    const c = viaServer({ transcript: text, intent: 'START_MOBILE_JOURNEY', score: 0.9, status: 'ok', autoExecute: true, confidenceBand: 'auto', action: { type: 'navigate', route: 'SearchMobile' } }, ASSET);
    assert.equal(c.intent, 'SET_LOAN_AMOUNT', text);
    assert.notEqual(planTarget(c).kind, 'navigate', text);
  }
  assert.equal(offline('1.2 lakh', ASSET).slots?.loanAmount, 120000, 'never 3 lakh');
  assert.equal(offline('1,10,000', ASSET).intent, 'SET_LOAN_AMOUNT', 'never a PIN code');
});
test('RCA loan amount: "24 months", "select Vida", "extreme 125 r" on Asset still work — both paths', () => {
  check('offline "24 months"', offline('24 months', ASSET), { intent: 'SELECT_OPTION', set: { tenureMonths: 24 }, auto: true });
  check('server "24 months"', viaServer({ transcript: '24 months', intent: 'SELECT_OPTION', status: 'ok', score: 1, autoExecute: true, confidenceBand: 'auto',
    action: { type: 'select', kind: 'tenure', id: 'tenure-24', label: '24 months', value: '24' } }, ASSET), { intent: 'SELECT_OPTION', set: { tenureMonths: 24 }, auto: true });
  check('offline "select Vida"', offline('select Vida', ASSET), { intent: 'SELECT_VEHICLE_MODEL', set: { assetId: 'hero-vida', vehicle: 'Hero Vida V2' }, auto: false });
  check('offline "extreme 125 r"', offline('extreme 125 r', ASSET), { intent: 'SELECT_VEHICLE_MODEL', set: { assetId: 'hero-xtreme', vehicle: 'Hero Xtreme 125R' }, auto: true });
  check('server "extreme 125 r"', viaServer({ transcript: 'extreme 125 r', intent: 'SELECT_VEHICLE_MODEL', status: 'ok', score: 1, autoExecute: true, confidenceBand: 'auto',
    action: { type: 'select', kind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } }, ASSET),
  { intent: 'SELECT_VEHICLE_MODEL', set: { assetId: 'hero-xtreme', vehicle: 'Hero Xtreme 125R' }, auto: true });
});

// ---- TA pay (TaInf) ---------------------------------------------------------------------------------------------
const repay = (n: number) => ({ type: 'navigate', route: 'TaInf', filter: 'repay', sheet: 'repay', amount: n });
test('RCA TA pay: "pay 80000" / "pay 80k" / "repay 80000" → Confirm card that opens the repay sheet — both paths', () => {
  for (const text of ['pay 80000', 'pay 80k', 'repay 80000']) {
    const want: Want = { intent: 'TA_REPAY', nav: { route: 'TaInf', filter: 'repay' }, auto: false, line: 'Repay ₹80,000 on Trade Advance?', status: 'ok' };
    const off = offline(text, TA);
    check(`offline "${text}"`, off, want);
    assert.deepEqual(off.action, repay(80000));
    const srv = viaServer({ transcript: text, intent: 'TA_REPAY', method: 'ta_repay', status: 'ok', confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive',
      score: 0.9, action: repay(80000), slots: { repayAmount: 80000 }, responseText: want.line }, TA);
    check(`server "${text}"`, srv, want);
    // the v1.4.4 server: SETUP_UPI_MANDATE navigate Mandate → replaced by the repay reading
    check(`old server "${text}"`, viaServer({ transcript: text, intent: 'SETUP_UPI_MANDATE', score: 0.5, status: 'ok', action: { type: 'navigate', route: 'Mandate' } }, TA), want);
  }
});
test('RCA TA pay: "pay full" → full sheet; "pay 5 lakh" → "Repay the full ₹4,50,000?" — both paths', () => {
  const full: Want = { intent: 'TA_REPAY', nav: { route: 'TaInf', filter: 'repay' }, auto: false, line: 'Repay the full ₹4,50,000 on Trade Advance?' };
  check('offline "pay full"', offline('pay full', TA), full);
  check('server "pay full"', viaServer({ transcript: 'pay full', intent: 'TA_REPAY', method: 'ta_repay', status: 'ok', confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive',
    action: { ...repay(450000), full: true }, slots: { repayAll: true, repayAmount: 450000 }, responseText: full.line }, TA), full);
  const over: Want = { intent: 'TA_REPAY', auto: false, status: 'clarify', line: 'Repay the full ₹4,50,000?' };
  check('offline "pay 5 lakh"', offline('pay 5 lakh', TA), over);
  check('server "pay 5 lakh"', viaServer({ transcript: 'pay 5 lakh', intent: 'TA_REPAY', method: 'ta_repay', status: 'clarify', action: { type: 'none' }, responseText: over.line,
    candidates: [{ intent: 'TA_REPAY', phrase: 'Repay the full ₹4,50,000', score: 0.6, action: { ...repay(450000), full: true } }] }, TA), over);
});
test('RCA TA pay: "enhance my limit" opens the Enhance sheet; "auto pay" is still the mandate — both paths', () => {
  const enh: Want = { intent: 'ENHANCE_TA_LIMIT', nav: { route: 'TaInf', filter: 'enhance' }, auto: true };
  check('offline "enhance my limit"', offline('enhance my limit', TA), enh);
  check('server "enhance my limit"', viaServer({ transcript: 'enhance my limit', intent: 'ENHANCE_TA_LIMIT', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'enhance_sheet',
    action: { type: 'navigate', route: 'TaInf', filter: 'enhance', sheet: 'enhance' } }, TA), enh);
  const mandate: Want = { intent: 'SETUP_UPI_MANDATE', nav: { route: 'Mandate' }, auto: false };
  check('offline "auto pay"', offline('auto pay', TA), mandate);
  check('server "auto pay"', viaServer({ transcript: 'auto pay', intent: 'SETUP_UPI_MANDATE', score: 1, status: 'ok', autoReason: 'destructive', confidenceBand: 'confirm', autoExecute: false,
    action: { type: 'navigate', route: 'Mandate' } }, TA), mandate);
});

// ---- e-sign OTP --------------------------------------------------------------------------------------------------
test('RCA e-sign OTP: the dealer reading the 6 digits on Esign proceeds hands-off — server and offline', () => {
  for (const text of ['1 2 3 4 5 6', 'one two three four five six', 'ek do teen char paanch chhe', '12 34 56', 'एक दो तीन चार पांच छह']) {
    const p = planOtpTurn(text);
    assert.equal(p.kind, 'local', text);
    if (p.kind === 'local') assert.equal(decideOtpTurn(p.command, 'Esign').kind, 'esign_auto', `offline "${text}"`);
  }
  const srv = parseResponse({ transcript: '[otp utterance]', method: 'otp', status: 'ok', otp: true, hasOtpField: true, confidenceBand: 'confirm', autoExecute: false,
    normalizedFields: [{ type: 'OTP', value: '123456', valid: true, display: '••••••' }] });
  const d = decideOtpTurn(srv, 'Esign');
  assert.equal(d.kind, 'esign_auto', 'server answer: no Confirm card');
  assert.ok(!JSON.stringify(d.command).includes('123456'), 'masked');
});

// ---- RC pendency ------------------------------------------------------------------------------------------------
test('RCA RC pendency: every phrase — both paths', () => {
  const open: Want = { intent: 'SELECT_OPTION', set: { customerLan: 'L1' }, auto: true, line: "Open Vikram Rao's RC?" };
  const sel = { type: 'select', kind: 'customer', id: 'L1', label: 'Vikram Rao', value: 'L1' };
  for (const text of ['update Vikram Rao', 'Vikram Rao RC', 'update Vikram Rau', 'upload RC for Vikram Rao']) {
    check(`offline "${text}"`, offline(text, RC), open);
    check(`server "${text}"`, viaServer({ transcript: text, intent: 'SELECT_OPTION', method: 'token:customer', status: 'ok', confidenceBand: 'auto', autoExecute: true, score: 0.95,
      action: sel, slots: { customerLan: 'L1' }, responseText: open.line }, RC), open);
  }
  check('old server "upload RC for Vikram Rao" (UPLOAD_RC → Docs) opens the row', viaServer({ transcript: 'upload RC for Vikram Rao', intent: 'UPLOAD_RC', status: 'ok',
    action: { type: 'navigate', route: 'Docs', filter: 'rc' } }, RC), open);
  const two: Want = { intent: 'UNKNOWN', auto: false, status: 'clarify', line: 'Vikram Rao or Vikram Singh?' };
  check('offline "open Vikram"', offline('open Vikram', RC), two);
  check('server "open Vikram"', viaServer({ transcript: 'open Vikram', intent: 'UNKNOWN', status: 'clarify', action: { type: 'none' }, responseText: two.line,
    candidates: [{ intent: 'SELECT_OPTION', phrase: 'Vikram Rao', score: 0.6, option: { id: 'L1', kind: 'customer', label: 'Vikram Rao', value: 'L1' } }] }, RC), two);
  const absent: Want = { intent: 'UNKNOWN', auto: false, status: 'retry', line: 'Sanjay Pawar is not in pending RCs.' };
  check('offline "update Sanjay Pawar"', offline('update Sanjay Pawar', RC), absent);
  check('server "update Sanjay Pawar"', viaServer({ transcript: 'update Sanjay Pawar', intent: 'UNKNOWN', status: 'retry', action: { type: 'none' }, responseText: absent.line }, RC), absent);
  assert.equal(offlineVerdict(offline('update Sanjay Pawar', RC), true), 'deliver', 'exact, delivered with every route down');
});
