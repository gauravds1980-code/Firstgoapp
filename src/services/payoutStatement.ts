/**
 * v1.4.8 Feature 3 — Payout statement with short-pay checks (spec 03-payout-statement.md, approved 28 Nov 2026 with
 * Gaurav's answers). Pure module (no React Native): unit-tested in Node (services/__tests__/payoutStatement.test.ts).
 *
 * Approved decisions:
 *  1. A line is SHORT PAID only when a payment has posted and (expected − paid) >= ₹100 (SHORT_PAY_MIN). A smaller gap
 *     (TDS / rupee rounding) is shown as matched, with a "₹x rounding" caption.
 *  2. Default period = This month (period.ts DEFAULT_PRESET).
 *  3. Expected deductions (advance recovery, TDS, known clawbacks) are ITEMISED on the line and already netted out of
 *     `expected`: they are never a short-pay. 1111's CR-20354 ₹4,200 advance recovery reconciles. The one real
 *     short-pay in 1111 is October: CR-20320, ₹1,150, scheme cap (the feature-2 short-pay alert is that same line).
 *  4. Payout / short-pay / deduction queries go to the payout-ops queue (PAY-xxxx), see queries.ts.
 *
 * Commission is not product-scoped: every dealer has a statement, including new-two-wheeler-only (default Hero).
 * Loan credits (Money in flight) never appear here.
 *
 * EXAMPLE DATA: November and October are explicit per login (expected, paid, deductions and reason are fields "from
 * the payout system" — the app never recomputes expected from loan × rate). Older months keep the generated invoices
 * (renumbered) so the 3-month chart and the Advance payout limit still have history.
 */
import type { ProductId } from '../config/products';
import { casesFor, invoicesFor, MONTHS, TODAY, type Invoice, type InvoiceStatus, type PayoutDeduction, type PayoutLine } from './business';
import type { DealerProfile } from './dealer';
import { inRange, periodSpoken, periodTitle, presetRange, type DateRange } from './period';
import { spokenAmount } from './moneyInFlight';
import { inr } from '../utils/finance';

/** Approved threshold (Gaurav #1): flag only when expected − paid is at least ₹100. */
export const SHORT_PAY_MIN = 100;
/** Pure rule: a posted payment below expected by ₹100 or more. */
export const isShortPay = (expected: number, paid: number): boolean => expected - paid >= SHORT_PAY_MIN;
/** Days after the invoice date when an unpaid (Not claimed / Claimed) invoice is flagged "30+ days". */
export const THIRTY_PLUS_DAYS = 30;

const DAY = 864e5;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const daysSince = (d: Date, today: Date = TODAY): number => Math.round((dayStart(today) - dayStart(d)) / DAY);
export const isThirtyPlus = (inv: Pick<Invoice, 'status' | 'date'>, today: Date = TODAY): boolean => inv.status !== 'Paid' && daysSince(inv.date, today) > THIRTY_PLUS_DAYS;

/* ---------------- One line ---------------- */

export interface LineFigures {
  gross: number; deductions: PayoutDeduction[]; deductionTotal: number;
  /** Net expected (after itemised deductions), as sent by the payout system. */
  expected: number;
  /** ₹0 until a payment posts (invoice Paid). */
  paid: number; posted: boolean;
  /** Short-pay difference (0 unless flagged). */
  difference: number; shortPaid: boolean;
  /** A posted gap under ₹100: shown as matched with a rounding caption. */
  rounding: number;
  reason?: string;
}
export function lineFigures(l: PayoutLine, status: InvoiceStatus): LineFigures {
  const deductions = l.deductions ?? [];
  const deductionTotal = deductions.reduce((t, d) => t + d.amount, 0);
  const expected = l.payout;
  const posted = status === 'Paid';
  const paid = posted ? (l.paid ?? expected) : 0;
  const gap = posted ? Math.max(0, expected - paid) : 0;
  const shortPaid = posted && isShortPay(expected, paid);
  return {
    gross: l.gross ?? expected + deductionTotal, deductions, deductionTotal, expected, paid, posted,
    difference: shortPaid ? gap : 0, shortPaid, rounding: shortPaid ? 0 : gap, ...(l.reason ? { reason: l.reason } : {}),
  };
}

