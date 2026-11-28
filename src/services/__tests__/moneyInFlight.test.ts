/**
 * v1.4.6 Money in flight — pure logic: ageing (0–1 / 2–3 / 4+), 3-day credited retention, totals per demo login,
 * dealer segment gating, search / filter, sheet CTAs. Demo "now" = 24 Nov 2026 11:26 (MIF_NOW). Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageingBand } from '../../theme/libraryTones';
import { mockDealerProfile } from '../dealer';
import {
  ageingOf, applyFilter, calendarDays, creditRetained, daysInStage, filterCounts, fileStatusLine, isMoneyInFlightEnabled, MifFile, mifAlerts,
  mifFilesFor, mifTotals, MIF_NOW, preselectReason, searchFiles, segmentsOf, sheetCtas, sortFiles, spokenAmount, stuckLine, summaryLine,
  ticketIdFor, visibleFiles,
} from '../moneyInFlight';
import { inrShort } from './inrShortShim';

const login = (m: string) => { const d = mockDealerProfile(m); return mifFilesFor(m, d.profile); };
const day = (d: number, h = 10) => new Date(2026, 10, 24 - d, h, 0);

test('ageing thresholds: 0–1 On time, 2–3 Ageing, 4+ Overdue (every product)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 30].map(ageingBand), ['onTime', 'onTime', 'ageing', 'ageing', 'overdue', 'overdue', 'overdue']);
});

test('ageing = calendar days in the CURRENT stage (not since sanction); credited has none', () => {
  const files = login('9800001111');
  const pooja = files.find((f) => f.customer === 'Pooja Iyer')!;
  assert.equal(daysInStage(pooja), 6);
  assert.equal(ageingOf(pooja), 'overdue');
  // Sanctioned earlier than the stage entry, but ageing counts from the docs-pending entry only.
  assert.ok(pooja.history[0]!.at < pooja.history[1]!.at);
  const rohan = files.find((f) => f.customer === 'Rohan Gupta')!;
  assert.equal(daysInStage(rohan), 3); assert.equal(ageingOf(rohan), 'ageing');
  const anita = files.find((f) => f.customer === 'Anita Shah')!;
  assert.equal(daysInStage(anita), 1); assert.equal(ageingOf(anita), 'onTime');
  const rahul = files.find((f) => f.customer === 'Rahul Sharma')!;
  assert.equal(ageingOf(rahul), null);
  assert.equal(calendarDays(new Date(2026, 10, 23, 23, 59), new Date(2026, 10, 24, 0, 1)), 1, 'calendar day, not 24 h');
});

test('credited files stay 3 days (credit day = day 1), then drop off (Cases done keeps them)', () => {
  const mk = (daysAgo: number): MifFile => ({
    lan: `CR-${daysAgo}`, customer: 'X Y', mobile: '9800000000', product: 'car', condition: 'new', vehicle: 'Car', sanctioned: 100000, expectedNet: 98000,
    stage: 'credited', history: [{ stage: 'credited', at: day(daysAgo) }], credited: { amount: 98000, utr: 'U', at: day(daysAgo) }, updatedAt: day(daysAgo),
  });
  assert.deepEqual([0, 1, 2, 3, 4, 7].map((d) => creditRetained(mk(d), MIF_NOW)), [true, true, true, false, false, false]);
  const files = login('9800001111');
  assert.ok(files.some((f) => f.customer === 'Sneha Joshi'), 'seed has a 4-day-old credit');
  assert.ok(!visibleFiles(files).some((f) => f.customer === 'Sneha Joshi'), 'and it is not visible');
  assert.equal(applyFilter(files, 'credited').length, 3);
});

test('1111 Shree Auto Mall: ₹22.9L in flight across 5 files, 2 overdue, ₹8.6L credited today (3 files)', () => {
  const files = login('9822011111');
  const t = mifTotals(files);
  assert.equal(t.inFlightAmount, 2290000);
  assert.equal(inrShort(t.inFlightAmount), '₹22.9L');
  assert.equal(t.inFlightCount, 5);
  assert.equal(t.overdueCount, 2);
  assert.equal(t.creditedTodayCount, 3);
  assert.equal(inrShort(t.creditedTodayAmount), '₹8.6L');
  assert.deepEqual(sortFiles(applyFilter(files, 'all')).slice(0, 2).map((f) => f.customer), ['Pooja Iyer', 'Amit Patil'], 'Home preview: Pooja then Amit');
  assert.ok(files.some((f) => f.customer.startsWith('Ramesh')), 'has a Ramesh file');
  // Scope: used TW / new or used car only — never a new two-wheeler, never a CV.
  for (const f of files) {
    assert.ok(!(f.product === 'twoWheeler' && f.condition === 'new'), `${f.customer} must not be new TW`);
    assert.notEqual(f.product, 'cv');
  }
  assert.equal(summaryLine(files), '5 files in flight, 22.9 lakh. 2 overdue.');
});

test('filter counts match the mockup chips for 1111', () => {
  const c = filterCounts(login('9822011111'));
  assert.deepEqual({ all: c.all, sanctioned: c.sanctioned, docs: c.docsPending, disb: c.disbursalInitiated, credited: c.credited, overdue: c.overdue },
    { all: 5, sanctioned: 2, docs: 2, disb: 1, credited: 3, overdue: 2 });
  assert.equal(c.stuck, 3, 'stuck = 2 overdue + Rohan (ageing, bank a/c mismatch)');
});

test('segment gating: Hero default (new TW only) hidden; 1111 / 2222 / 3333 shown; 0000 / no dealer hidden', () => {
  assert.equal(isMoneyInFlightEnabled(mockDealerProfile('9876543210').profile), false);
  assert.deepEqual(login('9876543210'), []);
  for (const m of ['9822011111', '9822012222', '9822013333']) assert.equal(isMoneyInFlightEnabled(mockDealerProfile(m).profile), true, m);
  assert.equal(isMoneyInFlightEnabled(null), false);
  assert.equal(isMoneyInFlightEnabled({ products: ['newTw'], segments: ['NEW_TW'] }), false);
  assert.equal(isMoneyInFlightEnabled({ products: ['newTw'], segments: ['NEW_TW', 'USED_TW'] }), true, 'used TW counts');
  // Sessions saved before v1.4.6 (no segments): derived from the products.
  assert.deepEqual(segmentsOf({ products: ['newTw'] }), ['NEW_TW']);
  assert.equal(isMoneyInFlightEnabled({ products: ['newCv'] }), true);
  assert.equal(isMoneyInFlightEnabled({ products: ['newTw'] }), false);
  // A gated dealer never gets files, even with a demo number's mobile.
  assert.deepEqual(mifFilesFor('9822011111', { ...mockDealerProfile('9822011111').profile, segments: ['NEW_TW'] }), []);
});

test('2222 Maruti and 3333 Tata CV: own files, a dealer-actionable stuck file and a recent credit with UTR', () => {
  for (const [m, amt, n, over] of [['9822012222', 1820000, 3, 1], ['9822013333', 4685000, 5, 2]] as const) {
    const files = login(m);
    const t = mifTotals(files);
    assert.equal(t.inFlightAmount, amt, m); assert.equal(t.inFlightCount, n, m); assert.equal(t.overdueCount, over, m);
    const rc = files.find((f) => f.blocker === 'RC_COPY')!;
    assert.ok(rc, `${m} has an RC copy pending file`);
    assert.equal(sheetCtas(rc).primary?.label, 'Upload RC copy');
    assert.equal(sheetCtas(rc).secondary?.label, 'Raise a query');
    assert.equal(sheetCtas(rc, { rcUploaded: true }).primary?.label, 'Raise a query', 'after upload the bank has it');
    const credits = applyFilter(files, 'credited');
    assert.ok(credits.length >= 1 && credits.every((f) => /^IDFBR\d+$/.test(f.credited!.utr)), m);
  }
  const maruti = login('9822012222');
  assert.ok(maruti.every((f) => f.product === 'car'), 'Maruti: cars only');
  assert.ok(login('9822013333').every((f) => f.product === 'cv'), 'Tata CV: CV only');
});

test('sheet CTAs: one primary; bank holds and short credits → Raise a query; matched credit → secondary only', () => {
  const files = login('9822011111');
  const by = (n: string) => files.find((f) => f.customer === n)!;
  assert.equal(sheetCtas(by('Amit Patil')).primary?.label, 'Raise a query'); // PDD hold (bank)
  assert.equal(sheetCtas(by('Amit Patil')).secondary, null);
  assert.equal(sheetCtas(by('Anita Shah')).primary?.label, 'Remind customer'); // mandate
  assert.equal(sheetCtas(by('Rohan Gupta')).primary?.label, 'View settlement account');
  assert.equal(sheetCtas(by('Rahul Sharma')).primary, null);
  assert.equal(sheetCtas(by('Rahul Sharma')).secondary?.label, 'Raise a query');
  const short = login('9822012222').find((f) => f.customer === 'Divya Menon')!;
  assert.equal(sheetCtas(short).primary?.label, 'Raise a query');
  assert.equal(preselectReason(short), 'shortCredit');
  assert.equal(preselectReason(by('Rohan Gupta')), 'wrongAccount');
  assert.equal(ticketIdFor('TW-184408'), 'QRY-184408-1');
});

test('search: full / first / last name (any case), 10-digit mobile, last 4; spans in-flight + recent credits', () => {
  const files = login('9822011111');
  const names = (q: string) => searchFiles(files, q).map((f) => f.customer).sort();
  assert.deepEqual(names('pooja iyer'), ['Pooja Iyer']);
  assert.deepEqual(names('POOJA'), ['Pooja Iyer']);
  assert.deepEqual(names('iyer'), ['Pooja Iyer']);
  assert.deepEqual(names('9822011112'), ['Amit Patil']);
  assert.deepEqual(names('1112'), ['Amit Patil']);
  assert.deepEqual(names('rahul'), ['Rahul Sharma'], 'credited today is searchable');
  assert.deepEqual(names('sneha'), [], 'a 4-day-old credit is not');
  assert.deepEqual(names('zzz'), []);
  assert.equal(searchFiles(files, '').length, visibleFiles(files).length);
});

test('spoken lines and alerts use the same files as the list', () => {
  const files = login('9822011111');
  assert.equal(stuckLine(files), '3 files stuck, 2 overdue. Oldest is Pooja Iyer, RC copy pending, 6 days.');
  assert.equal(fileStatusLine(files.find((f) => f.customer === 'Rahul Sharma')!), "Rahul's money has come. 1.35 lakh credited today at 9:43 AM.");
  assert.match(fileStatusLine(files.find((f) => f.customer.startsWith('Ramesh'))!), /^Ramesh Jadhav, Maruti Swift\. Not credited yet: sanctioned, e-Sign pending, since today\.$/);
  const a = mifAlerts(files);
  assert.equal(a[0]!.title, '₹1,35,000 credited for Rahul');
  assert.equal(a[1]!.tone, 'danger');
  assert.equal(spokenAmount(4685000), '46.9 lakh');
  assert.equal(spokenAmount(66500), '66 thousand 500 rupees');
});
