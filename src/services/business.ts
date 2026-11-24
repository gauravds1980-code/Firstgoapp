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

/** Mock OCR: "reads" the reg number from an RC photo. */
export async function ocrRegFromPhoto(_uri: string, lan: string): Promise<{ regNo: string; confidence: number }> {
  await delay(1300);
  return { regNo: regSuggestions(lan)[0]!, confidence: 0.94 };
}

/* ---------------- TA / INF ---------------- */
export interface Limit { key: 'TA' | 'INF'; name: string; sanctioned: number; utilised: number; dues: { label: string; due: Date; amount: number }[]; tenor: string; roi: string }

export function taInfFor(profile: DealerProfile | null): Limit[] {
  const big = profile?.type === 'multiBrand';
  const d = (n: number) => { const x = new Date(TODAY); x.setDate(x.getDate() + n); return x; };
  return [
    { key: 'TA', name: 'Trade Advance', sanctioned: big ? 2500000 : 1000000, utilised: big ? 1380000 : 450000, tenor: '30-day rolling', roi: '10.25% p.a. (example)',
      dues: [{ label: 'TA-2611-07 · 15 vehicles', due: d(3), amount: big ? 420000 : 180000 }, { label: 'TA-2611-12 · 9 vehicles', due: d(11), amount: big ? 360000 : 120000 }] },
    { key: 'INF', name: 'Inventory Funding', sanctioned: big ? 6000000 : 3000000, utilised: big ? 4950000 : 2120000, tenor: '60-day per drawdown', roi: '10.75% p.a. (example)',
      dues: [{ label: 'INF drawdown #3381 · OEM invoice', due: d(6), amount: big ? 980000 : 540000 }, { label: 'INF drawdown #3394 · OEM invoice', due: d(19), amount: big ? 1250000 : 610000 }, { label: 'Interest · Nov', due: d(7), amount: big ? 41200 : 18600 }] },
  ];
}

export async function load<T>(fn: () => T, ms = 500): Promise<T> { await delay(ms); return fn(); }
