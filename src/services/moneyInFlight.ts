/**
 * v1.4.6 Feature 1 — Money in flight (approved 28 Nov 2026). Every sanctioned file from sanction until the loan
 * amount lands in the dealer's settlement account, with the stage and the named blocker.
 *
 * EXAMPLE DATA (deterministic mock, demo "today" = 24 Nov 2026, same as business.ts). Pure module: no React Native
 * imports, unit-tested in Node (services/__tests__/moneyInFlight.test.ts). Real: LOS stage events + LMS disbursement
 * posting + payment credit / UTR feed behind a dealer-scoped BFF (spec §g).
 *
 * Scope (Gaurav, 28 Nov 2026): Money in flight applies ONLY to dealers of new cars, used cars, new CV, used CV and used
 * two-wheelers — NOT to new two-wheeler dealers. `isMoneyInFlightEnabled` is the single gate (Home card, route, voice,
 * alerts). Where gated, Home keeps the old loan-credit Payouts block.
 */
import type { ProductId } from '../config/products';
import { ageingBand, AgeingBand, MifStage, MIF_STAGES, STAGE_LABEL, type BlockerOwner } from '../theme/libraryTones';
import { TODAY } from './business';
import type { DealerProfile } from './dealer';
import { inr } from '../utils/finance';
import { queryTicketId } from './queries';

/* ---------------- Dealer segments + the one gate ---------------- */

export type DealerSegment = 'NEW_TW' | 'USED_TW' | 'NEW_CAR' | 'USED_CAR' | 'NEW_CV' | 'USED_CV';
export const MIF_SEGMENTS: readonly DealerSegment[] = ['USED_TW', 'NEW_CAR', 'USED_CAR', 'NEW_CV', 'USED_CV'];

/** Segments from the onboarded product lines, for sessions saved before v1.4.6 (no `segments` on the profile). */
const PRODUCT_SEGMENT: Record<string, DealerSegment> = { newTw: 'NEW_TW', usedTw: 'USED_TW', newCar: 'NEW_CAR', usedCar: 'USED_CAR', newCv: 'NEW_CV', usedCv: 'USED_CV' };
export function segmentsOf(p: Pick<DealerProfile, 'products'> & { segments?: DealerSegment[] } | null | undefined): DealerSegment[] {
  if (!p) return [];
  if (p.segments?.length) return p.segments;
  return p.products.map((k) => PRODUCT_SEGMENT[k]).filter((s): s is DealerSegment => !!s);
}

/** THE gate: the dealer has any segment other than NEW_TW. New-TW-only dealers (and no dealer) → false. */
export function isMoneyInFlightEnabled(p: Pick<DealerProfile, 'products'> & { segments?: DealerSegment[] } | null | undefined): boolean {
  return segmentsOf(p).some((s) => s !== 'NEW_TW');
}

export const MIF_NOT_AVAILABLE = 'Money in flight is not available for new two-wheeler dealers yet.';

/* ---------------- Blockers (closed list, never free text) ---------------- */

export type BlockerCode =
  | 'RC_COPY' | 'RC_REVIEW' | 'PDD_HOLD' | 'BANK_MISMATCH' | 'INVOICE' | 'INSURANCE' | 'ESIGN' | 'MANDATE'
  | 'VEHICLE_MISMATCH' | 'PAYMENT_HOLD' | 'NOC' | 'CUSTOMER_ACTION';

/** Dealer action on the case sheet (one primary CTA). */
export type DealerAction = 'uploadRc' | 'remindCustomer' | 'viewAccount' | 'openDocs';

