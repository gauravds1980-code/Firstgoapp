/**
 * Dealer business data — payouts/invoices, portfolio, cases, RC pendency, TA/INF.
 * EXAMPLE DATA for the prototype (deterministic mock). Real: dealer MIS / LMS / payouts APIs.
 */
import { delay } from './mock';
import type { ProductId } from '../config/products';
import { DealerProfile, enabledCategories } from './dealer';

export const TODAY = new Date(2026, 10, 24); // demo "today" (24 Nov 2026), keeps example data stable

const CUSTOMERS = ['Rahul Sharma', 'Priya Kulkarni', 'Amit Patil', 'Neha Deshmukh', 'Vikram Rao', 'Sneha Joshi', 'Arjun Mehta', 'Kavya Nair', 'Rohan Gupta', 'Pooja Iyer', 'Sanjay Pawar', 'Anita Shah', 'Manoj Verma', 'Ritu Singh', 'Karan Malhotra', 'Divya Menon', 'Suresh Yadav', 'Meera Pillai'];
const MODELS: Record<string, Record<ProductId, string[]>> = {
  'Hero MotoCorp': { twoWheeler: ['Hero Splendor+', 'Hero Xtreme 125R', 'Hero Vida V2'], car: [], cv: [] },
  'Maruti Suzuki': { twoWheeler: [], car: ['Maruti Swift', 'Maruti Baleno', 'Maruti Brezza'], cv: [] },
  'Tata Motors': { twoWheeler: [], car: ['Tata Nexon'], cv: ['Tata Ace Gold', 'Tata Intra V30', 'Tata Yodha 2.0', 'Tata 407 Gold SFC', 'Tata Ultra T.7'] },
  all: { twoWheeler: ['Honda Activa 6G', 'TVS Apache RTR 160', 'Bajaj Pulsar N250', 'Hero Splendor+', 'Ather 450X'], car: ['Tata Nexon', 'Hyundai Creta', 'Maruti Swift'], cv: ['Tata Ace Gold', 'Tata Intra V30', 'Tata Yodha 2.0'] },
};
/** Per-product mock data shape: LAN prefix, example ticket size and example dealer payout rate. */
const CASE_SHAPE: Record<ProductId, { prefix: string; base: number; steps: number; step: number; payoutPct: number }> = {
  twoWheeler: { prefix: 'TW', base: 60000, steps: 90, step: 1000, payoutPct: 1.5 },
  car: { prefix: 'CR', base: 450000, steps: 70, step: 10000, payoutPct: 0.75 },
  cv: { prefix: 'CV', base: 500000, steps: 120, step: 10000, payoutPct: 0.6 },
};

