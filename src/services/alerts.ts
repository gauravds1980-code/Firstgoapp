/**
 * v1.4.7 Feature 2 — Credit and payout alerts (spec 02-credit-payout-alerts.md, approved 28 Nov 2026 with Gaurav's answers).
 *
 * In-app only in this version: inbox, Home bell badge, Zippy nudge and the local Piper readout. No expo-notifications,
 * no push token, no native module. The push channel is modelled (lock-screen copy, quiet-hours hold) so the sender
 * can reuse the same rules later.
 *
 * Pure module (no React Native): unit-tested in Node (services/__tests__/alerts.test.ts).
 *
 * Approved decisions:
 *  1. Quiet hours (default 9:00 PM – 8:00 AM Asia/Calcutta) hold EVERY push until the window ends (8:00 AM IST). No type
 *     breaks through. The in-app inbox still updates at once (the row is marked "push held until 8:00 AM"), and the
 *     automatic Zippy / Piper readout does not fire inside the window. IST is computed from the instant (UTC + 5:30),
 *     never from the phone's timezone.
 *  2. One shared inbox per dealer id: every login / device of that dealer sees the same rows and read state.
 *  3. A short-pay commission alert (payout.shortPaid) is mocked now: expected vs paid on one invoice line.
 *  4. Promotional consent = in-app checkbox + stored timestamp (per dealer id). Unchecking withdraws, locks and turns
 *     the promotional switches off. No promotional alert is ever sent in this version.
 *
 * Segment gating: loan-money alerts (credited, disbursal started, blocker, overdue) follow Money in flight
 * (`isMoneyInFlightEnabled`): a new-two-wheeler-only dealer gets commission (payout.*) alerts only, and no loan alert is
 * ever raised for a new two-wheeler file.
 *
 * EXAMPLE DATA: loan rows are built from the v1.4.6 Money-in-flight mock files (same LAN, first name, amount, time);
 * commission rows from the Payouts invoice mock (same invoice id, amount, line).
 */
import type { DealerProfile } from './dealer';
import type { Invoice } from './business';
import { findLine, lineFigures, statementInvoicesFor } from './payoutStatement';
import {
  BLOCKERS, calendarDays, fmtWhen, isMoneyInFlightEnabled, mifFilesFor, mifKeyFor, MIF_NOW, spokenAmount, stageEnteredAt, type MifFile, type MifFilter,
} from './moneyInFlight';
import { inr } from '../utils/finance';

/* ---------------- Types ---------------- */

export const LOAN_ALERT_TYPES = ['loan.credited', 'loan.disbursalInitiated', 'loan.blocker', 'loan.overdue'] as const;
export const PAYOUT_ALERT_TYPES = ['payout.paid', 'payout.readyToClaim', 'payout.shortPaid'] as const;
export const ALERT_TYPES = [...LOAN_ALERT_TYPES, ...PAYOUT_ALERT_TYPES] as const;
export type LoanAlertType = (typeof LOAN_ALERT_TYPES)[number];
export type PayoutAlertType = (typeof PAYOUT_ALERT_TYPES)[number];
export type AlertType = LoanAlertType | PayoutAlertType;
export type AlertCategory = 'loan' | 'payout';
export type AlertTone = 'success' | 'info' | 'warning' | 'danger';

/** Settings labels, in the settings order (spec mockup). */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  'loan.credited': 'Loan credited',
  'loan.disbursalInitiated': 'Disbursal initiated',
  'loan.blocker': 'New blocker',
  'loan.overdue': 'File overdue',
  'payout.paid': 'Commission paid',
  'payout.readyToClaim': 'Invoice ready to claim',
  'payout.shortPaid': 'Short-pay difference',
};
export const ALERT_TONE: Record<AlertType, AlertTone> = {
  'loan.credited': 'success', 'loan.disbursalInitiated': 'info', 'loan.blocker': 'warning', 'loan.overdue': 'danger',
  'payout.readyToClaim': 'warning', 'payout.paid': 'success', 'payout.shortPaid': 'danger',
};
export const categoryOf = (t: AlertType): AlertCategory => (t.startsWith('loan.') ? 'loan' : 'payout');
export const isLoanType = (t: AlertType): t is LoanAlertType => categoryOf(t) === 'loan';

/** Where tapping the row (or the push) lands. */
export type AlertTarget =
  | { screen: 'MoneyInFlight'; lan: string; filter?: MifFilter }
  | { screen: 'Payouts'; invoice: string; lan?: string };