export const BLOCKERS: Record<BlockerCode, { label: string; owner: BlockerOwner; action?: DealerAction; actionLabel?: string; help: string }> = {
  RC_COPY: { label: 'RC copy pending', owner: 'dealer', action: 'uploadRc', actionLabel: 'Upload RC copy', help: 'Upload the RC copy so disbursal can resume.' },
  RC_REVIEW: { label: 'RC copy under review', owner: 'bank', help: 'The RC copy is with the bank for checks. Disbursal resumes once it is verified.' },
  PDD_HOLD: { label: 'PDD hold', owner: 'bank', help: 'Post-disbursal documents are under review with the bank.' },
  BANK_MISMATCH: { label: 'Bank a/c mismatch', owner: 'bank', action: 'viewAccount', actionLabel: 'View settlement account', help: 'The settlement account does not match the bank record. Changing the account stays with your RM.' },
  INVOICE: { label: 'Invoice pending', owner: 'dealer', help: 'The bank needs the vehicle invoice. Raise a query if you have already shared it.' },
  INSURANCE: { label: 'Insurance pending', owner: 'dealer', help: 'The bank needs the insurance copy. Raise a query if you have already shared it.' },
  ESIGN: { label: 'e-Sign pending', owner: 'customer', action: 'remindCustomer', actionLabel: 'Remind customer', help: 'The customer has not e-signed the agreement yet.' },
  MANDATE: { label: 'Mandate pending', owner: 'customer', action: 'remindCustomer', actionLabel: 'Remind customer', help: 'The customer has not approved the AutoPay mandate yet.' },
  VEHICLE_MISMATCH: { label: 'Vehicle details mismatch', owner: 'bank', help: 'Vehicle details differ between the invoice and the application. The bank is checking.' },
  PAYMENT_HOLD: { label: 'Payment hold', owner: 'bank', help: 'The payment is on hold with the bank.' },
  NOC: { label: 'NOC pending', owner: 'dealer', help: 'The previous lender’s NOC is pending.' },
  CUSTOMER_ACTION: { label: 'Customer action pending', owner: 'customer', help: 'The customer has a step to complete with the bank.' },
};

/* ---------------- Files ---------------- */

export interface StageEvent { stage: MifStage; at: Date }
export interface MifFile {
  lan: string;
  customer: string;
  /** 10-digit customer mobile, for search only. Shown masked (last 4). */
  mobile: string;
  product: ProductId;
  condition: 'new' | 'used';
  vehicle: string;
  /** Sanctioned (loan) amount: what the list and Home show. */
  sanctioned: number;
  /** Expected net in the dealer's account (loan minus customer charges). */
  expectedNet: number;
  stage: MifStage;
  blocker?: BlockerCode;
  /** Stages reached so far, oldest first; the last one is the current stage. */
  history: StageEvent[];
  credited?: { amount: number; utr: string; at: Date };
  updatedAt: Date;
}

export const SETTLEMENT_MASK = '••4321';
export const QUERY_REASONS = [
  { id: 'notReceived', label: 'Amount not received' },
  { id: 'shortCredit', label: 'Short credit' },
  { id: 'stuck', label: 'Stuck at stage' },
  { id: 'wrongAccount', label: 'Wrong account' },
  { id: 'other', label: 'Other' },
] as const;
export type QueryReasonId = (typeof QUERY_REASONS)[number]['id'];

const DAY = 864e5;
/** Calendar date of `today` minus `days`, at hh:mm. */
const at = (days: number, hh: number, mm: number, today: Date = TODAY) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days, hh, mm);
  return d;
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from `from` to `to` (0 = same day). */
export const calendarDays = (from: Date, to: Date): number => Math.max(0, Math.round((startOfDay(to) - startOfDay(from)) / DAY));

type Seed = {
  customer: string; mobile: string; lan: string; product: ProductId; condition?: 'new' | 'used'; vehicle: string; sanctioned: number;
  stage: MifStage; blocker?: BlockerCode;
  /** Days in the current stage (uncredited) — the ageing input. */
  days?: number;
  /** Credited: days ago (0 = today), time, net credited, UTR, and optionally a different expected net (short credit). */
  credit?: { daysAgo: number; time: [number, number]; amount: number; utr: string; expectedNet?: number };
  /** Net the dealer should get (defaults to ~2.5 % below the loan, rounded to ₹100). */
  net?: number;
};

