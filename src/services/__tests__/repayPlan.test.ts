/** v1.4.5 voice repay: planRepay / applyRepayAmount (oldest / overdue first, part-pay the last). Pure Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRepayAmount, planRepay, sumOf, taInfFor } from '../business';
import { mockDealerProfile } from '../dealer';

// TA example: utilised 4,50,000 = unpaid 80,000 (overdue) + 1,80,000 + 1,20,000 + 70,000; one 60,000 tranche paid.
const ta = () => taInfFor(mockDealerProfile('9820012345').profile)!;

test('example TA: utilised equals the unpaid tranches', () => {
  const l = ta();
  assert.equal(l.utilised, 450000);
  assert.equal(sumOf(l.tranches.filter((t) => t.status !== 'paid')), 450000);
});

test('exact: 80,000 pays the overdue tranche in full, nothing else', () => {
  const p = planRepay(ta().tranches, 80000);
  assert.equal(p.amount, 80000);
  assert.equal(p.full, false);
  assert.deepEqual(p.lines.map((x) => [x.id, x.pay, x.part]), [['TA-2610-28', 80000, false]]);
  assert.equal(p.lines[0].status, 'overdue');
  const r = applyRepayAmount(ta(), p);
  assert.equal(r.total, 80000);
  assert.equal(r.limit.utilised, 370000);
  assert.equal(r.limit.tranches.find((t) => t.id === 'TA-2610-28')!.status, 'paid');
});

test('partial: 1,00,000 pays the overdue tranche and part of the next (oldest first)', () => {
  const p = planRepay(ta().tranches, 100000);
  assert.deepEqual(p.lines.map((x) => [x.id, x.pay, x.part]), [['TA-2610-28', 80000, false], ['TA-2611-07', 20000, true]]);
  const r = applyRepayAmount(ta(), p);
  assert.equal(r.limit.utilised, 350000);
  const next = r.limit.tranches.find((t) => t.id === 'TA-2611-07')!;
  assert.equal(next.status, 'dueSoon', 'a part-paid tranche stays unpaid');
  assert.equal(next.amount, 160000, 'with its remainder');
  assert.equal(sumOf(r.limit.tranches.filter((t) => t.status !== 'paid')), r.limit.utilised);
});

test('full: every unpaid tranche', () => {
  const p = planRepay(ta().tranches, 'full');
  assert.equal(p.amount, 450000);
  assert.equal(p.full, true);
  assert.equal(p.lines.length, 4);
  assert.ok(p.lines.every((x) => !x.part));
  const r = applyRepayAmount(ta(), p);
  assert.equal(r.limit.utilised, 0);
  assert.ok(r.limit.tranches.every((t) => t.status === 'paid'));
});

test('over: more than utilised is capped to the full outstanding and flagged', () => {
  const p = planRepay(ta().tranches, 500000);
  assert.equal(p.over, true);
  assert.equal(p.amount, 450000);
  assert.equal(p.full, true);
});

test('zero: nothing to pay (zero amount, or nothing utilised)', () => {
  const z = planRepay(ta().tranches, 0);
  assert.equal(z.amount, 0);
  assert.equal(z.lines.length, 0);
  assert.equal(z.full, false);
  const paid = ta().tranches.map((t) => ({ ...t, status: 'paid' as const }));
  const none = planRepay(paid, 'full');
  assert.equal(none.amount, 0);
  assert.equal(none.full, false);
  assert.equal(applyRepayAmount(ta(), z).total, 0);
});