/** v1.4.8: always a line of the payout statement that is genuinely short-paid (expected − paid >= ₹100). */
export interface ShortPay { invoice: string; lan: string; customer: string; expected: number; paid: number; difference: number; reason?: string }

export interface AlertEvent {
  /** Dedupe key: one event per (type, subject, IST day). */
  id: string;
  type: AlertType;
  /** LAN (loan.*) or invoice id (payout.*). */
  subject: string;
  at: Date;
  tone: AlertTone;
  /** Inbox title, e.g. "₹6,62,000 credited for Neha". */
  title: string;
  /** Caption reference after the time: LAN, or invoice id (+ LAN for a short-pay). */
  ref: string;
  /** Lock-screen / push copy (English, first name + LAN / invoice only). */
  push: string;
  /** One Hinglish sentence for the Piper readout (never a mobile number). */
  spoken: string;
  target: AlertTarget;
  amount?: number;
  short?: ShortPay;
  /** Mock seed already read before this session (the store's read map adds to it). */
  seedRead?: boolean;
}

/* ---------------- IST clock (no device timezone) ---------------- */

export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const istShift = (ms: number) => ms + IST_OFFSET_MIN * MIN_MS;

/** The instant for a wall-clock time in Asia/Calcutta (month 0-based, like Date). */
export const istInstant = (y: number, m: number, d: number, hh = 0, mm = 0): Date => new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MIN * MIN_MS);
/** Minutes since IST midnight (0–1439) for an instant. */
export const istMinuteOfDay = (at: Date | number): number => {
  const ms = istShift(typeof at === 'number' ? at : at.getTime());
  return Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS);
};
/** IST calendar day "2026-11-24" for an instant (the dedupe day). */
export const istDayKey = (at: Date | number): string => new Date(istShift(typeof at === 'number' ? at : at.getTime())).toISOString().slice(0, 10);
/** "8:00 AM" for an hour of the day (0–23). */
export const hourLabel = (h: number): string => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
/** "8:00 AM" for an instant, read in IST. */
export const istTimeLabel = (at: Date): string => {
  const m = istMinuteOfDay(at); const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/* ---------------- Quiet hours (pure scheduling) ---------------- */

export interface QuietHours { enabled: boolean; startHour: number; endHour: number }
export const DEFAULT_QUIET: QuietHours = { enabled: true, startHour: 21, endHour: 8 };
export const quietLabel = (q: QuietHours): string => `${hourLabel(q.startHour)} – ${hourLabel(q.endHour)}`;

/** Inside the window: start inclusive, end exclusive (21:00 is quiet, 08:00 is not). Off or a zero-length window → never. */
export function inQuietHours(at: Date | number, q: QuietHours): boolean {
  if (!q.enabled || q.startHour === q.endHour) return false;
  const m = istMinuteOfDay(at);
  const s = q.startHour * 60; const e = q.endHour * 60;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** When a push for an event at `at` may go out: `at` itself, or the end of the quiet window it falls in (IST). */
export function pushReleaseAt(at: Date | number, q: QuietHours): Date {
  const ms = typeof at === 'number' ? at : at.getTime();
  if (!inQuietHours(ms, q)) return new Date(ms);
  const shifted = istShift(ms);
  const istMidnight = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS); // IST midnight, in shifted ms
  let end = istMidnight + q.endHour * 60 * MIN_MS;
  // Evening part of a window that wraps past midnight → tomorrow's end hour.
  if (q.startHour > q.endHour && istMinuteOfDay(ms) >= q.startHour * 60) end += DAY_MS;
  return new Date(end - IST_OFFSET_MIN * MIN_MS);
}

export interface PushPlan { send: boolean; held: boolean; deliverAt: Date | null; reason?: 'pushOff' | 'typeOff' }
/** The (future) push channel's decision for one event. The inbox row is added either way (if the type is on). */
export function planPush(ev: Pick<AlertEvent, 'type' | 'at'>, prefs: AlertPrefs): PushPlan {
  if (!prefs.types[ev.type]) return { send: false, held: false, deliverAt: null, reason: 'typeOff' };
  if (!prefs.push) return { send: false, held: false, deliverAt: null, reason: 'pushOff' };
  const deliverAt = pushReleaseAt(ev.at, prefs.quiet);
  return { send: true, held: deliverAt.getTime() !== ev.at.getTime(), deliverAt };
}

export interface PushBatch { deliverAt: Date; ids: string[]; text: string }
/**
 * Group the pushes to send: a burst held overnight goes out as ONE summary push at the release time ("3 updates
 * waiting"); anything not held (or a single held event) is its own push with the lock-screen copy.
 */
export function batchPushes(events: readonly AlertEvent[], prefs: AlertPrefs): PushBatch[] {
  const held = new Map<number, AlertEvent[]>();
  const out: PushBatch[] = [];
  for (const ev of events) {
    const p = planPush(ev, prefs);
    if (!p.send || !p.deliverAt) continue;
    if (p.held) held.set(p.deliverAt.getTime(), [...(held.get(p.deliverAt.getTime()) ?? []), ev]);
    else out.push({ deliverAt: p.deliverAt, ids: [ev.id], text: ev.push });
  }
  for (const [t, evs] of held) {
    out.push(evs.length === 1 ? { deliverAt: new Date(t), ids: [evs[0]!.id], text: evs[0]!.push } : { deliverAt: new Date(t), ids: evs.map((e) => e.id), text: `${evs.length} updates waiting` });
  }
  return out.sort((a, b) => a.deliverAt.getTime() - b.deliverAt.getTime());
}

/** The automatic Zippy / Piper readout of a new alert may fire now (never inside quiet hours). */
export const readoutAllowed = (now: Date | number, q: QuietHours): boolean => !inQuietHours(now, q);

/* ---------------- Preferences + promotional consent ---------------- */

export const PROMO_TYPES = [
  { id: 'videos', label: 'Offer and scheme videos' },
  { id: 'festive', label: 'Festive campaigns' },
  { id: 'leads', label: 'Pre-approved leads' },
  { id: 'streaks', label: 'Streaks and badges' },
] as const;
export type PromoId = (typeof PROMO_TYPES)[number]['id'];
export interface PromoConsent { consentAt: string | null; withdrawnAt: string | null; switches: Record<PromoId, boolean> }
export interface AlertPrefs { push: boolean; quiet: QuietHours; types: Record<AlertType, boolean>; promo: PromoConsent }

const promoOff = (): Record<PromoId, boolean> => ({ videos: false, festive: false, leads: false, streaks: false });
export function defaultPrefs(): AlertPrefs {
  const types = {} as Record<AlertType, boolean>;
  for (const t of ALERT_TYPES) types[t] = true;
  return { push: true, quiet: { ...DEFAULT_QUIET }, types, promo: { consentAt: null, withdrawnAt: null, switches: promoOff() } };
}
/** Saved prefs (any older / partial shape) on top of the defaults. */
export function revivePrefs(raw: string | null | undefined): AlertPrefs {
  const d = defaultPrefs();
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<AlertPrefs>;
    const q = p.quiet;
    const hourOk = (h: unknown) => typeof h === 'number' && h >= 0 && h <= 23 && Number.isInteger(h);
    return {
      push: typeof p.push === 'boolean' ? p.push : d.push,
      quiet: q && typeof q.enabled === 'boolean' && hourOk(q.startHour) && hourOk(q.endHour) ? { enabled: q.enabled, startHour: q.startHour, endHour: q.endHour } : d.quiet,
      types: { ...d.types, ...(p.types ?? {}) },
      promo: p.promo && (p.promo.consentAt === null || typeof p.promo.consentAt === 'string')
        ? { consentAt: p.promo.consentAt, withdrawnAt: p.promo.withdrawnAt ?? null, switches: p.promo.consentAt ? { ...promoOff(), ...p.promo.switches } : promoOff() }
        : d.promo,
    };
  } catch { return d; }
}
/** Tick the consent box: record the time; promotional switches unlock but stay off. */
export const giveConsent = (p: AlertPrefs, now: Date): AlertPrefs => ({ ...p, promo: { consentAt: now.toISOString(), withdrawnAt: null, switches: promoOff() } });
/** Untick: withdraw (time recorded), lock and turn every promotional switch off. */
export const withdrawConsent = (p: AlertPrefs, now: Date): AlertPrefs => ({ ...p, promo: { consentAt: null, withdrawnAt: now.toISOString(), switches: promoOff() } });
export const promoLocked = (p: AlertPrefs): boolean => !p.promo.consentAt;
/** A promotional switch changes only after consent. */
export const setPromoSwitch = (p: AlertPrefs, id: PromoId, on: boolean): AlertPrefs =>
  (promoLocked(p) ? p : { ...p, promo: { ...p.promo, switches: { ...p.promo.switches, [id]: on } } });