const defaultNet = (loan: number) => Math.round((loan * 0.975) / 100) * 100;

/** Build a file from a seed: a deterministic stage history ending in the current stage. */
function build(s: Seed): MifFile {
  const idx = MIF_STAGES.indexOf(s.stage);
  const history: StageEvent[] = [];
  if (s.credit) {
    const c = at(s.credit.daysAgo, s.credit.time[0], s.credit.time[1]);
    const back = (h: number) => new Date(c.getTime() - h * 36e5);
    history.push({ stage: 'sanctioned', at: back(30) }, { stage: 'docsPending', at: back(26) }, { stage: 'disbursalInitiated', at: back(3) }, { stage: 'credited', at: c });
  } else {
    const days = s.days ?? 0;
    // Entered between 9:00 and 10:59 (before the demo clock's 11:26, so a day-0 file is never in the future).
    const entered = at(days, 9 + (Math.floor(s.sanctioned / 1000) % 2), Math.floor(s.sanctioned / 1000) % 60);
    // Earlier stages a few hours apart on the way in.
    for (let i = 0; i < idx; i++) history.push({ stage: MIF_STAGES[i]!, at: new Date(entered.getTime() - (idx - i) * 2.5 * 36e5) });
    history.push({ stage: s.stage, at: entered });
  }
  const last = history[history.length - 1]!.at;
  return {
    lan: s.lan, customer: s.customer, mobile: s.mobile, product: s.product, condition: s.condition ?? 'new', vehicle: s.vehicle,
    sanctioned: s.sanctioned,
    expectedNet: s.credit ? s.credit.expectedNet ?? s.credit.amount : s.net ?? defaultNet(s.sanctioned),
    stage: s.stage, ...(s.blocker ? { blocker: s.blocker } : {}), history,
    ...(s.credit ? { credited: { amount: s.credit.amount, utr: s.credit.utr, at: at(s.credit.daysAgo, s.credit.time[0], s.credit.time[1]) } } : {}),
    updatedAt: last,
  };
}

/**
 * Mock files per demo login (dealer mobile ending). Only the dealer's segments; the default Hero new-TW dealer and
 * 0000 / 9999 have none (feature hidden).
 *  1111 Shree Auto Mall (multi-brand TW + car, TA): used TW + new / used car only — ₹22.9L in flight, 5 files, 2 overdue.
 *  2222 Sai Motors (Maruti sub-dealer, new + used car): ₹18.2L, 3 files, 1 overdue; a 2-day-old short credit.
 *  3333 Tata CV Hub (new + used CV, INF): ₹46.85L, 5 files, 2 overdue.
 */
