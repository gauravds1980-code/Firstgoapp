/**
 * v1.3.0 advance payout: limit = 3 × average of the last 3 months' payouts, available = limit − outstanding,
 * card enabled from ₹30,000, slider from ₹30,000 to available. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCE_MIN, advanceLimit, advancePosition, advanceRange, type Invoice, payoutMonths } from '../business';

// The in-app "today" is 24 Nov 2026, so the 3 chart months are Sep, Oct and Nov (to date).
const inv = (id: string, y: number, m: number, d: number, amount: number): Invoice => ({ id, date: new Date(y, m, d), status: 'Paid', lines: [], amount });
const INVOICES: Invoice[] = [
  inv('a', 2026, 8, 5, 60000), inv('b', 2026, 8, 20, 40000), // Sep 1,00,000
  inv('c', 2026, 9, 11, 50000), // Oct 50,000
  inv('d', 2026, 10, 2, 30000), inv('e', 2026, 10, 18, 20000), // Nov 50,000
  inv('old', 2026, 7, 30, 999999), // Aug: outside the 3-month window
  inv('next', 2026, 11, 1, 888888), // Dec: outside the window
];

test('payout months: the last three calendar months, oldest first', () => {
  assert.deepEqual(payoutMonths(INVOICES).map((m) => [m.label, m.amt]), [['Sep', 100000], ['Oct', 50000], ['Nov', 50000]]);
});

test('limit = 3 × average of the last 3 months', () => {
  const { avg, limit } = advanceLimit(INVOICES);
  assert.equal(avg, Math.floor(200000 / 3));
  assert.equal(limit, avg * 3);
  assert.equal(limit, 199998);
});

test('available = limit − outstanding, never below zero', () => {
  const none = advancePosition(INVOICES, []);
  assert.equal(none.outstanding, 0);
  assert.equal(none.available, none.limit);
  const some = advancePosition(INVOICES, [50000, 20000]);
  assert.equal(some.outstanding, 70000);
  assert.equal(some.available, some.limit - 70000);
  assert.equal(advancePosition(INVOICES, [500000]).available, 0);
});

test('range: disabled below ₹30,000; min ₹30,000, max = available; 50% chip only when ≥ min', () => {
  assert.equal(ADVANCE_MIN, 30000);
  assert.deepEqual(advanceRange(29999), { enabled: false, min: 30000, max: 29999, half: null });
  assert.equal(advanceRange(30000).enabled, true);
  assert.equal(advanceRange(30000).half, null);
  const r = advanceRange(267615);
  assert.equal(r.enabled, true);
  assert.equal(r.min, 30000);
  assert.equal(r.max, 267615);
  assert.equal(r.half, 133000, '50% snapped down to the ₹1,000 step');
  assert.equal(advanceRange(60000).half, 30000);
  assert.equal(advanceRange(59000).half, null);
});

test('no payouts → no advance', () => {
  const p = advancePosition([], []);
  assert.equal(p.limit, 0);
  assert.equal(advanceRange(p.available).enabled, false);
});
