/** Dealer profile + dashboard data (mock). */
import { DEALER_PRODUCTS, DealerProduct, PRODUCT_IDS, ProductId, Condition } from '../config/products';
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
  /**
   * v1.4.5: RTO state code of the dealership ("MH"), optional — the dealer master does not send it yet. Voice RC entry
   * snaps misheard state codes toward it (default MH: every mock branch is in Maharashtra).
   */
  stateCode?: string;
  /** Has a Trade Advance or Inventory Funding facility with IDFC FIRST. Always `facilityType != null`. */
  hasTaInf: boolean;
  /** The ONE facility the dealer has: TA (dealer draws down) or INF (OEM draws on invoice), never both. */
  facilityType: 'TA' | 'INF' | null;
}

/**
 * Mock dealer master, keyed by the dealer login mobile:
 *   ends 1111 → Multi-brand dealer · New TW + New Car · Trade Advance (larger limit)
 *   ends 2222 → Sub-dealer · Maruti Suzuki · New Car only · no TA / INF
 *   ends 3333 → Dealer · Tata Motors · New Commercial Vehicle only · Inventory Funding ("Tata CV Hub", v1.2.2)
 *   anything else → Dealer · Hero MotoCorp · New TW only · Trade Advance (default, "ABC Motors")
 */
export function mockDealerProfile(mobile: string): { dealerId: string; name: string; profile: DealerProfile } {
  if (mobile.endsWith('1111'))
    return { dealerId: 'DLR-PUN-0918', name: 'Shree Auto Mall', profile: { type: 'multiBrand', products: ['newTw', 'newCar'], branch: 'Baner, Pune', hasTaInf: true, facilityType: 'TA' } };
  if (mobile.endsWith('2222'))
    return { dealerId: 'DLR-THN-1203', name: 'Sai Motors', profile: { type: 'subDealer', oem: 'Maruti Suzuki', products: ['newCar'], branch: 'Thane West', hasTaInf: false, facilityType: null } };
  if (mobile.endsWith('3333'))
    // CV dealers stock fleets on inventory funding: Tata Motors draws it on invoice.
    return { dealerId: 'DLR-PUN-3307', name: 'Tata CV Hub', profile: { type: 'dealer', oem: 'Tata Motors', products: ['newCv'], branch: 'Chakan, Pune', hasTaInf: true, facilityType: 'INF' } };
  return { dealerId: 'DLR-MUM-0457', name: 'ABC Motors', profile: { type: 'dealer', oem: 'Hero MotoCorp', products: ['newTw'], branch: 'Andheri East', hasTaInf: true, facilityType: 'TA' } };
}