export type LineStatus = 'Short paid' | 'Paid' | 'Claimed' | 'Not claimed';
export const lineStatus = (f: LineFigures, status: InvoiceStatus): LineStatus => (f.shortPaid ? 'Short paid' : status);
export const LINE_TONE: Record<LineStatus | '30+ days', 'danger' | 'success' | 'info' | 'warning'> = {
  'Short paid': 'danger', Paid: 'success', Claimed: 'info', 'Not claimed': 'warning', '30+ days': 'warning',
};

/* ---------------- One invoice ---------------- */

export interface InvoiceFigures { expected: number; paid: number; difference: number; shortCount: number; deductionTotal: number; rounding: number; thirtyPlus: boolean; days: number }
export function invoiceFigures(inv: Invoice, today: Date = TODAY): InvoiceFigures {
  const ls = inv.lines.map((l) => lineFigures(l, inv.status));
  const sum = (k: keyof Pick<LineFigures, 'expected' | 'paid' | 'difference' | 'deductionTotal' | 'rounding'>) => ls.reduce((t, f) => t + f[k], 0);
  return {
    expected: sum('expected'), paid: sum('paid'), difference: sum('difference'), shortCount: ls.filter((f) => f.shortPaid).length,
    deductionTotal: sum('deductionTotal'), rounding: sum('rounding'), thirtyPlus: isThirtyPlus(inv, today), days: daysSince(inv.date, today),
  };
}

/** A short-paid line with its invoice (alerts, voice, the Short paid chip). */
export interface ShortPay { invoice: string; lan: string; customer: string; vehicle?: string; expected: number; paid: number; difference: number; reason?: string; invoiceDate: Date }
export function shortPaysIn(invoices: readonly Invoice[]): ShortPay[] {
  return invoices.flatMap((inv) => inv.lines.flatMap((l) => {
    const f = lineFigures(l, inv.status);
    return f.shortPaid ? [{ invoice: inv.id, lan: l.lan, customer: l.customer, ...(l.vehicle ? { vehicle: l.vehicle } : {}), expected: f.expected, paid: f.paid, difference: f.difference, ...(f.reason ? { reason: f.reason } : {}), invoiceDate: inv.date }] : [];
  }));
}

/* ---------------- Filters ---------------- */

export type StatementFilter = 'all' | 'short' | 'ready' | 'thirty' | 'paid';
export const STATEMENT_FILTERS: { id: StatementFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'short', label: 'Short paid' }, { id: 'ready', label: 'Ready to claim' }, { id: 'thirty', label: '30+ days' }, { id: 'paid', label: 'Paid' },
];
export function matchesFilter(inv: Invoice, f: StatementFilter, today: Date = TODAY): boolean {
  switch (f) {
    case 'all': return true;
    case 'short': return invoiceFigures(inv, today).shortCount > 0;
    case 'ready': return inv.status === 'Not claimed';
    case 'thirty': return isThirtyPlus(inv, today);
    case 'paid': return inv.status === 'Paid';
  }
}
export const filterInvoices = (invoices: readonly Invoice[], f: StatementFilter, today: Date = TODAY): Invoice[] => invoices.filter((i) => matchesFilter(i, f, today));
export function filterCounts(invoices: readonly Invoice[], today: Date = TODAY): Record<StatementFilter, number> {
  const n = (f: StatementFilter) => filterInvoices(invoices, f, today).length;
  // Short paid counts FILES (lines), the rest count invoices.
  return { all: invoices.length, short: shortPaysIn(invoices).length, ready: n('ready'), thirty: n('thirty'), paid: n('paid') };
}

/* ---------------- Period summary (StatementSummaryCard) ---------------- */

