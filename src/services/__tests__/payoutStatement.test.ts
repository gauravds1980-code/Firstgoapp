/**
 * v1.4.8 Payout statement — pure logic: the ₹100 short-pay threshold (₹99 / ₹100 edges), itemised deductions are not
 * short-pay, CR-20354 reconciles, the October ₹1,150 short-pay, default period This month, PAY- vs QRY- ticket
 * prefixes, alert ↔ statement consistency and per-login totals. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDealerProfile } from '../dealer';
import { TODAY, type Invoice, type PayoutLine } from '../business';
import { DEFAULT_PRESET, defaultRange, monthRange, periodTitle, presetRange, rangeContaining, rangeLabel } from '../period';
import { PAYOUT_QUERY_REASONS, QUERY_QUEUES, queryTicketId, queueOfTicket } from '../queries';
import { QUERY_REASONS, ticketIdFor } from '../moneyInFlight';
import { seedAlertsFor, shortPaysFor } from '../alerts';
import {
  filterCounts, filterInvoices, findLine, homePayoutCard, invoiceFigures, isShortPay, isThirtyPlus, lineFigures, lineSpokenLine, preselectPayoutReason,
  queryIsPrimary, SHORT_PAY_MIN, shortPayLine, shortPaysIn, statementInvoicesFor, statementLine, statementSummary,
} from '../payoutStatement';

const L1 = '9800001111', L2 = '9800002222', L3 = '9800003333', HERO = '9800004444';
const stmt = (m: string) => statementInvoicesFor(m, mockDealerProfile(m).profile);
const NOV = presetRange('thisMonth');
const OCT = presetRange('lastMonth');
const line = (payout: number, o: Partial<PayoutLine> = {}): PayoutLine => ({ lan: 'CR-1', customer: 'A B', loan: 100000, ratePct: 1, payout, ...o });

/* ---------------- Threshold ---------------- */

test('short-pay threshold is ₹100: ₹99 is not flagged, ₹100 is', () => {
  assert.equal(SHORT_PAY_MIN, 100);
  assert.equal(isShortPay(5000, 4901), false); // ₹99
  assert.equal(isShortPay(5000, 4900), true); // ₹100
  assert.equal(isShortPay(5000, 5000), false);
  assert.equal(isShortPay(5000, 5100), false); // over-paid is never short
  const at99 = lineFigures(line(5000, { paid: 4901 }), 'Paid');
  assert.deepEqual([at99.shortPaid, at99.difference, at99.rounding], [false, 0, 99]);
  const at100 = lineFigures(line(5000, { paid: 4900 }), 'Paid');
  assert.deepEqual([at100.shortPaid, at100.difference, at100.rounding], [true, 100, 0]);
});

test('no payment posted = never short-paid (unclaimed / claimed lines have paid ₹0)', () => {
  for (const st of ['Not claimed', 'Claimed'] as const) {
    const f = lineFigures(line(8400), st);
    assert.deepEqual([f.posted, f.paid, f.shortPaid, f.difference], [false, 0, false, 0]);
  }
});

test('itemised deductions are not short-pay: expected is net of them, the line reconciles', () => {
  const f = lineFigures(line(4200, { gross: 8400, deductions: [{ label: 'Advance recovery', amount: 4200 }] }), 'Paid');
  assert.deepEqual([f.gross, f.deductionTotal, f.expected, f.paid, f.shortPaid, f.difference], [8400, 4200, 4200, 4200, false, 0]);
});

/* ---------------- 1111 (spec §f, Gaurav's answers) ---------------- */

test('1111: CR-20354 ₹4,200 advance recovery is an itemised deduction and reconciles', () => {
  const hit = findLine(stmt(L1), 'INV/26-27/1188', 'CR-20354')!;
  assert.equal(hit.line.customer, 'Kavya Nair');
  const f = lineFigures(hit.line, hit.inv.status);
  assert.deepEqual(f.deductions, [{ label: 'Advance recovery', amount: 4200 }]);
  assert.deepEqual([f.gross, f.expected, f.paid, f.shortPaid, f.difference], [8400, 4200, 4200, false, 0]);
  assert.equal(hit.inv.utr, 'IDFBR81726289001188');
  assert.equal(invoiceFigures(hit.inv).shortCount, 0);
});

