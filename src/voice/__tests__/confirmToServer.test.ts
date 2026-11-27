/**
 * v1.4.2: the confirm → server patch (useVoiceCommand-confirm-to-server.patch, via serverOverConfirm) and the
 * "Did you mean" model pick that continues into the journey. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommandResponse } from '../types';
import { chooseCandidate, CONFIRM_SERVER_BUDGET_MS, type LocalMatch, serverOverConfirm } from '../intentMatcher';
import { planTarget } from '../voiceLogic';

const cmd = (over: Partial<CommandResponse> = {}): CommandResponse => ({
  transcript: 'show my payouts', confidence: 1, intent: 'OPEN_PAYOUTS', score: 0.8, matchedPhrase: 'open payouts', action: { type: 'navigate', route: 'Payouts' }, ...over,
});
const match = (over: Partial<LocalMatch> = {}): LocalMatch => ({
  intent: 'OPEN_PAYOUTS', phrase: 'open payouts', score: 0.8, method: 'fuzzy', band: 'confirm', candidates: [], margin: 0.1, normalized: 'show my payouts', ...over,
});
const localConfirm = cmd({ confidenceBand: 'confirm', autoExecute: false });
const serverAuto = cmd({ status: 'ok', confidenceBand: 'auto', autoExecute: true, score: 0.93, matcher: 'labse' } as Partial<CommandResponse>);
const delay = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

test('confirm→server: budget is 250 ms', () => assert.equal(CONFIRM_SERVER_BUDGET_MS, 250));

test('confirm→server: a sure server answer within the budget replaces a plain local "Did you mean"', async () => {
  let asked = 0;
  const out = await serverOverConfirm(localConfirm, match(), async () => { asked += 1; return serverAuto; });
  assert.equal(asked, 1);
  assert.equal(out, serverAuto);
});

test('confirm→server: never asked when a matcher guard set the confirm, or the gate already guarded the text', async () => {
  let asked = 0;
  const ask = async () => { asked += 1; return serverAuto; };
  assert.equal(await serverOverConfirm(localConfirm, match({ guard: 'negation' }), ask), null);
  assert.equal(await serverOverConfirm(localConfirm, match(), ask, { guard: true }), null);
  assert.equal(await serverOverConfirm(localConfirm, match({ band: 'auto' }), ask), null);
  assert.equal(await serverOverConfirm(localConfirm, match({ band: 'retry' }), ask), null);
  assert.equal(asked, 0);
});

test('confirm→server: late, failing, unsure or destructive server answers keep the local "Did you mean"', async () => {
  assert.equal(await serverOverConfirm(localConfirm, match(), () => delay(80, serverAuto), { budgetMs: 20 }), null, 'late');
  assert.equal(await serverOverConfirm(localConfirm, match(), () => Promise.reject(new Error('offline'))), null, 'error');
  assert.equal(await serverOverConfirm(localConfirm, match(), async () => cmd({ confidenceBand: 'confirm', autoExecute: false })), null, 'not auto');
  assert.equal(await serverOverConfirm(localConfirm, match(), async () => cmd({ status: 'clarify', confidenceBand: 'auto', autoExecute: true })), null, 'clarify');
  const pay = cmd({ intent: 'START_ESIGN', action: { type: 'navigate', route: 'Esign' }, confidenceBand: 'auto', autoExecute: true });
  assert.equal(await serverOverConfirm(localConfirm, match(), async () => pay), null, 'destructive stays behind Confirm');
});

test('confirm→server: a local result that is not a confirm is never replaced', async () => {
  const sure = cmd({ confidenceBand: 'auto', autoExecute: true, status: 'ok' });
  assert.equal(await serverOverConfirm(sure, match(), async () => serverAuto), null);
});

test('chooseCandidate: picking a model from "Did you mean" continues into the QR journey with the model', () => {
  const cands = [
    { intent: 'START_QR_JOURNEY', phrase: 'Hero Xtreme 125R', score: 0.7, option: { id: 'hero-xtreme', kind: 'vehicle_model', label: 'Hero Xtreme 125R', value: 'hero-xtreme' } },
    { intent: 'START_QR_JOURNEY', phrase: 'start QR journey', score: 0.66 },
  ];
  const clar = cmd({ transcript: 'start QR journey for xtreme', intent: 'START_QR_JOURNEY', status: 'clarify', candidates: cands, action: { type: 'none' } });
  const picked = chooseCandidate(clar, cands[0]);
  assert.deepEqual(planTarget(picked), { kind: 'navigate', route: 'ScanQr' });
  assert.equal(picked.slots?.assetId, 'hero-xtreme');
  const plain = chooseCandidate(clar, cands[1]);
  assert.deepEqual(planTarget(plain), { kind: 'navigate', route: 'ScanQr' });
  assert.equal(plain.slots?.assetId, undefined);
});
