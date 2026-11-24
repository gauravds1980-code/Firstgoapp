/** Dealer profile + dashboard data (mock). */
import { DEALER_PRODUCTS, DealerProduct, ProductId, Condition } from '../config/products';
import { delay } from './mock';

/* ---------------- Dealer profile ---------------- */
export type DealerType = 'dealer' | 'subDealer' | 'multiBrand';
export const DEALER_TYPE_LABEL: Record<DealerType, string> = { dealer: 'Dealer', subDealer: 'Sub-dealer', multiBrand: 'Multi-brand dealer' };

/**
 * What the dealer is onboarded for. Returned with the dealer session at login
 * (real: dealer master in the LOS / DMS). `oem` is set for Dealer and Sub-dealer only.
 */
export interface DealerProfile {
  type: DealerType;
  oem?: string; // e.g. 'Hero MotoCorp' — must match catalogue brand names
  products: DealerProduct[];
  branch: string;
  /** Has Trade Advance / Inventory Funding limits with IDFC FIRST (shows the TA / INF tile). */
  hasTaInf: boolean;
}

/**
 * Mock dealer master, keyed by the dealer login mobile:
 *   ends 1111 → Multi-brand dealer · New TW + New Car · has TA/INF
 *   ends 2222 → Sub-dealer · Maruti Suzuki · New Car only · no TA/INF
 *   anything else → Dealer · Hero MotoCorp · New TW only · has TA/INF (default, "ABC Motors")
 */
export function mockDealerProfile(mobile: string): { dealerId: string; name: string; profile: DealerProfile } {
  if (mobile.endsWith('1111'))
    return { dealerId: 'DLR-PUN-0918', name: 'Shree Auto Mall', profile: { type: 'multiBrand', products: ['newTw', 'newCar'], branch: 'Baner, Pune', hasTaInf: true } };
  if (mobile.endsWith('2222'))
    return { dealerId: 'DLR-THN-1203', name: 'Sai Motors', profile: { type: 'subDealer', oem: 'Maruti Suzuki', products: ['newCar'], branch: 'Thane West', hasTaInf: false } };
  return { dealerId: 'DLR-MUM-0457', name: 'ABC Motors', profile: { type: 'dealer', oem: 'Hero MotoCorp', products: ['newTw'], branch: 'Andheri East', hasTaInf: true } };
}

/** Product categories (2W / Car) the dealer can originate, in display order. */
export function enabledCategories(p: DealerProfile): ProductId[] {
  return (['twoWheeler', 'car'] as ProductId[]).filter((c) => DEALER_PRODUCTS.some((d) => d.product === c && p.products.includes(d.key)));
}
/** New / Used options the dealer has for a category. */
export function enabledConditions(p: DealerProfile, product: ProductId): Condition[] {
  return (['new', 'used'] as Condition[]).filter((c) => DEALER_PRODUCTS.some((d) => d.product === product && d.condition === c && p.products.includes(d.key)));
}
/** "Dealer · Hero MotoCorp" / "Multi-brand dealer" */
export function dealerTagline(p: DealerProfile): string {
  return [DEALER_TYPE_LABEL[p.type], p.type !== 'multiBrand' ? p.oem : undefined].filter(Boolean).join(' · ');
}
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export interface Stat { key: string; label: string; value: string; delta: string; up: boolean; tone: 'blue' | 'mint' | 'peach' | 'rose'; icon: string }
export interface RecentApp { id: string; when: string; status: 'APPROVED' | 'PENDING' | 'DISBURSED'; amount: number; product: 'twoWheeler' | 'car' }
export interface QuickAction { key: 'reports' | 'dashboard' | 'rc' | 'tainf'; label: string; icon: string; count: number }

export interface Payout { utr: string; lan: string; amount: number; when: string; product: 'twoWheeler' | 'car' }

export async function fetchDealerHome(): Promise<{ stats: Stat[]; recent: RecentApp[]; actions: QuickAction[]; unread: number; payouts: Payout[]; payoutsToday: number }> {
  await delay(900);
  return {
    unread: 2,
    payoutsToday: 306000,
    payouts: [
      { utr: 'IDFBR817262893749220', lan: 'TW-184392', amount: 135000, when: 'Today, 9:43 AM', product: 'twoWheeler' },
      { utr: 'IDFBR817262893741108', lan: 'TW-184388', amount: 66500, when: 'Today, 8:52 AM', product: 'twoWheeler' },
      { utr: 'IDFBR817262893739912', lan: 'TW-184371', amount: 104500, when: 'Today, 8:21 AM', product: 'twoWheeler' },
    ],
    stats: [
      { key: 'apps', label: 'Applications today', value: '3', delta: '20%', up: true, tone: 'blue', icon: 'file-document-outline' },
      { key: 'appr', label: 'Approved today', value: '3', delta: '25%', up: true, tone: 'mint', icon: 'check-decagram-outline' },
      { key: 'amt', label: 'Approved amount', value: '₹3,06,000', delta: '12%', up: true, tone: 'peach', icon: 'currency-inr' },
      { key: 'tat', label: 'Avg. processing time', value: '1m 57s', delta: '8%', up: false, tone: 'rose', icon: 'timer-outline' },
    ],
    recent: [
      { id: 'TW-184392', when: 'Today, 9:43 AM', status: 'DISBURSED', amount: 135000, product: 'twoWheeler' },
      { id: 'TW-184401', when: 'Today, 10:05 AM', status: 'APPROVED', amount: 96000, product: 'twoWheeler' },
      { id: 'CR-20417', when: 'Today, 10:31 AM', status: 'PENDING', amount: 726000, product: 'car' },
    ],
    actions: [
      { key: 'reports', label: 'Reports', icon: 'chart-bar', count: 4 },
      { key: 'dashboard', label: 'Dashboard', icon: 'view-dashboard-outline', count: 0 },
      { key: 'rc', label: 'RC Pendency', icon: 'card-account-details-outline', count: 12 },
      { key: 'tainf', label: 'TA / INF', icon: 'file-document-outline', count: 3 },
    ],
  };
}