function rnd(i: number, s = 1) { const x = Math.sin(i * 91.7 * s + 13.3) * 10000; return x - Math.floor(x); }
const dayOffset = (d: number) => { const x = new Date(TODAY); x.setDate(x.getDate() - d); return x; };
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Deterministic "24 Nov 2026" (Intl month abbreviations differ between web and Hermes). */
export const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
/** "24 Nov" in the demo's current year, "24 Nov 2025" otherwise (list rows stay on one line). */
export const fmtDateShort = (d: Date) => (d.getFullYear() === TODAY.getFullYear() ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}` : fmtDate(d));
export const fmtDayMonth = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;

export interface Case {
  lan: string; customer: string; vehicle: string; product: ProductId; amount: number; disbursedOn: Date;
  pos: number; dpd: number; status: 'Active' | 'Closed';
}

/** ~70 cases across the last ~100 days, filtered to the dealer's products and OEM. */
export function casesFor(profile: DealerProfile | null): Case[] {
  const enabled = profile ? enabledCategories(profile) : [];
  const cats: ProductId[] = enabled.length ? enabled : ['twoWheeler'];
  const pool = profile && profile.type !== 'multiBrand' && profile.oem ? MODELS[profile.oem] ?? MODELS.all! : MODELS.all!;
  const out: Case[] = [];
  for (let i = 0; i < 72; i++) {
    const product = cats[i % cats.length]!;
    const models = pool[product].length ? pool[product] : MODELS.all![product];
    const shape = CASE_SHAPE[product];
    const amount = shape.base + Math.round(rnd(i, 2) * shape.steps) * shape.step;
    const days = Math.floor(rnd(i, 3) * 100);
    const paid = Math.min(0.9, days / 900 + rnd(i, 4) * 0.05);
    const dpdRoll = rnd(i, 5);
    const dpd = days < 35 ? 0 : dpdRoll > 0.93 ? 75 + Math.floor(rnd(i, 6) * 40) : dpdRoll > 0.86 ? 35 + Math.floor(rnd(i, 6) * 25) : dpdRoll > 0.75 ? 3 + Math.floor(rnd(i, 6) * 26) : 0;
    out.push({
      lan: `${shape.prefix}-${(184000 + i * 7).toString()}`, customer: CUSTOMERS[i % CUSTOMERS.length]!,
      vehicle: models[i % models.length]!, product, amount, disbursedOn: dayOffset(days), pos: Math.round(amount * (1 - paid)), dpd, status: 'Active',
    });
  }
  return out.sort((a, b) => b.disbursedOn.getTime() - a.disbursedOn.getTime());
}

export type Bucket = 'Current' | '1–30' | '31–60' | '61–90' | '90+';
export const BUCKETS: Bucket[] = ['Current', '1–30', '31–60', '61–90', '90+'];
export const bucketOf = (dpd: number): Bucket => (dpd === 0 ? 'Current' : dpd <= 30 ? '1–30' : dpd <= 60 ? '31–60' : dpd <= 90 ? '61–90' : '90+');

/* ---------------- Payouts / invoices ---------------- */
export type InvoiceStatus = 'Not claimed' | 'Claimed' | 'Paid';
export interface PayoutLine { lan: string; customer: string; loan: number; ratePct: number; payout: number }
export interface Invoice { id: string; date: Date; status: InvoiceStatus; lines: PayoutLine[]; amount: number; utr?: string }

/** Weekly payout invoices built from the cases (dealer payout ~0.75–1.5% of loan, example rates). */
export function invoicesFor(cases: Case[]): Invoice[] {
  const byWeek = new Map<string, Case[]>();
  for (const c of cases) {
    const d = new Date(c.disbursedOn); d.setDate(d.getDate() - d.getDay()); // week start (Sun)
    const k = d.toISOString().slice(0, 10);
    byWeek.set(k, [...(byWeek.get(k) ?? []), c]);
  }
  let n = 0;
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, cs]) => {
    const date = new Date(k); date.setDate(date.getDate() + 6);
    const lines = cs.map((c) => { const ratePct = CASE_SHAPE[c.product].payoutPct; return { lan: c.lan, customer: c.customer, loan: c.amount, ratePct, payout: Math.round((c.amount * ratePct) / 100) }; });
    const age = (TODAY.getTime() - date.getTime()) / 864e5;
    const status: InvoiceStatus = age > 30 ? 'Paid' : age > 12 ? 'Claimed' : 'Not claimed';
    n++;
    return { id: `INV/26-27/${String(1200 - n).padStart(4, '0')}`, date: date > TODAY ? TODAY : date, status, lines, amount: lines.reduce((s, l) => s + l.payout, 0), utr: status === 'Paid' ? `IDFBR8172${String(62893700 + n * 37)}` : undefined };
  });
}

export async function claimInvoice(id: string): Promise<{ ok: true; ref: string }> {
  await delay(900);
  return { ok: true, ref: `CLM-${id.slice(-4)}-${Math.floor(Math.random() * 9000 + 1000)}` };
}

/** The three calendar months of the Payouts "MONTHLY PAYOUT" chart (two back + this month to date). */
export function payoutMonths(invoices: Invoice[]): { label: string; start: Date; end: Date; amt: number }[] {
  return [2, 1, 0].map((k) => {
    const start = new Date(TODAY.getFullYear(), TODAY.getMonth() - k, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
    const amt = invoices.filter((i) => i.date.getMonth() === start.getMonth() && i.date.getFullYear() === start.getFullYear()).reduce((t, i) => t + i.amount, 0);
    return { label: MONTHS[start.getMonth()]!, start, end, amt };
  });
}

/* ---------------- Advance payout (example terms) ----------------
 * Limit = 3 × average monthly payout over the chart's last 3 months; available = limit − outstanding.
 * Recovered by netting off future payouts. Fee is an ILLUSTRATIVE example, not IDFC pricing. */
export const ADVANCE_MIN = 30000;
export const ADVANCE_STEP = 1000;
export const ADVANCE_FEE_PCT = 1;
export const advanceFee = (amount: number) => Math.round((amount * ADVANCE_FEE_PCT) / 100);

export function advanceLimit(invoices: Invoice[]) {
  const months = payoutMonths(invoices);
  const avg = Math.floor(months.reduce((t, m) => t + m.amt, 0) / 3);
  return { months, avg, limit: avg * 3 };
}

/** Limit, outstanding (sum of open advances) and available = limit − outstanding (never negative). */
export function advancePosition(invoices: Invoice[], outstandings: number[]) {
  const { months, avg, limit } = advanceLimit(invoices);
  const outstanding = outstandings.reduce((t, o) => t + o, 0);
  return { months, avg, limit, outstanding, available: Math.max(0, limit - outstanding) };
}

/**
 * What the Advance payout card offers: enabled only from ADVANCE_MIN; slider / field from ADVANCE_MIN
 * to `available`; the 50% chip (snapped down to the step) only when it is at least ADVANCE_MIN.
 */
export function advanceRange(available: number): { enabled: boolean; min: number; max: number; half: number | null } {
  const half = Math.floor(available / 2 / ADVANCE_STEP) * ADVANCE_STEP;
  return { enabled: available >= ADVANCE_MIN, min: ADVANCE_MIN, max: available, half: half >= ADVANCE_MIN ? half : null };
}

/** Projected recovery: future monthly payouts (at the 3-month average) netted until `outstanding` is cleared. */
export function recoverySchedule(outstanding: number, avg: number, maxMonths = 6): { label: string; netted: number; left: number }[] {
  const out: { label: string; netted: number; left: number }[] = [];
  let left = outstanding;
  for (let k = 1; left > 0 && avg > 0 && k <= maxMonths; k++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + k, 1);
    const netted = Math.min(avg, left); left -= netted;
    out.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, netted, left });
  }
  return out;
}

/** Mock advance transfer (IMPS to the settlement account). `seq` keeps successive UTRs distinct. */
export async function transferAdvance(amount: number, seq: number): Promise<{ ok: true; utr: string }> {
  await delay(1100);
  return { ok: true, utr: `IDFBA2611${String(40000000 + Math.round(amount / 1000) * 37 + seq * 911 + (Date.now() % 997))}` };
}

/* ---------------- RC pendency ---------------- */
export type RcStatus = 'Pending' | 'Submitted';
export interface RcCase { lan: string; customer: string; vehicle: string; disbursedOn: Date; daysPending: number; status: RcStatus; regNo?: string; photo?: string; submittedOn?: Date }

/** Indian registration format, e.g. MH12AB1234, DL3CAB1234, KA01M1234; also BH series 22BH1234AA. */
export const REG_REGEX = /^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
export const normaliseReg = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const prettyReg = (s: string) => {
  const r = normaliseReg(s); const m = r.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : r;
};

export function rcCasesFor(cases: Case[]): RcCase[] {
  const pool = cases.filter((c) => { const d = (TODAY.getTime() - c.disbursedOn.getTime()) / 864e5; return d >= 2 && d <= 75; });
  const step = Math.max(1, Math.floor(pool.length / 12)); // spread across ages: on time, due soon, overdue
  return pool.filter((_, i) => i % step === 0).slice(0, 12).map((c) => ({ lan: c.lan, customer: c.customer, vehicle: c.vehicle, disbursedOn: c.disbursedOn, daysPending: Math.round((TODAY.getTime() - c.disbursedOn.getTime()) / 864e5), status: 'Pending' as const }));
}

/** Registration numbers the RTO/Vahan has issued against this dealer recently (mock "select" list). */
export function regSuggestions(lan: string): string[] {
  const i = parseInt(lan.replace(/\D/g, ''), 10) || 1;
  const s = ['AB', 'CD', 'EF', 'GH', 'KL', 'MN'];
  return [0, 1, 2].map((k) => `MH${String(1 + ((i + k) % 48)).padStart(2, '0')}${s[(i + k) % s.length]}${String(1000 + ((i * 37 + k * 911) % 9000))}`);
}

/**
 * Registration number printed on the sample RC used for testing (/workspace/boom-rn-tools/mock-rc.png,
 * "Regn. No. MH 02 EK 4821").
 */
export const SAMPLE_RC_REG = 'MH02EK4821';
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * Stand-in OCR until the RC OCR API is wired: it must return the number ON THE PHOTO, never a number
 * made up from the case. If the picked file's name carries a valid registration number
 * (e.g. "MH02EK4821.jpg", "rc_MH-02-EK-4821.png") that is used; otherwise the photo is taken to be the
 * sample RC and its printed number is returned. The dealer still checks the prefilled field.
 */
export async function ocrRegFromPhoto(uri: string, fileName?: string | null): Promise<{ regNo: string; confidence: number }> {
  await delay(1300);
  // Standalone token only (start / separator on both sides) with a letter series, so camera names like
  // "IMG_20261124_1234" never pass for a registration number.
  const fromName = [fileName ?? '', safeDecode(uri.split('/').pop() ?? '')]
    .map((n) => n.toUpperCase().replace(/\.[A-Z0-9]+$/, '').match(/(?:^|[^A-Z0-9])([A-Z]{2}[\s_-]?\d{1,2}[\s_-]?[A-Z]{1,3}[\s_-]?\d{4})(?![A-Z0-9])/)?.[1])
    .map((n) => (n ? normaliseReg(n) : undefined))
    .find((n): n is string => !!n && REG_REGEX.test(n));
  return { regNo: fromName ?? SAMPLE_RC_REG, confidence: 0.94 };
}

/* ---------------- TA / INF ---------------- */
/**
 * A dealer has ONE facility: Trade Advance (dealer draws it down) or Inventory Funding (the OEM draws
 * it on invoice). Each drawdown is a tranche, repaid in full (no part-payments inside a tranche).
 */
export type FacilityType = 'TA' | 'INF';
export type TrancheStatus = 'overdue' | 'dueSoon' | 'upcoming' | 'paid';
export interface Tranche { id: string; label: string; due: Date; amount: number; status: TrancheStatus; paidOn?: Date }
export interface Limit {
  key: FacilityType; name: string; sanctioned: number; utilised: number; tranches: Tranche[];
  tenor: string; tenorDays: number; roi: string; roiPct: number; drawnBy: 'dealer' | 'oem';
  /** Pending "Enhance my limit" request. The sanctioned limit does not change until the bank approves. */
  enhancement?: LimitRequest;
}
export type EnhanceReason = 'inventory' | 'festive' | 'newOem' | 'other';
export const ENHANCE_REASONS: { key: EnhanceReason; label: string }[] = [
  { key: 'inventory', label: 'More inventory' }, { key: 'festive', label: 'Seasonal or festive demand' }, { key: 'newOem', label: 'New OEM' }, { key: 'other', label: 'Other' },
];
export interface LimitRequest { ref: string; current: number; requested: number; reason: EnhanceReason; note?: string; docs: number; submittedOn: string; status: 'pending' }
/** Interest form for a dealer with no facility. One application at a time (a dealer holds TA or INF, never both). */
export interface WcApplication { ref: string; facility: FacilityType; name: string; requested: number; turnover?: number; submittedOn: string; status: 'submitted' }
/** Illustrative caps for the mock forms (not bank policy). */
export const ENHANCE_STEP = 50000;
export const enhanceCap = (sanctioned: number) => sanctioned * 2;
export const APPLY_MIN = 100000;
export const APPLY_MAX = 50000000;

export const MIN_DRAWDOWN = 50000;
export const DRAWDOWN_STEP = 10000;
const DAY = 864e5;
export const dueAfter = (n: number) => { const x = new Date(TODAY); x.setDate(x.getDate() + n); return x; };
export const daysFromToday = (d: Date) => Math.round((d.getTime() - TODAY.getTime()) / DAY);
export const availableOf = (l: Limit) => Math.max(0, l.sanctioned - l.utilised);
/** Unpaid → overdue (past due), due soon (within 7 days) or upcoming. */
export function trancheStatus(t: Pick<Tranche, 'due' | 'status'>): TrancheStatus {
  if (t.status === 'paid') return 'paid';
  const days = daysFromToday(t.due);
  return days < 0 ? 'overdue' : days <= 7 ? 'dueSoon' : 'upcoming';
}
/** Unpaid tranches that are overdue or due within 30 days ("Select all due" and "Total due next 30 days"). */
export const dueIn30 = (l: Limit) => l.tranches.filter((t) => t.status !== 'paid' && daysFromToday(t.due) <= 30);
export const sumOf = (ts: Tranche[]) => ts.reduce((a, t) => a + t.amount, 0);

/** The dealer's single facility (example data), or null when they have none. */
export function taInfFor(profile: DealerProfile | null): Limit | null {
  const type = profile?.facilityType ?? null;
  if (!type) return null;
  const tr = (id: string, label: string, days: number, amount: number, paid = false): Tranche => {
    const t: Tranche = { id, label, due: dueAfter(days), amount, status: paid ? 'paid' : 'upcoming', paidOn: paid ? dueAfter(days - 2) : undefined };
    return { ...t, status: trancheStatus(t) };
  };
  if (type === 'TA') {
    const big = profile?.type === 'multiBrand';
    // Unpaid tranches add up to `utilised`.
    const tranches = big
      ? [tr('TA-2610-21', 'TA-2610-21 · 6 vehicles', -9, 120000, true), tr('TA-2610-28', 'TA-2610-28 · 8 vehicles', -2, 210000), tr('TA-2611-07', 'TA-2611-07 · 15 vehicles', 3, 420000),
        tr('TA-2611-12', 'TA-2611-12 · 9 vehicles', 11, 360000), tr('TA-2611-19', 'TA-2611-19 · 10 vehicles', 24, 390000)]
      : [tr('TA-2610-21', 'TA-2610-21 · 4 vehicles', -9, 60000, true), tr('TA-2610-28', 'TA-2610-28 · 5 vehicles', -2, 80000), tr('TA-2611-07', 'TA-2611-07 · 15 vehicles', 3, 180000),
        tr('TA-2611-12', 'TA-2611-12 · 9 vehicles', 11, 120000), tr('TA-2611-19', 'TA-2611-19 · 5 vehicles', 24, 70000)];
    return { key: 'TA', name: 'Trade Advance', sanctioned: big ? 2500000 : 1000000, utilised: big ? 1380000 : 450000, tenor: '30-day rolling', tenorDays: 30,
      roi: '10.25% p.a.', roiPct: 10.25, drawnBy: 'dealer', tranches };
  }
  return { key: 'INF', name: 'Inventory Funding', sanctioned: 3000000, utilised: 2120000, tenor: '60-day per drawdown', tenorDays: 60, roi: '10.75% p.a.', roiPct: 10.75, drawnBy: 'oem',
    tranches: [tr('INF-3365', 'INF drawdown #3365 · OEM invoice', -12, 450000, true), tr('INF-3372', 'INF drawdown #3372 · OEM invoice', -3, 320000),
      tr('INF-3381', 'INF drawdown #3381 · OEM invoice', 6, 540000), tr('INF-3394', 'INF drawdown #3394 · OEM invoice', 19, 610000), tr('INF-3402', 'INF drawdown #3402 · OEM invoice', 41, 650000)] };
}

/** Only Trade Advance is drawn down by the dealer; Inventory Funding is drawn by the OEM (repay only). */
export const canDisburse = (l: Pick<Limit, 'key' | 'drawnBy'>) => l.key === 'TA' && l.drawnBy === 'dealer';

/** Interest for one drawdown over the facility tenor (simple interest, rounded to the rupee). */
export const drawdownInterest = (l: Limit, amount: number) => Math.round((amount * l.roiPct * l.tenorDays) / (100 * 365));
const mockUtr = () => `IDFBR8172${String(Math.floor(1e10 + Math.random() * 9e10))}`;

/** TA drawdown: new unpaid tranche due after the tenor; utilised goes up by the amount. */
export function applyDisburse(l: Limit, amount: number): { limit: Limit; tranche: Tranche } {
  const n = l.tranches.filter((t) => t.id.startsWith('TA-2611-')).length + 20;
  const id = `TA-2611-${String(n).padStart(2, '0')}`;
  const tranche: Tranche = { id, label: `${id} · Dealer drawdown`, due: dueAfter(l.tenorDays), amount, status: 'upcoming' };
  tranche.status = trancheStatus(tranche);
  return { limit: { ...l, utilised: l.utilised + amount, tranches: [...l.tranches, tranche] }, tranche };
}
/** Full repayment of the selected tranches; the repaid total is freed up for new drawdowns. */
export function applyRepay(l: Limit, ids: string[]): { limit: Limit; total: number } {
  const pick = new Set(ids);
  const paid = l.tranches.filter((t) => pick.has(t.id) && t.status !== 'paid');
  const total = sumOf(paid);
  return { total, limit: { ...l, utilised: Math.max(0, l.utilised - total), tranches: l.tranches.map((t) => (pick.has(t.id) && t.status !== 'paid' ? { ...t, status: 'paid' as const, paidOn: new Date(TODAY) } : t)) } };
}
/** Mock bank calls (real: LMS drawdown / repayment APIs). */
export async function requestDrawdown(_amount: number): Promise<{ utr: string }> { await delay(900); return { utr: mockUtr() }; }
const mockRef = (prefix: string) => `${prefix}-2611-${String(Math.floor(10000 + Math.random() * 90000))}`;
export async function requestEnhancement(r: Omit<LimitRequest, 'ref' | 'submittedOn' | 'status'>): Promise<LimitRequest> {
  await delay(900); return { ...r, ref: mockRef('ENH'), submittedOn: fmtDate(TODAY), status: 'pending' };
}
export async function applyForFacility(a: Omit<WcApplication, 'ref' | 'submittedOn' | 'status'>): Promise<WcApplication> {
  await delay(900); return { ...a, ref: mockRef(a.facility === 'TA' ? 'WCTA' : 'WCINF'), submittedOn: fmtDate(TODAY), status: 'submitted' };
}
export async function payTranches(_ids: string[], _method: 'upi' | 'netbanking'): Promise<{ utr: string }> { await delay(900); return { utr: mockUtr() }; }

export async function load<T>(fn: () => T, ms = 500): Promise<T> { await delay(ms); return fn(); }