/** This version never sends a promotional alert, whatever the consent state. */
export const PROMOTIONAL_SENDING_ENABLED = false;
export const canSendPromotional = (_p: AlertPrefs): boolean => PROMOTIONAL_SENDING_ENABLED;
/** Quiet window edit: an empty window (start = end) is refused. */
export function setQuietHours(p: AlertPrefs, patch: Partial<QuietHours>): AlertPrefs {
  const q = { ...p.quiet, ...patch };
  if (q.startHour === q.endHour) return p;
  return { ...p, quiet: q };
}

/* ---------------- Segment gating ---------------- */

type GateProfile = Parameters<typeof isMoneyInFlightEnabled>[0];
/** Loan-money alert types need Money in flight; commission (payout.*) alerts go to every dealer. */
export const alertTypeAllowed = (t: AlertType, profile: GateProfile): boolean => !isLoanType(t) || isMoneyInFlightEnabled(profile);
/** Types this dealer can get (and the settings screen shows). */
export const allowedTypes = (profile: GateProfile): AlertType[] => ALERT_TYPES.filter((t) => alertTypeAllowed(t, profile));
/** No loan alert is ever raised for a new two-wheeler file (Money in flight scope). */
export const fileAlertable = (f: Pick<MifFile, 'product' | 'condition'>): boolean => !(f.product === 'twoWheeler' && f.condition === 'new');