const SEEDS: Record<'1111' | '2222' | '3333', Seed[]> = {
  '1111': [
    { customer: 'Pooja Iyer', mobile: '9822011111', lan: 'TW-184408', product: 'twoWheeler', condition: 'used', vehicle: 'Bajaj Pulsar N250 (2024, used)', sanctioned: 98000, stage: 'docsPending', blocker: 'RC_COPY', days: 6, net: 95600 },
    { customer: 'Amit Patil', mobile: '9822011112', lan: 'CR-20417', product: 'car', vehicle: 'Tata Nexon', sanctioned: 726000, stage: 'docsPending', blocker: 'PDD_HOLD', days: 4 },
    { customer: 'Rohan Gupta', mobile: '9822011113', lan: 'CR-20422', product: 'car', condition: 'used', vehicle: 'Hyundai Creta (2022, used)', sanctioned: 546000, stage: 'disbursalInitiated', blocker: 'BANK_MISMATCH', days: 3 },
    { customer: 'Anita Shah', mobile: '9822011114', lan: 'CR-20419', product: 'car', vehicle: 'Maruti Swift', sanctioned: 510000, stage: 'sanctioned', blocker: 'MANDATE', days: 1 },
    { customer: 'Ramesh Jadhav', mobile: '9822011119', lan: 'CR-20424', product: 'car', condition: 'used', vehicle: 'Maruti Swift (2021, used)', sanctioned: 410000, stage: 'sanctioned', blocker: 'ESIGN', days: 0 },
    { customer: 'Rahul Sharma', mobile: '9822011116', lan: 'TW-184392', product: 'twoWheeler', condition: 'used', vehicle: 'Royal Enfield Classic 350 (2023, used)', sanctioned: 138000, stage: 'credited', credit: { daysAgo: 0, time: [9, 43], amount: 135000, utr: 'IDFBR817262893749220' } },
    { customer: 'Neha Deshmukh', mobile: '9822011117', lan: 'CR-20409', product: 'car', vehicle: 'Tata Nexon', sanctioned: 676000, stage: 'credited', credit: { daysAgo: 0, time: [8, 40], amount: 662000, utr: 'IDFBR817262893736015' } },
    { customer: 'Vikram Rao', mobile: '9822011118', lan: 'TW-184388', product: 'twoWheeler', condition: 'used', vehicle: 'TVS Apache RTR 160 (2023, used)', sanctioned: 68000, stage: 'credited', credit: { daysAgo: 0, time: [8, 52], amount: 66500, utr: 'IDFBR817262893741108' } },
    // Credited 4 days ago: past the 3-day window, so it is only in Cases done now.
    { customer: 'Sneha Joshi', mobile: '9822011120', lan: 'CR-20401', product: 'car', vehicle: 'Maruti Swift', sanctioned: 520000, stage: 'credited', credit: { daysAgo: 4, time: [15, 5], amount: 508000, utr: 'IDFBR817262893701442' } },
  ],
  '2222': [
    { customer: 'Arjun Mehta', mobile: '9822012221', lan: 'CR-20430', product: 'car', vehicle: 'Maruti Brezza', sanctioned: 780000, stage: 'docsPending', blocker: 'PDD_HOLD', days: 5 },
    { customer: 'Kavya Nair', mobile: '9822012222', lan: 'CR-20428', product: 'car', vehicle: 'Maruti Baleno', sanctioned: 620000, stage: 'disbursalInitiated', blocker: 'BANK_MISMATCH', days: 2 },
    { customer: 'Suresh Yadav', mobile: '9822012223', lan: 'CR-20425', product: 'car', condition: 'used', vehicle: 'Maruti Swift (2021, used)', sanctioned: 420000, stage: 'docsPending', blocker: 'RC_COPY', days: 3 },
    { customer: 'Meera Pillai', mobile: '9822012224', lan: 'CR-20418', product: 'car', vehicle: 'Maruti Swift', sanctioned: 585000, stage: 'credited', credit: { daysAgo: 0, time: [10, 12], amount: 572000, utr: 'IDFBR817262893760018' } },
    // Credited 2 days ago, ₹2,000 short of the expected net: flagged on the sheet, Raise a query is primary.
    { customer: 'Divya Menon', mobile: '9822012225', lan: 'CR-20412', product: 'car', condition: 'used', vehicle: 'Maruti Baleno (2020, used)', sanctioned: 360000, stage: 'credited', credit: { daysAgo: 2, time: [16, 20], amount: 349000, utr: 'IDFBR817262893718830', expectedNet: 351000 } },
  ],
  '3333': [
    { customer: 'Ritu Singh', mobile: '9822013331', lan: 'CV-30222', product: 'cv', vehicle: 'Tata Yodha 2.0', sanctioned: 890000, stage: 'docsPending', blocker: 'INSURANCE', days: 7 },
    { customer: 'Sanjay Pawar', mobile: '9822013332', lan: 'CV-30226', product: 'cv', vehicle: 'Tata 407 Gold SFC', sanctioned: 1255000, stage: 'docsPending', blocker: 'INVOICE', days: 3 },
    { customer: 'Karan Malhotra', mobile: '9822013333', lan: 'CV-30224', product: 'cv', vehicle: 'Tata Ultra T.7', sanctioned: 1480000, stage: 'disbursalInitiated', blocker: 'VEHICLE_MISMATCH', days: 2 },
    { customer: 'Divya Menon', mobile: '9822013334', lan: 'CV-30220', product: 'cv', vehicle: 'Tata Intra V30', sanctioned: 720000, stage: 'sanctioned', blocker: 'ESIGN', days: 1 },
    { customer: 'Suresh Yadav', mobile: '9822013337', lan: 'CV-30215', product: 'cv', condition: 'used', vehicle: 'Tata Ace Gold (2022, used)', sanctioned: 340000, stage: 'docsPending', blocker: 'RC_COPY', days: 5 },
    { customer: 'Manoj Verma', mobile: '9822013335', lan: 'CV-30218', product: 'cv', vehicle: 'Tata Ace Gold', sanctioned: 527000, stage: 'credited', credit: { daysAgo: 0, time: [9, 58], amount: 512000, utr: 'IDFBR817262893752611' } },
    { customer: 'Anita Shah', mobile: '9822013336', lan: 'CV-30211', product: 'cv', vehicle: 'Tata Ace Gold', sanctioned: 763000, stage: 'credited', credit: { daysAgo: 1, time: [17, 5], amount: 748000, utr: 'IDFBR817262893744406' } },
  ],
};