export interface StatementSummary {
  title: string; invoices: number;
  expected: number; paid: number; difference: number; shortCount: number; shorts: ShortPay[];
  readyToClaim: number; readyCount: number; deductionTotal: number; rounding: number; thirtyPlusCount: number; thirtyPlusAmount: number;
  hero: { text: string; tone: 'warning' | 'danger' | 'success' | 'info' | 'neutral' };
  /** Danger caption under a ready-to-claim hero when the period also has a short-pay. */
  caption?: string;
}
const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
export const differenceText = (amount: number, n: number) => `${inr(amount)} difference found on ${files(n)}`;

/** Totals of the invoices in `range`. Unclaimed amounts are in Expected and never count as a short-pay. */
export function statementSummary(all: readonly Invoice[], range: DateRange, today: Date = TODAY): StatementSummary {
  const inv = all.filter((i) => inRange(i.date, range));
  const figs = inv.map((i) => invoiceFigures(i, today));
  const sum = (k: keyof Pick<InvoiceFigures, 'expected' | 'paid' | 'difference' | 'shortCount' | 'deductionTotal' | 'rounding'>) => figs.reduce((t, f) => t + f[k], 0);
  const ready = inv.filter((i) => i.status === 'Not claimed');
  const thirty = inv.filter((i) => isThirtyPlus(i, today));
  const s = {
    title: periodTitle(range), invoices: inv.length,
    expected: sum('expected'), paid: sum('paid'), difference: sum('difference'), shortCount: sum('shortCount'), shorts: shortPaysIn(inv),
    readyToClaim: ready.reduce((t, i) => t + i.amount, 0), readyCount: ready.length, deductionTotal: sum('deductionTotal'), rounding: sum('rounding'),
    thirtyPlusCount: thirty.length, thirtyPlusAmount: thirty.reduce((t, i) => t + i.amount, 0),
  };
  const awaiting = inv.filter((i) => i.status === 'Claimed').reduce((t, i) => t + i.amount, 0);
  let hero: StatementSummary['hero'];
  let caption: string | undefined;
  if (!inv.length) hero = { text: 'No payouts in this period', tone: 'neutral' };
  else if (s.readyToClaim > 0) {
    hero = { text: `${inr(s.readyToClaim)} ready to claim`, tone: 'warning' };
    if (s.shortCount) caption = differenceText(s.difference, s.shortCount);
  } else if (s.shortCount) hero = { text: differenceText(s.difference, s.shortCount), tone: 'danger' };
  else if (awaiting > 0) hero = { text: `${inr(awaiting)} claimed, awaiting payment`, tone: 'info' };
  else hero = { text: 'All caught up', tone: 'success' };
  return { ...s, hero, ...(caption ? { caption } : {}) };
}