/* ---------------- Building events ---------------- */

const first = (name: string) => name.split(/\s+/)[0] ?? name;
const invTail = (id: string) => id.split('/').pop() ?? id;
const spokenLabel = (s: string) => s.replace(/a\/c/gi, 'account').replace(/PDD/g, 'P D D').replace(/RC/g, 'R C');
export const alertId = (type: AlertType, subject: string, at: Date | number): string => `${type}:${subject}:${istDayKey(at)}`;

export type EventInput =
  | { type: 'loan.credited'; at: Date; lan: string; customer: string; amount: number }
  | { type: 'loan.disbursalInitiated'; at: Date; lan: string; customer: string; amount: number }
  | { type: 'loan.blocker'; at: Date; lan: string; customer: string; blocker: string }
  | { type: 'loan.overdue'; at: Date; lan: string; customer: string; blocker?: string }
  | { type: 'payout.readyToClaim'; at: Date; invoice: string; amount: number }
  | { type: 'payout.paid'; at: Date; invoice: string; amount: number }
  | { type: 'payout.shortPaid'; at: Date; short: ShortPay };

/** One event from its facts: id, tone, inbox title, push copy, Hinglish readout, destination. */
export function buildEvent(i: EventInput, seedRead?: boolean): AlertEvent {
  const base = { type: i.type, at: i.at, tone: ALERT_TONE[i.type], ...(seedRead ? { seedRead: true } : {}) };
  const mk = (subject: string, title: string, ref: string, spoken: string, target: AlertTarget, extra: Partial<AlertEvent> = {}): AlertEvent =>
    ({ ...base, id: alertId(i.type, subject, i.at), subject, title, ref, push: `${title} · ${ref}`, spoken, target, ...extra });
  switch (i.type) {
    case 'loan.credited':
      return mk(i.lan, `${inr(i.amount)} credited for ${first(i.customer)}`, i.lan, `${first(i.customer)} ka ${spokenAmount(i.amount)} credit ho gaya.`, { screen: 'MoneyInFlight', lan: i.lan }, { amount: i.amount });
    case 'loan.disbursalInitiated':
      return mk(i.lan, `${inr(i.amount)} disbursal started for ${first(i.customer)}`, i.lan, `${first(i.customer)} ka ${spokenAmount(i.amount)} disbursal shuru hua.`, { screen: 'MoneyInFlight', lan: i.lan }, { amount: i.amount });
    case 'loan.blocker':
      return mk(i.lan, `${i.blocker} on ${first(i.customer)}'s file`, i.lan, `${first(i.customer)} ki file par ${spokenLabel(i.blocker)}.`, { screen: 'MoneyInFlight', lan: i.lan });
    case 'loan.overdue':
      return mk(i.lan, `${first(i.customer)}'s file overdue${i.blocker ? `, ${i.blocker}` : ''}`, i.lan,
        `${first(i.customer)} ki file overdue hai${i.blocker ? `, ${spokenLabel(i.blocker)}` : ''}.`, { screen: 'MoneyInFlight', lan: i.lan, filter: 'overdue' });
    case 'payout.readyToClaim':
      return mk(i.invoice, `${inr(i.amount)} payout ready to claim`, i.invoice, `${spokenAmount(i.amount)} ka payout claim ke liye ready hai.`, { screen: 'Payouts', invoice: i.invoice }, { amount: i.amount });
    case 'payout.paid':
      return mk(i.invoice, `${inr(i.amount)} commission credited`, i.invoice, `${spokenAmount(i.amount)} commission credit hua.`, { screen: 'Payouts', invoice: i.invoice }, { amount: i.amount });
    case 'payout.shortPaid': {
      const s = i.short;
      const ev = mk(`${s.invoice}#${s.lan}`, `${inr(s.difference)} difference found on commission`, `${s.invoice} · ${s.lan}`,
        `Invoice ${invTail(s.invoice)} ke commission par ${spokenAmount(s.difference)} ka difference mila.`, { screen: 'Payouts', invoice: s.invoice, lan: s.lan }, { amount: s.difference, short: s });
      return { ...ev, push: `${inr(s.difference)} difference found on ${s.invoice} commission` };
    }
  }
}