/** Demo login key from the dealer's login mobile ('1111' | '2222' | '3333'), else null (no files). */
export function mifKeyFor(mobile: string | null | undefined): '1111' | '2222' | '3333' | null {
  const m = mobile ?? '';
  return m.endsWith('1111') ? '1111' : m.endsWith('2222') ? '2222' : m.endsWith('3333') ? '3333' : null;
}

/**
 * Every mock file for this dealer (including credits older than the 3-day window — `visibleFiles` drops those).
 * Gated dealers get none: the feature never shows them a file, even by deep link or voice.
 */
export function mifFilesFor(mobile: string | null | undefined, profile: DealerProfile | null | undefined): MifFile[] {
  if (!isMoneyInFlightEnabled(profile)) return [];
  const key = mifKeyFor(mobile);
  return key ? SEEDS[key].map(build) : [];
}

/* ---------------- Ageing, retention, totals ---------------- */

/** Clock "now" for the demo: TODAY at 11:26 (the mockup's time). */
export const MIF_NOW = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 11, 26);

/** When the file entered its current stage. */
export const stageEnteredAt = (f: MifFile): Date => f.history[f.history.length - 1]!.at;
/** Calendar days in the current stage (uncredited only; credited → 0). */
export const daysInStage = (f: MifFile, now: Date = MIF_NOW): number => (f.stage === 'credited' ? 0 : calendarDays(stageEnteredAt(f), now));
/** Ageing band of an uncredited file; null for credited (no AgeingPill). */
export const ageingOf = (f: MifFile, now: Date = MIF_NOW): AgeingBand | null => (f.stage === 'credited' ? null : ageingBand(daysInStage(f, now)));
export const isOverdue = (f: MifFile, now: Date = MIF_NOW): boolean => ageingOf(f, now) === 'overdue';
export const isInFlight = (f: MifFile): boolean => f.stage !== 'credited';

/** Credited files stay on this screen for 3 days (credit day = day 1), then live only in Cases done. */
export const CREDIT_RETENTION_DAYS = 3;
export function creditRetained(f: MifFile, now: Date = MIF_NOW): boolean {
  if (f.stage !== 'credited' || !f.credited) return false;
  return calendarDays(f.credited.at, now) < CREDIT_RETENTION_DAYS;
}
export const creditedToday = (f: MifFile, now: Date = MIF_NOW): boolean => !!f.credited && calendarDays(f.credited.at, now) === 0;

/** What the list can show: every in-flight file + credits from the last 3 days. */
export const visibleFiles = (files: readonly MifFile[], now: Date = MIF_NOW): MifFile[] => files.filter((f) => isInFlight(f) || creditRetained(f, now));