/* ---------------- Spoken lines (English; Piper) ---------------- */

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const reasonSpoken = (r?: string) => (r ? r.toLowerCase() : 'reason not given');
/** "November statement: expected …, paid …. … ready to claim. No short payments." */
export function statementLine(s: StatementSummary, range: DateRange): string {
  const name = periodSpoken(range);
  if (!s.invoices) return `No payouts in ${name}.`;
  const parts = [`${name} statement: expected ${spokenAmount(s.expected)}, paid ${spokenAmount(s.paid)}.`];
  if (s.readyToClaim) parts.push(`${spokenAmount(s.readyToClaim)} ready to claim.`);
  if (s.shortCount) {
    const f = s.shorts[0]!;
    parts.push(`${spokenAmount(s.difference)} difference found on ${plural(s.shortCount, 'file')}, ${f.customer}, ${f.lan}.`);
  } else parts.push('No short payments.');
  if (s.thirtyPlusCount) parts.push(`${plural(s.thirtyPlusCount, 'invoice')} unpaid for more than 30 days.`);
  return parts.join(' ');
}
/** "1 short payment. Arjun Mehta, Maruti Swift, expected …, paid …, reason scheme cap." */
export function shortPayLine(shorts: readonly ShortPay[]): string {
  if (!shorts.length) return 'No short payments in the last 3 months.';
  const f = shorts[0]!;
  const head = shorts.length === 1 ? '1 short payment.' : `${shorts.length} short payments. The latest:`;
  return `${head} ${f.customer}${f.vehicle ? `, ${f.vehicle}` : ''}, expected ${spokenAmount(f.expected)}, paid ${spokenAmount(f.paid)}, reason ${reasonSpoken(f.reason)}.`;
}
/** One line, spoken: only the fields on the line (never a client-computed figure). */
export function lineSpokenLine(l: PayoutLine, inv: Invoice): string {
  const f = lineFigures(l, inv.status);
  const who = `${l.customer}, ${l.lan}.`;
  if (inv.status !== 'Paid') return `${who} Expected ${spokenAmount(f.expected)}, ${inv.status === 'Claimed' ? 'claimed, not paid yet' : 'not claimed yet'}.`;
  const ded = f.deductionTotal ? ` after ${spokenAmount(f.deductionTotal)} ${f.deductions.map((d) => d.label.toLowerCase()).join(' and ')}` : '';
  if (f.shortPaid) return `${who} Expected ${spokenAmount(f.expected)}${ded}, paid ${spokenAmount(f.paid)}, difference ${spokenAmount(f.difference)}, reason ${reasonSpoken(f.reason)}. Raise a query?`;
  return `${who} Expected ${spokenAmount(f.expected)}${ded}, paid ${spokenAmount(f.paid)}. Matched.`;
}

/* ---------------- Line sheet CTA + query preselect ---------------- */

/** Raise a query is the PRIMARY action on a short-paid line or an unpaid 30+ days invoice; otherwise secondary. */
export const queryIsPrimary = (inv: Invoice, l: PayoutLine, today: Date = TODAY): boolean => lineFigures(l, inv.status).shortPaid || isThirtyPlus(inv, today);
export function preselectPayoutReason(inv: Invoice, l: PayoutLine, today: Date = TODAY): 'shortPaid' | 'notReceived' | 'deduction' | undefined {
  const f = lineFigures(l, inv.status);
  if (f.shortPaid) return 'shortPaid';
  if (isThirtyPlus(inv, today)) return 'notReceived';
  if (f.deductionTotal) return 'deduction';
  return undefined;
}
/** Statement line key (one open query per line in the demo). */
export const lineKey = (invoice: string, lan: string) => `${invoice}#${lan}`;

/* ---------------- Mock data per login ---------------- */

export type StatementKey = '1111' | '2222' | '3333' | 'default';
/** Demo login → statement. Commission is for every dealer (new-TW-only Hero included). */
export function statementKeyFor(mobile: string | null | undefined): StatementKey {
  const m = mobile ?? '';
  return m.endsWith('1111') ? '1111' : m.endsWith('2222') ? '2222' : m.endsWith('3333') ? '3333' : 'default';
}

type Row = { lan: string; customer: string; vehicle: string; product: ProductId; loan: number; ratePct: number; gross: number; ded?: [string, number][]; paid?: number; reason?: string };
type Inv = { id: string; date: [number, number]; status: InvoiceStatus; utr?: string; paidOn?: [number, number]; rows: Row[] };
const tw = (lan: string, customer: string, vehicle: string, loan: number, gross: number, o: Partial<Row> = {}): Row => ({ lan, customer, vehicle, product: 'twoWheeler', loan, ratePct: 1.5, gross, ...o });
const car = (lan: string, customer: string, vehicle: string, loan: number, gross: number, o: Partial<Row> = {}): Row => ({ lan, customer, vehicle, product: 'car', loan, ratePct: 0.75, gross, ...o });
const cv = (lan: string, customer: string, vehicle: string, loan: number, gross: number, o: Partial<Row> = {}): Row => ({ lan, customer, vehicle, product: 'cv', loan, ratePct: 0.6, gross, ...o });