/* ---------------- Mock seeds (demo today 24 Nov 2026, 11:26) ---------------- */

export type AlertsKey = '1111' | '2222' | '3333' | 'default';
/** Which mock inbox: the three demo logins, else the default (Hero, new TW) dealer. No profile → none. */
export const alertsKeyFor = (mobile: string | null | undefined, profile: DealerProfile | null | undefined): AlertsKey | null =>
  (!profile ? null : mifKeyFor(mobile) ?? 'default');

/** Local wall-clock on the demo calendar (same convention as the Money-in-flight mock). */
const at = (daysAgo: number, hh: number, mm: number, today: Date = MIF_NOW) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hh, mm);

type Seed =
  | { type: 'loan.credited' | 'loan.disbursalInitiated'; lan: string; read?: boolean }
  | { type: 'loan.blocker'; lan: string; when: [number, number, number]; read?: boolean }
  /** Fires on the day the file crosses 4 calendar days in its stage, at hh:mm. */
  | { type: 'loan.overdue'; lan: string; time: [number, number]; read?: boolean }
  | { type: 'payout.readyToClaim' | 'payout.paid'; invoice: string; when: [number, number, number]; read?: boolean }
  | { type: 'payout.shortPaid'; invoice: string; lan: string; when: [number, number, number]; read?: boolean };

/**
 * Per login (spec §g, re-based on the v1.4.6 files): 1111 unread 3, 2222 unread 1, 3333 unread 2, default Hero unread 1.
 * 1111's two-wheeler files are USED (in Money in flight scope), so Rahul / Vikram / Pooja rows stay.
 */
const SEEDS: Record<AlertsKey, Seed[]> = {
  '1111': [
    { type: 'loan.credited', lan: 'TW-184392', read: true },            // Rahul, 9:43 AM (also the Home card's latest credit)
    { type: 'loan.credited', lan: 'TW-184388', read: true },            // Vikram, 8:52 AM
    { type: 'loan.credited', lan: 'CR-20409' },                         // Neha, 8:40 AM — unread
    { type: 'payout.readyToClaim', invoice: 'INV/26-27/1196', when: [0, 8, 15] },  // unread — ₹21,750 (statement, This month)
    // v1.4.8: the one genuine short-pay — October, CR-20320 Arjun Mehta, ₹1,150 scheme cap (payment posted this morning).
    { type: 'payout.shortPaid', invoice: 'INV/26-27/1176', lan: 'CR-20320', when: [0, 8, 5] }, // unread
    { type: 'loan.overdue', lan: 'CR-20417', time: [6, 30], read: true }, // Amit, crossed 4 days today (push held till 8:00)
    { type: 'loan.blocker', lan: 'CR-20422', when: [1, 18, 2], read: true },     // Rohan, bank a/c mismatch
    { type: 'loan.overdue', lan: 'TW-184408', time: [6, 30], read: true }, // Pooja, 22 Nov
    { type: 'loan.disbursalInitiated', lan: 'CR-20422', read: true },   // Rohan, 21 Nov
  ],
  '2222': [
    { type: 'loan.credited', lan: 'CR-20418' },                          // Meera, 10:12 AM — unread
    { type: 'loan.overdue', lan: 'CR-20430', time: [6, 30], read: true }, // Arjun, PDD hold (23 Nov)
    { type: 'payout.paid', invoice: 'INV/26-27/1194', when: [2, 16, 10], read: true },
  ],
  '3333': [
    { type: 'loan.credited', lan: 'CV-30218' },                          // Manoj, 9:58 AM — unread
    { type: 'payout.paid', invoice: 'INV/26-27/1194', when: [1, 17, 30], read: true },
    { type: 'loan.overdue', lan: 'CV-30222', time: [6, 30] },           // Ritu, insurance pending (21 Nov) — unread
  ],
  default: [
    { type: 'payout.readyToClaim', invoice: 'INV/26-27/1199', when: [0, 8, 15] }, // unread
    { type: 'payout.shortPaid', invoice: 'INV/26-27/1192', lan: 'TW-184133', when: [1, 11, 20], read: true }, // ₹600 rate difference
    { type: 'payout.paid', invoice: 'INV/26-27/1194', when: [2, 16, 10], read: true },
  ],
};