export interface MifTotals {
  inFlightAmount: number; inFlightCount: number; overdueCount: number; stuckCount: number;
  creditedTodayAmount: number; creditedTodayCount: number; creditedRecentCount: number;
}
/** Home card + list stat figures (one source, so the two surfaces never disagree). */
export function mifTotals(files: readonly MifFile[], now: Date = MIF_NOW): MifTotals {
  const fl = files.filter(isInFlight);
  const today = files.filter((f) => creditedToday(f, now));
  return {
    inFlightAmount: fl.reduce((t, f) => t + f.sanctioned, 0),
    inFlightCount: fl.length,
    overdueCount: fl.filter((f) => isOverdue(f, now)).length,
    // Stuck = overdue, or held by a blocker that is not just the customer's next step.
    stuckCount: fl.filter((f) => isStuck(f, now)).length,
    creditedTodayAmount: today.reduce((t, f) => t + (f.credited?.amount ?? 0), 0),
    creditedTodayCount: today.length,
    creditedRecentCount: files.filter((f) => creditRetained(f, now)).length,
  };
}
/** "Stuck": overdue, or ageing with a named blocker. */
export const isStuck = (f: MifFile, now: Date = MIF_NOW): boolean => isInFlight(f) && (isOverdue(f, now) || (ageingOf(f, now) === 'ageing' && !!f.blocker));

/* ---------------- Sort, filter, search ---------------- */

