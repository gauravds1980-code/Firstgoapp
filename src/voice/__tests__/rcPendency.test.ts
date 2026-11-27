/**
 * v1.4.5 RC pendency rows by name: server answers (CONTRACT.md 3.5) and the offline phone matcher (customerMatch)
 * open the row like a tap, clarify duplicates, say when a name is absent; upload stays a manual tap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerOptions } from '../customerMatch';
import { localCommand, matchCommand } from '../intentMatcher';
import { guardAnswer, offlineReading, offlineVerdict, resolveOnPhone } from '../optionResolver';
import { parseResponse } from '../sttClient';
import { autoToastText, planTarget, shouldAutoExecute, slotsForSelect, undoSlotsFor, withCandidate } from '../voiceLogic';
import { oneTapActs } from '../voiceMode';

const ROWS = customerOptions([
  { lan: 'L1', name: 'Vikram Rao', vehicle: 'Hero Splendor+', status: 'Pending' },
  { lan: 'L2', name: 'Rahul Sharma', vehicle: 'Honda Activa 6G', status: 'Pending' },
  { lan: 'L3', name: 'Vikram Singh', vehicle: 'TVS Apache', status: 'Pending' },
  { lan: 'L4', name: 'Sneha Joshi', vehicle: 'Bajaj Pulsar', status: 'Submitted', regNo: 'MH 12 AB 1234' },
], (r) => r);
const ctx = { screen: 'RcPendency', options: ROWS };
const phone = (t: string) => resolveOnPhone(t, ctx);
const opened = (c: ReturnType<typeof phone>) => { const t = c ? planTarget(c) : null; return t?.kind === 'select' ? slotsForSelect(t).customerLan : undefined; };

test('rows are sent per contract (name, loanNo, vehicle, status)', () => {
  assert.deepEqual(ROWS[0], { id: 'L1', kind: 'customer', label: 'Vikram Rao', name: 'Vikram Rao', loanNo: 'L1', value: 'L1', lan: 'L1', vehicle: 'Hero Splendor+', status: 'Pending' });
});

test('offline: "update Vikram Rao" / "Vikram Rao RC" / "update Vikram Rau" / "upload RC for Vikram Rao" open that row', () => {
  for (const t of ['update Vikram Rao', 'Vikram Rao RC', 'update Vikram Rau', 'upload RC for Vikram Rao', 'registration number for Vikram Rao']) {
    const c = phone(t)!;
    assert.equal(opened(c), 'L1', t);
    assert.equal(c.responseText, "Open Vikram Rao's RC?", t);
    assert.equal(shouldAutoExecute(c, false), true, `${t}: opens like a tap (Undo closes it)`);
    assert.deepEqual(undoSlotsFor(planTarget(c)), ['customer']);
    assert.equal(autoToastText(c, planTarget(c)), 'Opened Vikram Rao');
    const off = offlineReading(localCommand(t, matchCommand(t)), c);
    assert.equal(off, c, `${t}: beats UPLOAD_RC / down payment offline`);
    assert.equal(offlineVerdict(off, true), 'deliver');
  }
  assert.equal(opened(phone('update Rahul')), 'L2');
});

test('offline: "open Vikram" with two Vikrams → "Vikram Rao or Vikram Singh?"; a pick opens that row', () => {
  const c = phone('open Vikram')!;
  assert.equal(c.status, 'clarify');
  assert.equal(c.responseText, 'Vikram Rao or Vikram Singh?');
  const pick = withCandidate(c, c.candidates![1]);
  assert.equal(oneTapActs(pick), true);
  assert.equal(opened(pick), 'L3');
});

test('offline: absent / submitted names never open anything', () => {
  const a = phone('update Sanjay Pawar')!;
  assert.equal(a.responseText, 'Sanjay Pawar is not in pending RCs.');
  assert.equal(planTarget(a).kind, 'none');
  const s = phone('update Sneha Joshi')!;
  assert.equal(s.responseText, "Sneha Joshi's RC is already submitted (MH 12 AB 1234).");
  assert.equal(phone('open portfolio'), null, 'a command is not a name');
});

const server = (b: Record<string, unknown>) => parseResponse({ confidence: 0.9, ...b });

test('server: SELECT_OPTION customer opens the row; clarify / retry consumed as sent', () => {
  const c = server({ transcript: 'update Vikram Rao', intent: 'SELECT_OPTION', method: 'token:customer', status: 'ok', confidenceBand: 'auto', autoExecute: true, autoReason: 'option', score: 0.95,
    action: { type: 'select', kind: 'customer', id: 'L1', label: 'Vikram Rao', value: 'L1' }, slots: { label: 'Vikram Rao', customerLan: 'L1' }, responseText: "Open Vikram Rao's RC?" });
  assert.equal(opened(c), 'L1');
  assert.equal(shouldAutoExecute(c, false), true);
  const dup = server({ transcript: 'open Vikram', intent: 'UNKNOWN', status: 'clarify', action: { type: 'none' }, responseText: 'Vikram Rao or Vikram Singh?',
    candidates: [{ intent: 'SELECT_OPTION', phrase: 'Vikram Rao', score: 0.6, option: { id: 'L1', kind: 'customer', label: 'Vikram Rao', value: 'L1' } },
      { intent: 'SELECT_OPTION', phrase: 'Vikram Singh', score: 0.6, option: { id: 'L3', kind: 'customer', label: 'Vikram Singh', value: 'L3' } }] });
  assert.equal(opened(withCandidate(dup, dup.candidates![0])), 'L1');
});

test('server: an older server sending "upload RC for Vikram Rao" to Docs opens the row instead', () => {
  const old = server({ transcript: 'upload RC for Vikram Rao', intent: 'UPLOAD_RC', status: 'ok', action: { type: 'navigate', route: 'Docs', filter: 'rc' } });
  const g = guardAnswer(old, old.transcript, ctx);
  assert.equal(opened(g), 'L1');
  assert.notEqual(planTarget(g).kind, 'navigate');
});