/**
 * Expected vs paid for one statement line, only when the payout statement flags it short-paid (posted, gap >= ₹100).
 * Null otherwise: a deduction or a sub-₹100 rounding never raises a short-pay alert.
 */
export function shortPayOn(invoices: readonly Invoice[], invoice: string, lan: string): ShortPay | null {
  const hit = findLine(invoices, invoice, lan);
  if (!hit) return null;
  const f = lineFigures(hit.line, hit.inv.status);
  if (!f.shortPaid) return null;
  return { invoice, lan, customer: hit.line.customer, expected: f.expected, paid: f.paid, difference: f.difference, ...(f.reason ? { reason: f.reason } : {}) };
}

/** The dealer's short-pay alert lines (the statement shows the same figures). */
export function shortPaysFor(mobile: string | null | undefined, profile: DealerProfile | null | undefined, invoices?: readonly Invoice[]): ShortPay[] {
  const key = alertsKeyFor(mobile, profile);
  if (!key) return [];
  const inv = invoices ?? statementInvoicesFor(mobile, profile);
  return SEEDS[key].flatMap((s) => (s.type === 'payout.shortPaid' ? [shortPayOn(inv, s.invoice, s.lan)].filter((x): x is ShortPay => !!x) : []));
}

function seedEvent(s: Seed, files: readonly MifFile[], invoices: readonly Invoice[]): AlertEvent | null {
  if (s.type.startsWith('loan.')) {
    const ls = s as Extract<Seed, { lan: string; type: LoanAlertType }>;
    const f = files.find((x) => x.lan === ls.lan);
    if (!f || !fileAlertable(f)) return null;
    const label = f.blocker ? BLOCKERS[f.blocker].label : undefined;
    switch (ls.type) {
      case 'loan.credited':
        return f.credited ? buildEvent({ type: ls.type, at: f.credited.at, lan: f.lan, customer: f.customer, amount: f.credited.amount }, ls.read) : null;
      case 'loan.disbursalInitiated': {
        const h = f.history.find((x) => x.stage === 'disbursalInitiated');
        return h ? buildEvent({ type: ls.type, at: h.at, lan: f.lan, customer: f.customer, amount: f.sanctioned }, ls.read) : null;
      }
      case 'loan.blocker':
        return label ? buildEvent({ type: ls.type, at: at(...ls.when), lan: f.lan, customer: f.customer, blocker: label }, ls.read) : null;
      case 'loan.overdue': {
        if (f.stage === 'credited') return null;
        const e = stageEnteredAt(f);
        const day = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 4, ls.time[0], ls.time[1]);
        if (day > MIF_NOW) return null;
        return buildEvent({ type: ls.type, at: day, lan: f.lan, customer: f.customer, ...(label ? { blocker: label } : {}) }, ls.read);
      }
    }
  }
  const ps = s as Extract<Seed, { invoice: string }>;
  const inv = invoices.find((i) => i.id === ps.invoice);
  if (!inv) return null;
  if (ps.type === 'payout.shortPaid') {
    const sp = shortPayOn(invoices, ps.invoice, ps.lan);
    return sp ? buildEvent({ type: ps.type, at: at(...ps.when), short: sp }, ps.read) : null;
  }
  return buildEvent({ type: ps.type, at: at(...ps.when), invoice: inv.id, amount: inv.amount }, ps.read);
}