/** November + October 2026 per login (spec §f, re-based on Gaurav's answers). Dates are [month (0-based), day]. */
const EXPLICIT: Record<StatementKey, Inv[]> = {
  '1111': [
    { id: 'INV/26-27/1196', date: [10, 18], status: 'Not claimed', rows: [
      car('CR-20390', 'Sneha Joshi', 'Tata Punch', 920000, 6900), car('CR-20388', 'Rohit Kale', 'Hyundai Venue', 880000, 6600),
      car('CR-20385', 'Deepa Iyer', 'Maruti Dzire', 700000, 5250), tw('TW-184370', 'Anjali More', 'Hero Splendor+', 80000, 1200),
      tw('TW-184368', 'Kunal Shah', 'TVS Raider', 120000, 1800)] },
    // CR-20354: the ₹4,200 advance recovery is an itemised deduction (Gaurav #3) — the line reconciles.
    { id: 'INV/26-27/1188', date: [10, 5], status: 'Paid', utr: 'IDFBR81726289001188', paidOn: [10, 12], rows: [
      car('CR-20354', 'Kavya Nair', 'Maruti Baleno', 1120000, 8400, { ded: [['Advance recovery', 4200]] }),
      car('CR-20348', 'Aditi Rao', 'Hyundai i20', 720000, 5400), tw('TW-184355', 'Vikram Rao', 'Honda Activa', 95000, 1425)] },
    // The one real short-pay: ₹1,150, scheme cap (paid this morning; the feature-2 alert is this line).
    { id: 'INV/26-27/1176', date: [9, 28], status: 'Paid', utr: 'IDFBR81726289001176', paidOn: [10, 24], rows: [
      car('CR-20320', 'Arjun Mehta', 'Maruti Swift', 680000, 5100, { paid: 3950, reason: 'Scheme cap' }),
      car('CR-20318', 'Nisha Patil', 'Tata Tiago', 540000, 4050), tw('TW-184330', 'Priya Kulkarni', 'TVS Apache', 110000, 1650)] },
    { id: 'INV/26-27/1162', date: [9, 12], status: 'Claimed', rows: [car('CR-20290', 'Sameer Joshi', 'Hyundai Creta', 1120000, 8400)] },
  ],
  '2222': [
    { id: 'INV/26-27/1197', date: [10, 20], status: 'Not claimed', rows: [
      car('CR-20436', 'Kiran Shetty', 'Maruti Swift', 740000, 5550), car('CR-20438', 'Ajay Kulkarni', 'Maruti Brezza', 1020000, 7650)] },
    { id: 'INV/26-27/1194', date: [10, 13], status: 'Paid', utr: 'IDFBR81726289002194', paidOn: [10, 22], rows: [
      car('CR-20402', 'Varsha Naik', 'Maruti Baleno', 960000, 7200), car('CR-20405', 'Tushar Mane', 'Maruti Swift', 720000, 5400),
      car('CR-20407', 'Neelam Shah', 'Maruti Brezza', 1180000, 8850)] },
    // ₹40 under expected (TDS rounding): below ₹100, so matched with a rounding caption, never flagged.
    { id: 'INV/26-27/1183', date: [9, 23], status: 'Paid', utr: 'IDFBR81726289002183', paidOn: [9, 30], rows: [
      car('CR-20371', 'Rakesh Bhosale', 'Maruti Swift', 690000, 5175, { paid: 5135, reason: 'TDS rounding' }),
      car('CR-20374', 'Smita Rane', 'Maruti Baleno', 880000, 6600)] },
    { id: 'INV/26-27/1171', date: [9, 9], status: 'Paid', utr: 'IDFBR81726289002171', paidOn: [9, 16], rows: [car('CR-20352', 'Vijay Pillai', 'Maruti Brezza', 1040000, 7800)] },
  ],
  '3333': [
    { id: 'INV/26-27/1195', date: [10, 19], status: 'Not claimed', rows: [
      cv('CV-30236', 'Ravi Chauhan', 'Tata Ace Gold', 620000, 3720), cv('CV-30238', 'Sunita Gaikwad', 'Tata Intra V30', 840000, 5040)] },
    { id: 'INV/26-27/1194', date: [10, 15], status: 'Paid', utr: 'IDFBR81726289003194', paidOn: [10, 23], rows: [
      cv('CV-30203', 'Baldev Singh', 'Tata Yodha 2.0', 980000, 5880), cv('CV-30205', 'Prakash Rao', 'Tata 407 Gold SFC', 1460000, 8760),
      cv('CV-30207', 'Harish Patil', 'Tata Ultra T.7', 1380000, 8280)] },
    // A known clawback (early foreclosure) is an itemised deduction, not a short-pay.
    { id: 'INV/26-27/1179', date: [9, 26], status: 'Paid', utr: 'IDFBR81726289003179', paidOn: [10, 2], rows: [
      cv('CV-30190', 'Deepak Yadav', 'Tata Intra V30', 820000, 4920, { ded: [['Clawback (early foreclosure)', 1230]] }),
      cv('CV-30193', 'Anil Thorat', 'Tata Ace Gold', 600000, 3600)] },
    { id: 'INV/26-27/1158', date: [9, 8], status: 'Claimed', rows: [cv('CV-30170', 'Mohan Kale', 'Tata Yodha 2.0', 940000, 5640)] },
  ],
  default: [
    { id: 'INV/26-27/1199', date: [10, 21], status: 'Not claimed', rows: [
      tw('TW-184421', 'Sunil Pawar', 'Hero Splendor+', 82000, 1230), tw('TW-184424', 'Farhan Shaikh', 'Hero Xtreme 125R', 106000, 1590),
      tw('TW-184426', 'Lata Kamble', 'Hero Vida V2', 106000, 1590)] },
    { id: 'INV/26-27/1194', date: [10, 14], status: 'Paid', utr: 'IDFBR81726289004194', paidOn: [10, 22], rows: [
      tw('TW-184402', 'Ganesh Patil', 'Hero Splendor+', 88000, 1320), tw('TW-184405', 'Rekha Joshi', 'Hero Xtreme 125R', 110000, 1650),
      tw('TW-184407', 'Imran Khan', 'Hero Splendor+', 84000, 1260), tw('TW-184410', 'Swati Gokhale', 'Hero Vida V2', 94000, 1410)] },
    // Hero's own (read) short-pay: ₹600, rate difference (the v1.4.7 Hero alert, now from this line).
    { id: 'INV/26-27/1192', date: [10, 7], status: 'Paid', utr: 'IDFBR81726289004192', paidOn: [10, 23], rows: [
      tw('TW-184133', 'Nitin Sawant', 'Hero Xtreme 125R', 120000, 1800, { paid: 1200, reason: 'Rate difference' }),
      tw('TW-184136', 'Pallavi Desai', 'Hero Splendor+', 80000, 1200)] },
    { id: 'INV/26-27/1181', date: [9, 24], status: 'Paid', utr: 'IDFBR81726289004181', paidOn: [9, 31], rows: [
      tw('TW-184360', 'Mahesh Jadhav', 'Hero Splendor+', 95000, 1425, { paid: 1380, reason: 'TDS rounding' }),
      tw('TW-184362', 'Kiran More', 'Hero Xtreme 125R', 104000, 1560)] },
    { id: 'INV/26-27/1172', date: [9, 10], status: 'Paid', utr: 'IDFBR81726289004172', paidOn: [9, 18], rows: [tw('TW-184341', 'Asha Kulkarni', 'Hero Vida V2', 112000, 1680)] },
  ],
};