const AGE_RANK: Record<AgeingBand, number> = { overdue: 0, ageing: 1, onTime: 2 };
/** Overdue first, then ageing, then the most days in stage, then most recently updated. Credited: newest credit first. */
export function sortFiles(files: readonly MifFile[], now: Date = MIF_NOW): MifFile[] {
  return [...files].sort((a, b) => {
    if (isInFlight(a) !== isInFlight(b)) return isInFlight(a) ? -1 : 1;
    if (!isInFlight(a)) return (b.credited?.at.getTime() ?? 0) - (a.credited?.at.getTime() ?? 0);
    const r = AGE_RANK[ageingOf(a, now)!] - AGE_RANK[ageingOf(b, now)!];
    if (r) return r;
    const d = daysInStage(b, now) - daysInStage(a, now);
    if (d) return d;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export type MifFilter = 'all' | MifStage | 'overdue' | 'stuck';
export const MIF_FILTERS: { id: MifFilter; label: string }[] = [
  { id: 'all', label: 'All in flight' }, { id: 'sanctioned', label: 'Sanctioned' }, { id: 'docsPending', label: 'Docs pending' },
  { id: 'disbursalInitiated', label: 'Disbursal initiated' }, { id: 'credited', label: 'Credited' }, { id: 'overdue', label: 'Overdue' },
  { id: 'stuck', label: 'Stuck' },
];
export function applyFilter(files: readonly MifFile[], filter: MifFilter, now: Date = MIF_NOW): MifFile[] {
  const vis = visibleFiles(files, now);
  switch (filter) {
    case 'all': return vis.filter(isInFlight);
    case 'credited': return vis.filter((f) => f.stage === 'credited');
    case 'overdue': return vis.filter((f) => isOverdue(f, now));
    case 'stuck': return vis.filter((f) => isStuck(f, now));
    default: return vis.filter((f) => f.stage === filter);
  }
}
export function filterCounts(files: readonly MifFile[], now: Date = MIF_NOW): Record<MifFilter, number> {
  const out = {} as Record<MifFilter, number>;
  for (const f of MIF_FILTERS.map((x) => x.id)) out[f] = applyFilter(files, f, now).length;
  return out;
}

/**
 * Search across in-flight files and the last 3 days of credits: customer name (case-insensitive, full, first or last
 * name, prefix), the 10-digit mobile, or its last 4 digits (any digit run of 4+ that the mobile ends with / contains).
 */
export function searchFiles(files: readonly MifFile[], query: string, now: Date = MIF_NOW): MifFile[] {
  const q = (query ?? '').trim().toLowerCase();
  const vis = visibleFiles(files, now);
  if (!q) return vis;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, '').length) {
    const d = digits.length > 10 ? digits.slice(-10) : digits;
    return vis.filter((f) => (d.length === 10 ? f.mobile === d : f.mobile.endsWith(d) || (d.length >= 6 && f.mobile.includes(d))));
  }
  const words = q.split(/\s+/).filter(Boolean);
  return vis.filter((f) => {
    const parts = f.customer.toLowerCase().split(/\s+/);
    return words.every((w) => parts.some((p) => p.startsWith(w))) || f.lan.toLowerCase().includes(q);
  });
}

/* ---------------- Case sheet decisions ---------------- */

export type SheetCta = { kind: DealerAction | 'query'; label: string };
/** Credited amount differs from the expected net (short / excess credit). */
export const creditMismatch = (f: MifFile): boolean => !!f.credited && f.credited.amount !== f.expectedNet;

/**
 * Primary + secondary CTA for the case sheet (spec table "Dealer actions"): one primary. A dealer / customer-reminder
 * blocker gets its action with Raise a query under it; bank-owned holds and short credits get Raise a query as the
 * primary; a matched credit has only the secondary Raise a query.
 */
export function sheetCtas(f: MifFile, opts: { rcUploaded?: boolean; journeyInSession?: boolean } = {}): { primary: SheetCta | null; secondary: SheetCta | null } {
  const query: SheetCta = { kind: 'query', label: 'Raise a query' };
  if (f.stage === 'credited') return creditMismatch(f) ? { primary: query, secondary: null } : { primary: null, secondary: query };
  const b = effectiveBlocker(f, opts.rcUploaded);
  const meta = b ? BLOCKERS[b] : null;
  if (meta?.action && (meta.action !== 'openDocs' || opts.journeyInSession)) return { primary: { kind: meta.action, label: meta.actionLabel! }, secondary: query };
  return { primary: query, secondary: null };
}
/** The blocker after a local RC upload (RC copy pending → under review). */
export const effectiveBlocker = (f: MifFile, rcUploaded?: boolean): BlockerCode | undefined => (f.blocker === 'RC_COPY' && rcUploaded ? 'RC_REVIEW' : f.blocker);

/** Query reason to pre-select on QuerySheet. */
export function preselectReason(f: MifFile): QueryReasonId {
  if (creditMismatch(f)) return 'shortCredit';
  if (f.stage === 'credited') return 'notReceived';
  if (f.blocker === 'BANK_MISMATCH') return 'wrongAccount';
  return 'stuck';
}
/** Mock ticket id: QRY-<LAN digits>-<n>. */
export const ticketIdFor = (lan: string, n = 1): string => queryTicketId('rm', lan, n);

/* ---------------- Copy (English UI; spoken via Piper) ---------------- */

/** "6 days" / "1 day" / "today". */
export const daysLabel = (d: number): string => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);
const first = (name: string) => name.split(/\s+/)[0] ?? name;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "9:43 AM" with a non-breaking space. */
export const fmtTime = (d: Date): string => { const h = d.getHours(); return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** "Today, 9:43 AM" / "Yesterday, 5:05 PM" / "22 Nov, 4:20 PM". */
export function fmtWhen(d: Date, now: Date = MIF_NOW): string {
  const n = calendarDays(d, now);
  const day = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${day}, ${fmtTime(d)}`;
}

/** Spoken amount: 22.9 lakh, 1.35 lakh, 66 thousand 500 rupees, 2.1 crore. */
export function spokenAmount(n: number): string {
  const trim = (v: string) => v.replace(/\.?0+$/, '');
  if (n >= 1e7) return `${trim((n / 1e7).toFixed(2))} crore`;
  if (n >= 1e5) return `${trim((n / 1e5).toFixed(n >= 1e6 ? 1 : 2))} lakh`;
  if (n >= 1000) { const th = Math.floor(n / 1000); const r = n % 1000; return r ? `${th} thousand ${r} rupees` : `${th} thousand rupees`; }
  return `${n} rupees`;
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "5 files in flight, 22.9 lakh. 2 overdue." */
export function summaryLine(files: readonly MifFile[], now: Date = MIF_NOW): string {
  const t = mifTotals(files, now);
  if (!t.inFlightCount) return t.creditedTodayCount ? `No files in flight. ${spokenAmount(t.creditedTodayAmount)} credited today.` : 'No loan money in flight right now.';
  return `${plural(t.inFlightCount, 'file')} in flight, ${spokenAmount(t.inFlightAmount)}. ${t.overdueCount ? `${t.overdueCount} overdue.` : 'All on time.'}`;
}
/** "2 files stuck. Oldest is Pooja Iyer, RC copy pending, 6 days." */
export function stuckLine(files: readonly MifFile[], now: Date = MIF_NOW): string {
  const st = sortFiles(files.filter((f) => isStuck(f, now)), now);
  if (!st.length) return 'No file is stuck. Everything is on time.';
  const o = st[0]!;
  const b = o.blocker ? `${BLOCKERS[o.blocker].label}, ` : '';
  const over = st.filter((f) => isOverdue(f, now)).length;
  return `${plural(st.length, 'file')} stuck${over ? `, ${over} overdue` : ''}. Oldest is ${o.customer}, ${b}${daysLabel(daysInStage(o, now))}.`;
}
/** "3 files credited today, 8.6 lakh." */
export function todayLine(files: readonly MifFile[], now: Date = MIF_NOW): string {
  const t = mifTotals(files, now);
  return t.creditedTodayCount ? `${plural(t.creditedTodayCount, 'file')} credited today, ${spokenAmount(t.creditedTodayAmount)}.` : 'Nothing credited yet today.';
}
/** One file's status, spoken and shown. */
export function fileStatusLine(f: MifFile, now: Date = MIF_NOW): string {
  const model = f.vehicle.replace(/\s*\(.*\)$/, '');
  if (f.stage === 'credited' && f.credited) {
    const n = calendarDays(f.credited.at, now);
    const day = n === 0 ? 'today' : n === 1 ? 'yesterday' : `on ${f.credited.at.getDate()} ${MONTHS[f.credited.at.getMonth()]}`;
    return `${first(f.customer)}'s money has come. ${spokenAmount(f.credited.amount)} credited ${day} at ${fmtTime(f.credited.at).replace('\u00A0', ' ')}.`;
  }

  const b = f.blocker ? `, ${BLOCKERS[f.blocker].label}` : '';
  const d = daysInStage(f, now);
  return `${f.customer}, ${model}. Not credited yet: ${STAGE_LABEL[f.stage].toLowerCase()}${b}, ${d === 0 ? 'since today' : daysLabel(d)}.`;
}