test('1111: the one real short-pay is October, CR-20320, ₹1,150 scheme cap', () => {
  const all = shortPaysIn(stmt(L1));
  assert.equal(all.length, 1);
  const s = all[0]!;
  assert.deepEqual([s.invoice, s.lan, s.customer, s.expected, s.paid, s.difference, s.reason], ['INV/26-27/1176', 'CR-20320', 'Arjun Mehta', 5100, 3950, 1150, 'Scheme cap']);
  assert.equal(s.invoiceDate.getMonth(), 9); // October
});

test('1111 This month: ₹21,750 ready to claim, expected ₹32,775, paid ₹11,025, no short-pay, ₹4,200 deductions', () => {
  const s = statementSummary(stmt(L1), NOV);
  assert.equal(s.title, 'November 2026 · 1–24 Nov');
  assert.deepEqual([s.readyToClaim, s.expected, s.paid, s.difference, s.shortCount, s.deductionTotal, s.thirtyPlusCount], [21750, 32775, 11025, 0, 0, 4200, 0]);
  assert.deepEqual(s.hero, { text: '₹21,750 ready to claim', tone: 'warning' });
  assert.equal(s.caption, undefined);
});

test('1111 Last month: expected ₹19,200, paid ₹9,650, ₹1,150 difference on 1 file, 1 invoice 30+ days (₹8,400)', () => {
  const s = statementSummary(stmt(L1), OCT);
  assert.deepEqual([s.expected, s.paid, s.difference, s.shortCount, s.readyToClaim, s.thirtyPlusCount, s.thirtyPlusAmount], [19200, 9650, 1150, 1, 0, 1, 8400]);
  assert.deepEqual(s.hero, { text: '₹1,150 difference found on 1 file', tone: 'danger' });
  const inv1162 = stmt(L1).find((i) => i.id === 'INV/26-27/1162')!;
  assert.equal(isThirtyPlus(inv1162), true);
  assert.equal(invoiceFigures(inv1162).days, 43);
  assert.equal(invoiceFigures(inv1162).shortCount, 0); // 30+ days is not a short-pay
});

test('filters: Short paid / Ready to claim / 30+ days / Paid', () => {
  const oct = stmt(L1).filter((i) => i.date.getMonth() === 9);
  assert.deepEqual(filterInvoices(oct, 'short').map((i) => i.id), ['INV/26-27/1176']);
  assert.deepEqual(filterInvoices(oct, 'thirty').map((i) => i.id), ['INV/26-27/1162']);
  assert.deepEqual(filterInvoices(oct, 'paid').map((i) => i.id), ['INV/26-27/1176']);
  const nov = stmt(L1).filter((i) => i.date.getMonth() === 10);
  assert.deepEqual(filterInvoices(nov, 'ready').map((i) => i.id), ['INV/26-27/1196']);
  assert.deepEqual(filterCounts(nov), { all: 2, short: 0, ready: 1, thirty: 0, paid: 1 });
  assert.deepEqual(filterCounts(oct), { all: 2, short: 1, ready: 0, thirty: 1, paid: 1 });
});

test('line sheet: Raise a query is primary on a short-paid or 30+ days line, with the right reason', () => {
  const inv = stmt(L1);
  const s = findLine(inv, 'INV/26-27/1176', 'CR-20320')!;
  assert.equal(queryIsPrimary(s.inv, s.line), true);
  assert.equal(preselectPayoutReason(s.inv, s.line), 'shortPaid');
  const old = findLine(inv, 'INV/26-27/1162', 'CR-20290')!;
  assert.equal(queryIsPrimary(old.inv, old.line), true);
  assert.equal(preselectPayoutReason(old.inv, old.line), 'notReceived');
  const ded = findLine(inv, 'INV/26-27/1188', 'CR-20354')!;
  assert.equal(queryIsPrimary(ded.inv, ded.line), false);
  assert.equal(preselectPayoutReason(ded.inv, ded.line), 'deduction');
});

/* ---------------- Default period ---------------- */