/** Drop repeats of the same event id (type, subject, IST day); the first one wins. */
export function dedupe(events: readonly AlertEvent[]): AlertEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
/** Newest first. */
export const sortAlerts = (events: readonly AlertEvent[]): AlertEvent[] => [...events].sort((a, b) => b.at.getTime() - a.at.getTime());

/**
 * The dealer's seeded alerts: gated by segment (loan types only with Money in flight), never for a new-TW file,
 * deduped, newest first.
 */
export function seedAlertsFor(mobile: string | null | undefined, profile: DealerProfile | null | undefined): AlertEvent[] {
  const key = alertsKeyFor(mobile, profile);
  if (!key) return [];
  const files = mifFilesFor(mobile, profile);
  const invoices = statementInvoicesFor(mobile, profile);
  const evs = SEEDS[key].map((s) => seedEvent(s, files, invoices)).filter((e): e is AlertEvent => !!e && alertTypeAllowed(e.type, profile));
  return sortAlerts(dedupe(evs));
}

/* ---------------- Inbox state (one per dealer id) ---------------- */

/** What the dealer changed: read marks (id → ISO time) and events that arrived this session (demo injection). */
export interface InboxState { read: Record<string, string>; added: AlertEvent[] }
export const EMPTY_INBOX: InboxState = { read: {}, added: [] };

/** Seeds + arrived events, deduped (an arrived duplicate of a seed is dropped), newest first. */
export const inboxEvents = (seeds: readonly AlertEvent[], s: InboxState): AlertEvent[] => sortAlerts(dedupe([...seeds, ...s.added]));
export const isRead = (e: AlertEvent, s: InboxState): boolean => !!e.seedRead || !!s.read[e.id];
export const unreadOf = (events: readonly AlertEvent[], s: InboxState): AlertEvent[] => events.filter((e) => !isRead(e, s));
export const unreadCount = (events: readonly AlertEvent[], s: InboxState): number => unreadOf(events, s).length;

export const markRead = (s: InboxState, id: string, now: Date): InboxState => (s.read[id] ? s : { ...s, read: { ...s.read, [id]: now.toISOString() } });
export function markAllRead(s: InboxState, events: readonly AlertEvent[], now: Date): InboxState {
  const read = { ...s.read };
  for (const e of events) if (!e.seedRead && !read[e.id]) read[e.id] = now.toISOString();
  return { ...s, read };
}

export type AddResult = { state: InboxState; added: boolean; reason?: 'duplicate' | 'typeOff' | 'gated' };
/**
 * A new event arrives (refresh / feed / demo). Ignored when its id is already in the inbox (dedupe: one per type,
 * subject, day — a refresh never makes a second "Neha credited"), when its type is switched off, or when the dealer's
 * segment does not get that type.
 */
export function addEvent(s: InboxState, seeds: readonly AlertEvent[], ev: AlertEvent, prefs: AlertPrefs, profile: GateProfile): AddResult {
  if (!alertTypeAllowed(ev.type, profile)) return { state: s, added: false, reason: 'gated' };
  if (seeds.some((e) => e.id === ev.id) || s.added.some((e) => e.id === ev.id)) return { state: s, added: false, reason: 'duplicate' };
  if (!prefs.types[ev.type]) return { state: s, added: false, reason: 'typeOff' };
  return { state: { ...s, added: [...s.added, { ...ev, seedRead: undefined }] }, added: true };
}

/** Saved inbox (JSON with ISO dates) → state; anything malformed is dropped. */
export function reviveInbox(raw: string | null | undefined): InboxState {
  if (!raw) return { read: {}, added: [] };
  try {
    const p = JSON.parse(raw) as { read?: Record<string, string>; added?: (Omit<AlertEvent, 'at'> & { at: string })[] };
    const added = Array.isArray(p.added)
      ? p.added.filter((e) => e && typeof e.id === 'string' && (ALERT_TYPES as readonly string[]).includes(e.type) && !Number.isNaN(Date.parse(e.at)))
        .map((e) => ({ ...e, at: new Date(e.at) }) as AlertEvent)
      : [];
    return { read: p.read && typeof p.read === 'object' ? p.read : {}, added };
  } catch { return { read: {}, added: [] }; }
}

/* ---------------- Inbox views ---------------- */