/** First day of the explicit statement months; older invoices come from the generator. */
const EXPLICIT_FROM = (today: Date) => new Date(today.getFullYear(), today.getMonth() - 1, 1);

function build(i: Inv, today: Date): Invoice {
  const y = today.getFullYear();
  const lines: PayoutLine[] = i.rows.map((r) => {
    const deductions = (r.ded ?? []).map(([label, amount]) => ({ label, amount }));
    const net = r.gross - deductions.reduce((t, d) => t + d.amount, 0);
    return {
      lan: r.lan, customer: r.customer, vehicle: r.vehicle, product: r.product, loan: r.loan, ratePct: r.ratePct, gross: r.gross, payout: net,
      ...(deductions.length ? { deductions } : {}), ...(r.paid !== undefined ? { paid: r.paid } : {}), ...(r.reason ? { reason: r.reason } : {}),
    };
  });
  return {
    id: i.id, date: new Date(y, i.date[0], i.date[1]), status: i.status, lines, amount: lines.reduce((t, l) => t + l.payout, 0),
    ...(i.utr ? { utr: i.utr } : {}), ...(i.paidOn ? { paidOn: new Date(y, i.paidOn[0], i.paidOn[1]) } : {}),
  };
}

/** Generated history before the explicit months: renumbered ids, vehicle / product from the case, Paid after 60 days (else Claimed). */
function olderInvoices(profile: DealerProfile | null | undefined, today: Date): Invoice[] {
  const cases = casesFor(profile ?? null);
  const byLan = new Map(cases.map((c) => [c.lan, c]));
  const from = EXPLICIT_FROM(today);
  return invoicesFor(cases).filter((i) => i.date < from).map((i, k) => {
    const n = 1150 - k;
    const status: InvoiceStatus = daysSince(i.date, today) > 60 ? 'Paid' : 'Claimed';
    const lines = i.lines.map((l) => { const c = byLan.get(l.lan); return { ...l, ...(c ? { vehicle: c.vehicle, product: c.product } : {}) }; });
    return { id: `INV/26-27/${n}`, date: i.date, status, lines, amount: i.amount, ...(status === 'Paid' ? { utr: `IDFBR8172628900${n}` } : {}) };
  });
}