/* ---------------- Alerts (in-app only: AlertCard + Zippy) ---------------- */

export type MifAlert = { id: string; tone: 'success' | 'danger' | 'warning'; title: string; caption: string; lan: string };
/** Latest credit today (success) and the oldest overdue file (danger), from the SAME files as the list. */
export function mifAlerts(files: readonly MifFile[], now: Date = MIF_NOW): MifAlert[] {
  const out: MifAlert[] = [];
  const credit = files.filter((f) => creditedToday(f, now)).sort((a, b) => b.credited!.at.getTime() - a.credited!.at.getTime())[0];
  if (credit?.credited) out.push({ id: `credit:${credit.lan}`, tone: 'success', title: `${inr(credit.credited.amount)} credited for ${first(credit.customer)}`, caption: `${fmtWhen(credit.credited.at, now)} · ${credit.lan}`, lan: credit.lan });
  const over = sortFiles(files.filter((f) => isOverdue(f, now)), now)[0];
  if (over) out.push({ id: `overdue:${over.lan}`, tone: 'danger', title: `${first(over.customer)}'s file: ${over.blocker ? BLOCKERS[over.blocker].label : STAGE_LABEL[over.stage]} for ${daysLabel(daysInStage(over, now))}`, caption: `${over.lan} · overdue`, lan: over.lan });
  return out;
}
export { STAGE_LABEL };