test('default period is This month (1–24 Nov 2026); Last 3 months starts 1 Sep', () => {
  assert.equal(DEFAULT_PRESET, 'thisMonth');
  const r = defaultRange();
  assert.equal(r.preset, 'thisMonth');
  assert.deepEqual([r.from.getMonth(), r.from.getDate(), r.to.getDate()], [10, 1, 24]);
  assert.equal(rangeLabel(r), 'This month · 01 Nov – 24 Nov');
  const l3 = presetRange('last3Months');
  assert.deepEqual([l3.from.getMonth(), l3.from.getDate(), l3.to.getTime()], [8, 1, TODAY.getTime()]);
  assert.equal(periodTitle(l3), 'Sep – Nov 2026 · 1 Sep – 24 Nov');
  // A deep link lands on the narrowest period that holds the invoice.
  assert.equal(rangeContaining(new Date(2026, 9, 28)).preset, 'lastMonth');
  assert.equal(rangeContaining(new Date(2026, 10, 5)).preset, 'thisMonth');
  assert.equal(rangeContaining(new Date(2026, 8, 20)).preset, 'last3Months');
  assert.equal(rangeContaining(new Date(2026, 6, 20)).preset, 'custom');
  assert.equal(monthRange(2026, 9).to.getDate(), 31);
});

/* ---------------- Query queues ---------------- */

test('payout queries go to payout ops (PAY-), Money-in-flight queries stay QRY-', () => {
  assert.equal(queryTicketId('payoutOps', 'CR-20320'), 'PAY-0320');
  assert.equal(queryTicketId('payoutOps', 'TW-184133'), 'PAY-4133');
  assert.match(queryTicketId('payoutOps', 'CR-20320'), /^PAY-\d{4}$/);
  assert.equal(ticketIdFor('CR-20417'), 'QRY-20417-1'); // unchanged v1.4.6 format
  assert.equal(queryTicketId('rm', 'CR-20417'), 'QRY-20417-1');
  assert.equal(queueOfTicket('PAY-0320'), 'payoutOps');
  assert.equal(queueOfTicket('QRY-20417-1'), 'rm');
  assert.equal(QUERY_QUEUES.payoutOps.prefix, 'PAY');
  assert.equal(QUERY_QUEUES.rm.prefix, 'QRY');
  assert.deepEqual(PAYOUT_QUERY_REASONS.map((r) => r.label), ['Short paid', 'Not received', 'Wrong rate', 'Deduction query', 'Other']);
  // The MIF reasons are untouched.
  assert.deepEqual(QUERY_REASONS.map((r) => r.label), ['Amount not received', 'Short credit', 'Stuck at stage', 'Wrong account', 'Other']);
});

/* ---------------- Alert ↔ statement ---------------- */

test('every commission alert matches the statement (invoice, amount, line, short-pay figures)', () => {
  for (const m of [L1, L2, L3, HERO]) {
    const inv = stmt(m);
    for (const e of seedAlertsFor(m, mockDealerProfile(m).profile).filter((x) => x.type.startsWith('payout.'))) {
      if (e.type === 'payout.shortPaid') {
        const hit = findLine(inv, e.short!.invoice, e.short!.lan)!;
        const f = lineFigures(hit.line, hit.inv.status);
        assert.ok(f.shortPaid && f.difference >= 100, `${m} ${e.id}`);
        assert.deepEqual([e.short!.expected, e.short!.paid, e.short!.difference, e.amount], [f.expected, f.paid, f.difference, f.difference]);
        assert.deepEqual(e.target, { screen: 'Payouts', invoice: hit.inv.id, lan: hit.line.lan });
      } else {
        const i = inv.find((x) => x.id === e.subject)!;
        assert.ok(i, `${m} ${e.subject}`);
        assert.equal(e.amount, i.amount);
        assert.equal(i.status, e.type === 'payout.readyToClaim' ? 'Not claimed' : 'Paid');
      }
    }
    // The statement never has a short-pay that the alert feed does not know about (1111 / Hero) — and none in 2222 / 3333.
    assert.deepEqual(shortPaysIn(inv).map((s) => `${s.invoice}#${s.lan}`), shortPaysFor(m, mockDealerProfile(m).profile).map((s) => `${s.invoice}#${s.lan}`));
  }
});

/* ---------------- Per-login totals ---------------- */