export type AlertFilter = 'all' | AlertCategory;
export const ALERT_FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'loan', label: 'Loan money' }, { id: 'payout', label: 'Payouts' },
];
export const filterAlerts = (events: readonly AlertEvent[], f: AlertFilter): AlertEvent[] => (f === 'all' ? [...events] : events.filter((e) => categoryOf(e.type) === f));
/** Chip counts are UNREAD, not totals. */
export function unreadByFilter(events: readonly AlertEvent[], s: InboxState): Record<AlertFilter, number> {
  const u = unreadOf(events, s);
  return { all: u.length, loan: u.filter((e) => categoryOf(e.type) === 'loan').length, payout: u.filter((e) => categoryOf(e.type) === 'payout').length };
}
/** "Today" / "Earlier" groups (demo calendar). */
export function groupAlerts(events: readonly AlertEvent[], now: Date = MIF_NOW): { title: 'Today' | 'Earlier'; items: AlertEvent[] }[] {
  const today = events.filter((e) => calendarDays(e.at, now) === 0 && e.at.getFullYear() === now.getFullYear());
  const earlier = events.filter((e) => !today.includes(e));
  return [{ title: 'Today' as const, items: today }, { title: 'Earlier' as const, items: earlier }].filter((g) => g.items.length);
}
/** Caption: "Today, 8:40 AM · CR-20409". */
export const alertCaption = (e: AlertEvent, now: Date = MIF_NOW): string => `${fmtWhen(e.at, now)} · ${e.ref}`;
/** Under the caption, for the push channel: "Push held until 8:00 AM" when the event fell in quiet hours. */
export function heldNote(e: AlertEvent, prefs: AlertPrefs): string | undefined {
  const p = planPush(e, prefs);
  return p.send && p.held && p.deliverAt ? `Push held until ${istTimeLabel(p.deliverAt)}` : undefined;
}

/* ---------------- Readout (Hinglish, Piper) ---------------- */

const COUNT_WORD = ['Koi', 'Ek', 'Do', 'Teen', 'Chaar', 'Paanch', 'Chhe', 'Saat', 'Aath', 'Nau'];
const countWord = (n: number) => COUNT_WORD[n] ?? String(n);

/**
 * "read my alerts": up to the three latest unread (or today's, when everything is read), one sentence each.
 * Never a mobile number (only first names, amounts and invoice tails are in the sentences).
 */
export function readoutLine(events: readonly AlertEvent[], s: InboxState, now: Date = MIF_NOW, max = 3): string {
  const unread = unreadOf(events, s);
  if (unread.length) {
    const head = unread.length === 1 ? 'Ek naya alert.' : `${countWord(unread.length)} naye alerts.`;
    return [head, ...unread.slice(0, max).map((e) => e.spoken)].join(' ');
  }
  const today = events.filter((e) => calendarDays(e.at, now) === 0);
  if (today.length) return ['Koi naya alert nahi. Aaj ke alerts.', ...today.slice(0, max).map((e) => e.spoken)].join(' ');
  return 'Koi naya alert nahi hai.';
}
/** Short line for "alerts dikhao" (opens the inbox): the count, and the latest unread. */
export function alertsSummaryLine(events: readonly AlertEvent[], s: InboxState): string {
  const unread = unreadOf(events, s);
  if (!unread.length) return 'Koi naya alert nahi hai.';
  return `${unread.length === 1 ? 'Ek naya alert' : `${countWord(unread.length)} naye alerts`}. ${unread[0]!.spoken}`;
}
/** Zippy / Piper line when one new alert arrives. */
export const newAlertLine = (e: AlertEvent): string => `Naya alert. ${e.spoken}`;

/* ---------------- Demo arrival ---------------- */

/**
 * A commission credit to "arrive" in the demo (settings / inbox demo card): the dealer's next Claimed invoice is paid.
 * `night` = the same kind of event at 11:30 PM tonight (inside quiet hours: inbox row now, push held, no readout).
 * Uses a different invoice for each, so both can be tried; a second try is a duplicate (dedupe).
 */
export function demoArrival(mobile: string | null | undefined, profile: DealerProfile | null | undefined, night: boolean, now: Date = MIF_NOW): AlertEvent | null {
  const claimed = statementInvoicesFor(mobile, profile).filter((i) => i.status === 'Claimed');
  const inv = claimed[night ? 1 : 0];
  if (!inv) return null;
  const when = night ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30) : now;
  return buildEvent({ type: 'payout.paid', at: when, invoice: inv.id, amount: inv.amount });
}
