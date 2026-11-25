/**
 * v1.3.0 TA / INF merge: a dealer has Trade Advance OR Inventory Funding OR neither, never both;
 * only TA is disbursed by the dealer (INF is drawn by the OEM, repay only). Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDisburse, applyRepay, availableOf, canDisburse, dueIn30, taInfFor } from '../business';
import { mockDealerProfile } from '../dealer';

const LOGINS: [string, 'TA' | 'INF' | null][] = [
  ['9820012345', 'TA'], ['9876541111', 'TA'], ['9820011111', 'TA'], ['9820013333', 'INF'], ['9820012222', null],
];

test('each demo dealer has exactly one facility type, or none', () => {
  for (const [mobile, want] of LOGINS) {
    const { profile } = mockDealerProfile(mobile);
    assert.equal(profile.facilityType, want, mobile);
    assert.equal(profile.hasTaInf, want !== null, `${mobile}: hasTaInf follows facilityType`);
    const l = taInfFor(profile);
    if (want === null) assert.equal(l, null, `${mobile}: no facility`);
    else {
      assert.ok(l && !Array.isArray(l), `${mobile}: one Limit, never a TA + INF pair`);
      assert.equal(l.key, want, mobile);
    }
  }
});

test('a profile cannot yield both: taInfFor follows facilityType only', () => {
  const { profile } = mockDealerProfile('9820012345');
  assert.equal(taInfFor({ ...profile, facilityType: 'INF' })?.key, 'INF');
  assert.equal(taInfFor({ ...profile, facilityType: 'TA' })?.key, 'TA');
  assert.equal(taInfFor({ ...profile, facilityType: null, hasTaInf: false }), null);
  assert.equal(taInfFor(null), null);
});

test('TA disburses; INF has no disburse (drawn by the OEM)', () => {
  const ta = taInfFor(mockDealerProfile('9820012345').profile)!;
  const inf = taInfFor(mockDealerProfile('9820013333').profile)!;
  assert.equal(canDisburse(ta), true);
  assert.equal(ta.drawnBy, 'dealer');
  assert.equal(canDisburse(inf), false);
  assert.equal(inf.drawnBy, 'oem');
});

test('ROI reads without "(example)"', () => {
  for (const m of ['9820012345', '9820013333']) assert.ok(!/\(example\)/i.test(taInfFor(mockDealerProfile(m).profile)!.roi), m);
});

test('disburse then repay several tranches: utilised and available move together', () => {
  const ta = taInfFor(mockDealerProfile('9820012345').profile)!;
  const unpaid = ta.tranches.filter((t) => t.status !== 'paid').reduce((a, t) => a + t.amount, 0);
  assert.equal(unpaid, ta.utilised, 'seeded unpaid tranches add up to utilised');
  const { limit: d } = applyDisburse(ta, 100000);
  assert.equal(d.utilised, ta.utilised + 100000);
  assert.equal(availableOf(d), availableOf(ta) - 100000);
  const due = dueIn30(d).map((t) => t.id);
  assert.ok(due.length >= 2, 'multi-tranche repay');
  const { limit: r, total } = applyRepay(d, due);
  assert.equal(r.utilised, d.utilised - total);
  assert.ok(r.tranches.filter((t) => due.includes(t.id)).every((t) => t.status === 'paid'));
  assert.equal(applyRepay(r, due).total, 0, 'already paid tranches are not repaid twice');
});