test('per-login This month / Last month totals', () => {
  const want: Record<string, { nov: number[]; oct: number[] }> = {
    // [expected, paid, difference, readyToClaim, shortCount, deductions, rounding]
    [L1]: { nov: [32775, 11025, 0, 21750, 0, 4200, 0], oct: [19200, 9650, 1150, 0, 1, 0, 0] },
    [L2]: { nov: [34650, 21450, 0, 13200, 0, 0, 0], oct: [19575, 19535, 0, 0, 0, 0, 40] },
    [L3]: { nov: [31680, 22920, 0, 8760, 0, 0, 0], oct: [12930, 7290, 0, 0, 0, 1230, 0] },
    [HERO]: { nov: [13050, 8040, 600, 4410, 1, 0, 0], oct: [4665, 4620, 0, 0, 0, 0, 45] },
  };
  for (const [m, w] of Object.entries(want)) {
    const pick = (r: typeof NOV) => { const s = statementSummary(stmt(m), r); return [s.expected, s.paid, s.difference, s.readyToClaim, s.shortCount, s.deductionTotal, s.rounding]; };
    assert.deepEqual(pick(NOV), w.nov, `${m} Nov`);
    assert.deepEqual(pick(OCT), w.oct, `${m} Oct`);
  }
  // Commission is for every dealer: new-TW-only Hero has a statement with Hero two-wheeler lines.
  const hero = stmt(HERO).filter((i) => i.date >= OCT.from);
  assert.ok(hero.length && hero.every((i) => i.lines.every((l) => l.product === 'twoWheeler')));
  // 2222 / 3333: a Claimed 30+ days invoice for 3333 only; 2222's ₹40 rounding is not flagged.
  assert.equal(statementSummary(stmt(L3), OCT).thirtyPlusCount, 1);
  assert.equal(statementSummary(stmt(L2), OCT).hero.text, 'All caught up');
});

test('explicit figures are fields, not loan × rate; invoice amount = sum of net expected', () => {
  for (const m of [L1, L2, L3, HERO]) {
    for (const i of stmt(m).filter((x) => x.date >= OCT.from)) {
      assert.equal(i.amount, i.lines.reduce((t, l) => t + l.payout, 0));
      for (const l of i.lines) assert.equal(typeof l.gross, 'number');
    }
  }
  const ids = stmt(L1).map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'invoice ids are unique');
});

test('Home Payouts card: ready to claim, plus the latest short-pay caption', () => {
  assert.deepEqual(homePayoutCard(stmt(L1)).hero, '₹21,750 ready to claim');
  assert.equal(homePayoutCard(stmt(L1)).caption, '₹1,150 difference found · Oct statement');
  assert.equal(homePayoutCard(stmt(L2)).caption, undefined);
  assert.equal(homePayoutCard(stmt(HERO)).caption, '₹600 difference found on 1 file');
});

test('spoken lines use only statement fields', () => {
  const inv = stmt(L1);
  assert.equal(statementLine(statementSummary(inv, NOV), NOV),
    'November statement: expected 32 thousand 775 rupees, paid 11 thousand 25 rupees. 21 thousand 750 rupees ready to claim. No short payments.');
  assert.equal(statementLine(statementSummary(inv, OCT), OCT),
    'October statement: expected 19 thousand 200 rupees, paid 9 thousand 650 rupees. 1 thousand 150 rupees difference found on 1 file, Arjun Mehta, CR-20320. 1 invoice unpaid for more than 30 days.');
  assert.equal(shortPayLine(shortPaysIn(inv)), '1 short payment. Arjun Mehta, Maruti Swift, expected 5 thousand 100 rupees, paid 3 thousand 950 rupees, reason scheme cap.');
  assert.equal(shortPayLine([]), 'No short payments in the last 3 months.');
  const k = findLine(inv, 'INV/26-27/1188', 'CR-20354')!;
  assert.equal(lineSpokenLine(k.line, k.inv), 'Kavya Nair, CR-20354. Expected 4 thousand 200 rupees after 4 thousand 200 rupees advance recovery, paid 4 thousand 200 rupees. Matched.');
  const a = findLine(inv, 'INV/26-27/1176', 'CR-20320')!;
  assert.match(lineSpokenLine(a.line, a.inv), /difference 1 thousand 150 rupees, reason scheme cap\. Raise a query\?$/);
  for (const s of [statementLine(statementSummary(inv, NOV), NOV), shortPayLine(shortPaysIn(inv))]) assert.ok(!/\d{10}/.test(s));
});

test('demo arrival still has two Claimed invoices to pay (day + night) for 1111', () => {
  const claimed = stmt(L1).filter((i: Invoice) => i.status === 'Claimed');
  assert.ok(claimed.length >= 2, `claimed: ${claimed.map((i) => i.id).join(', ')}`);
});