/**
 * The dealer's statement invoices, newest first: explicit November / October for the login, then generated history.
 * The seed for Payouts, the Home Payouts card, the Advance payout limit and the commission alerts.
 */
export function statementInvoicesFor(mobile: string | null | undefined, profile: DealerProfile | null | undefined, today: Date = TODAY): Invoice[] {
  const explicit = EXPLICIT[statementKeyFor(mobile)].map((i) => build(i, today));
  return [...explicit, ...olderInvoices(profile, today)].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Find a line (invoice + LAN) in the statement. */
export function findLine(invoices: readonly Invoice[], invoice: string, lan: string): { inv: Invoice; line: PayoutLine } | null {
  const inv = invoices.find((i) => i.id === invoice);
  const line = inv?.lines.find((l) => l.lan === lan);
  return inv && line ? { inv, line } : null;
}
/** Every line, newest invoice first (voice look-ups by name / LAN). */
export const allLines = (invoices: readonly Invoice[]) => invoices.flatMap((inv) => inv.lines.map((line) => ({ inv, line })));

/** The Home Payouts card (commission only): this period's ready-to-claim, else all caught up; plus the latest open short-pay. */
export function homePayoutCard(invoices: readonly Invoice[], today: Date = TODAY): { hero: string; heroTone: 'warning' | 'success' | 'danger'; caption?: string; short?: ShortPay } {
  const month = statementSummary(invoices, presetRange('thisMonth', today), today);
  const recent = shortPaysIn(invoices.filter((i) => inRange(i.date, presetRange('last3Months', today))));
  const short = recent[0];
  const caption = month.shortCount ? differenceText(month.difference, month.shortCount)
    : short ? `${inr(short.difference)} difference found · ${MONTHS[short.invoiceDate.getMonth()]} statement` : undefined;
  if (month.readyToClaim) return { hero: `${inr(month.readyToClaim)} ready to claim`, heroTone: 'warning', ...(caption ? { caption } : {}), ...(short ? { short } : {}) };
  if (short) return { hero: differenceText(short.difference, 1), heroTone: 'danger', ...(short ? { short } : {}) };
  return { hero: 'All caught up', heroTone: 'success' };
}