/** Product categories (2W / Car / CV) the dealer can originate, in display order. */
export function enabledCategories(p: DealerProfile): ProductId[] {
  return PRODUCT_IDS.filter((c) => DEALER_PRODUCTS.some((d) => d.product === c && p.products.includes(d.key)));
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
export interface RecentApp { id: string; when: string; status: 'APPROVED' | 'PENDING' | 'DISBURSED'; amount: number; product: ProductId }
export interface QuickAction { key: 'reports' | 'dashboard' | 'rc' | 'tainf'; label: string; icon: string; count: number }

export interface Payout { utr: string; lan: string; amount: number; when: string; product: ProductId }

/** "Today, 9:43 AM" with a non-breaking space before AM/PM, so the time never wraps "AM" onto its own line. */
const t = (time: string) => `Today, ${time.replace(' ', '\u00A0')}`;

/** Home dashboard. Callers filter `recent` / `payouts` to the dealer's enabled categories (see HomeScreen). */
export async function fetchDealerHome(): Promise<{ stats: Stat[]; recent: RecentApp[]; actions: QuickAction[]; unread: number; payouts: Payout[] }> {
  await delay(900);
  return {
    unread: 2,
    payouts: [
      { utr: 'IDFBR817262893752611', lan: 'CV-30218', amount: 512000, when: t('9:58 AM'), product: 'cv' },
      { utr: 'IDFBR817262893744406', lan: 'CV-30211', amount: 748000, when: t('9:05 AM'), product: 'cv' },
      { utr: 'IDFBR817262893736015', lan: 'CR-20409', amount: 662000, when: t('8:40 AM'), product: 'car' },
      { utr: 'IDFBR817262893749220', lan: 'TW-184392', amount: 135000, when: t('9:43 AM'), product: 'twoWheeler' },
      { utr: 'IDFBR817262893741108', lan: 'TW-184388', amount: 66500, when: t('8:52 AM'), product: 'twoWheeler' },
      { utr: 'IDFBR817262893739912', lan: 'TW-184371', amount: 104500, when: t('8:21 AM'), product: 'twoWheeler' },
    ],
    stats: [
      { key: 'apps', label: 'Applications today', value: '3', delta: '20%', up: true, tone: 'blue', icon: 'file-document-outline' },
      { key: 'appr', label: 'Approved today', value: '3', delta: '25%', up: true, tone: 'mint', icon: 'check-decagram-outline' },
      { key: 'amt', label: 'Approved amount', value: '₹3,06,000', delta: '12%', up: true, tone: 'peach', icon: 'currency-inr' },
      { key: 'tat', label: 'Avg. processing time', value: '1m 57s', delta: '8%', up: false, tone: 'rose', icon: 'timer-outline' },
    ],
    // Today's applications, newest first. Every loan credited in `payouts` above is here as DISBURSED,
    // so Home's Today figures (applications / approved / disbursed) agree with the credits list.
    recent: [
      { id: 'CV-30226', when: t('10:40 AM'), status: 'PENDING', amount: 1255000, product: 'cv' },
      { id: 'CR-20417', when: t('10:31 AM'), status: 'PENDING', amount: 726000, product: 'car' },
      { id: 'TW-184401', when: t('10:05 AM'), status: 'APPROVED', amount: 96000, product: 'twoWheeler' },
      { id: 'CV-30218', when: t('9:58 AM'), status: 'DISBURSED', amount: 527000, product: 'cv' },
      { id: 'TW-184392', when: t('9:43 AM'), status: 'DISBURSED', amount: 138000, product: 'twoWheeler' },
      { id: 'CV-30211', when: t('9:05 AM'), status: 'DISBURSED', amount: 763000, product: 'cv' },
      { id: 'TW-184388', when: t('8:52 AM'), status: 'DISBURSED', amount: 68000, product: 'twoWheeler' },
      { id: 'CR-20409', when: t('8:40 AM'), status: 'DISBURSED', amount: 676000, product: 'car' },
      { id: 'TW-184371', when: t('8:21 AM'), status: 'DISBURSED', amount: 110000, product: 'twoWheeler' },
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

/** Rows with a `product` are only shown to dealers enabled for that product (QuickListScreen filters). */
export const QUICK_LISTS: Record<ListKind, { title: string; subtitle: string; rows: { title: string; meta: string; tag?: string; product?: ProductId }[] }> = {
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
      { title: 'Product mix', meta: 'Two Wheeler 46 · Car 6 · Commercial Vehicle 4 loans' },
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
      { title: 'TW-184392 · Rahul S. · ₹1,38,000', meta: 'Hero Xtreme 125R · Today 9:43\u00A0AM', tag: 'Disbursed', product: 'twoWheeler' },
      { title: 'TW-184401 · Priya K. · ₹96,000', meta: 'TVS Apache RTR 160 · Today 10:05\u00A0AM', tag: 'Approved', product: 'twoWheeler' },
      { title: 'CR-20417 · Amit P. · ₹7,26,000', meta: 'Tata Nexon · awaiting e-sign', tag: 'Pending', product: 'car' },
      { title: 'CV-30226 · Sanjay P. · ₹12,55,000', meta: 'Tata 407 Gold SFC · awaiting e-sign', tag: 'Pending', product: 'cv' },
      { title: 'CV-30218 · Manoj V. · ₹5,27,000', meta: 'Tata Ace Gold · Today 9:58\u00A0AM', tag: 'Disbursed', product: 'cv' },
      { title: 'TW-184371 · Neha D. · ₹1,10,000', meta: 'Ather 450X · Today 8:19\u00A0AM', tag: 'Disbursed', product: 'twoWheeler' },
      { title: 'TW-184350 · Vikram R. · ₹70,000', meta: 'Honda Activa 6G · Yesterday', tag: 'Disbursed', product: 'twoWheeler' },
    ],
  },
  payouts: {
    title: 'Payouts & Disbursals', subtitle: 'Loan amounts credited to your settlement account',
    rows: [
      { title: '₹5,12,000 · CV-30218', meta: 'UTR IDFBR817262893752611 · Today 9:58\u00A0AM', tag: 'Credited', product: 'cv' },
      { title: '₹1,35,000 · TW-184392', meta: 'UTR IDFBR817262893749220 · Today 9:43\u00A0AM', tag: 'Credited', product: 'twoWheeler' },
      { title: '₹7,48,000 · CV-30211', meta: 'UTR IDFBR817262893744406 · Today 9:05\u00A0AM', tag: 'Credited', product: 'cv' },
      { title: '₹66,500 · TW-184388', meta: 'UTR IDFBR817262893741108 · Today 8:52\u00A0AM', tag: 'Credited', product: 'twoWheeler' },
      { title: '₹6,62,000 · CR-20409', meta: 'UTR IDFBR817262893736015 · Today 8:40\u00A0AM', tag: 'Credited', product: 'car' },
      { title: '₹1,04,500 · TW-184371', meta: 'UTR IDFBR817262893739912 · Today 8:21\u00A0AM', tag: 'Credited', product: 'twoWheeler' },
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