export type ListKind = QuickAction['key'] | 'loans' | 'payouts';

export const QUICK_LISTS: Record<ListKind, { title: string; subtitle: string; rows: { title: string; meta: string; tag?: string }[] }> = {
  reports: {
    title: 'Reports', subtitle: 'Downloadable MIS for your dealership',
    rows: [
      { title: 'Daily disbursal report', meta: '23 Nov 2026 · PDF', tag: 'New' },
      { title: 'Monthly business summary', meta: 'Nov 2026 · XLSX', tag: 'New' },
      { title: 'Payout / subvention statement', meta: 'Oct 2026 · PDF' },
    ],
  },
  dashboard: {
    title: 'Dashboard', subtitle: 'Business metrics — month to date',
    rows: [
      { title: 'Logins', meta: '64 applications · ▲ 18% MoM' },
      { title: 'Approval rate', meta: '82% · ▲ 4 pts' },
      { title: 'Disbursed', meta: '₹71.4 L · 52 loans' },
      { title: 'Avg. TAT (scan → disbursal)', meta: '1m 57s' },
      { title: 'Two Wheeler / Car mix', meta: '46 / 6 loans' },
    ],
  },
  rc: {
    title: 'RC Pendency', subtitle: 'Registration certificates awaiting upload',
    rows: [
      { title: 'IDFBR786526781908 · Rahul S.', meta: 'Disbursed 12 days ago', tag: 'Overdue' },
      { title: 'IDFBR786526246122 · Priya K.', meta: 'Disbursed 9 days ago', tag: 'Due soon' },
      { title: 'IDFBR786526700111 · Amit P.', meta: 'Disbursed 6 days ago' },
      { title: 'IDFBR786526700342 · Neha D.', meta: 'Disbursed 4 days ago' },
      { title: 'IDFBR786526700980 · Vikram R.', meta: 'Disbursed 2 days ago' },
    ],
  },
  loans: {
    title: 'Loans', subtitle: 'All applications and their status',
    rows: [
      { title: 'TW-184392 · Rahul S. · ₹1,50,000', meta: 'Royal Enfield Bullet 350 · Today 9:41 AM', tag: 'Disbursed' },
      { title: 'TW-184401 · Priya K. · ₹96,000', meta: 'TVS Apache RTR 160 · Today 10:05 AM', tag: 'Approved' },
      { title: 'CR-20417 · Amit P. · ₹7,26,000', meta: 'Tata Nexon · awaiting e-sign', tag: 'Pending' },
      { title: 'TW-184371 · Neha D. · ₹1,10,000', meta: 'Ather 450X · Today 8:19 AM', tag: 'Disbursed' },
      { title: 'TW-184350 · Vikram R. · ₹70,000', meta: 'Honda Activa 6G · Yesterday', tag: 'Disbursed' },
    ],
  },
  payouts: {
    title: 'Payouts & Disbursals', subtitle: "Loan amounts credited to ABC Motors' settlement account",
    rows: [
      { title: '₹1,35,000 · TW-184392', meta: 'UTR IDFBR817262893749220 · Today 9:43 AM', tag: 'Credited' },
      { title: '₹66,500 · TW-184388', meta: 'UTR IDFBR817262893741108 · Today 8:52 AM', tag: 'Credited' },
      { title: '₹1,04,500 · TW-184371', meta: 'UTR IDFBR817262893739912 · Today 8:21 AM', tag: 'Credited' },
      { title: '₹38,400 · Incentive (INF) Oct', meta: 'UTR IDFBR817262890012345 · 05 Nov', tag: 'Credited' },
    ],
  },
  tainf: {
    title: 'TA / INF Details', subtitle: 'Trade advance & incentive (INF) payouts',
    rows: [
      { title: 'Trade advance — Nov', meta: '₹4,50,000 utilised of ₹10,00,000', tag: 'Active' },
      { title: 'Incentive (INF) — Oct', meta: '₹38,400 · credited 05 Nov' },
      { title: 'Incentive (INF) — Nov (accrued)', meta: '₹21,750 · payable 05 Dec', tag: 'Accruing' },
    ],
  },
};
