import { fmtDayMonth } from '../services/business';
/** Tiny shared stores (no extra deps): date filter shared by Payouts / Portfolio / Cases, and RC pendency state for the Home badge. */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { advancePosition, Invoice, InvoiceStatus, Limit, RcCase, TODAY, Tranche, trancheStatus, WcApplication } from '../services/business';
import { secureStorage } from '../utils/secureStorage';

function createStore<T>(initial: T) {
  let value = initial; const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T | ((p: T) => T)) => { value = typeof v === 'function' ? (v as (p: T) => T)(value) : v; subs.forEach((s) => s()); },
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

/* Date range */
export type Preset = 'thisMonth' | 'lastMonth' | 'custom';
export interface DateRange { preset: Preset; from: Date; to: Date }
export function presetRange(p: Exclude<Preset, 'custom'>): DateRange {
  const y = TODAY.getFullYear(); const m = TODAY.getMonth();
  return p === 'thisMonth' ? { preset: p, from: new Date(y, m, 1), to: new Date(TODAY) } : { preset: p, from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
}
export const dateRangeStore = createStore<DateRange>(presetRange('thisMonth'));
export function useDateRange(): [DateRange, (r: DateRange) => void] {
  const v = useSyncExternalStore(dateRangeStore.subscribe, dateRangeStore.get, dateRangeStore.get);
  return [v, dateRangeStore.set];
}
export const inRange = (d: Date, r: DateRange) => d >= new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate()) && d <= new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate(), 23, 59, 59);
export const rangeLabel = (r: DateRange) => {
  const f = fmtDayMonth;
  return r.preset === 'thisMonth' ? `This month · ${f(r.from)} – ${f(r.to)}` : r.preset === 'lastMonth' ? `Last month · ${f(r.from)} – ${f(r.to)}` : `${f(r.from)} – ${f(r.to)} ${r.to.getFullYear()}`;
};

/* ---------------- Per-dealer payout claims + RC submissions ----------------
 * The mock generators (invoicesFor / rcCasesFor) stay the seed; the stores hold only what the dealer
 * changed (claimed invoices, submitted RCs), keyed by dealer id so profiles never mix. Home tiles and
 * the Payouts / RC screens all derive from seed + overlay, so one claim or submit updates every view.
 * Overlays are mirrored to secureStorage and hydrated before the signed-in UI first renders. */

export interface InvoiceClaim { status: Exclude<InvoiceStatus, 'Not claimed'>; ref?: string; claimedOn: string }
export interface RcSubmission { regNo?: string; photo?: string; submittedOn: string }
type Overlay<T> = Record<string, Record<string, T>>;

export const invoiceStore = createStore<Overlay<InvoiceClaim>>({});
export const rcStore = createStore<Overlay<RcSubmission>>({});
/** Advance payouts taken, keyed by UTR. `outstanding` is what is still to be netted off future payouts. */
export interface AdvanceRecord { amount: number; fee: number; net: number; utr: string; takenOn: string; outstanding: number }
export const advanceStore = createStore<Overlay<AdvanceRecord>>({});

const CLAIMS_KEY = 'boom.payoutClaims.';
const RC_KEY = 'boom.rcSubmitted.';
const ADVANCE_KEY = 'boom.payoutAdvances.';
/** SecureStore keys allow only [A-Za-z0-9._-]. */
const keyFor = (prefix: string, dealerId: string) => prefix + dealerId.replace(/[^A-Za-z0-9._-]/g, '_');
const persistable = (dealerId: string) => dealerId !== 'anon';

async function load<T>(key: string): Promise<Record<string, T>> {
  try { const raw = await secureStorage.get(key); return raw ? (JSON.parse(raw) as Record<string, T>) : {}; } catch { return {}; }
}
function save<T>(key: string, v: Record<string, T>) {
  secureStorage.set(key, JSON.stringify(v)).catch(() => { /* in-memory state still correct this session */ });
}

const hydrated = new Map<string, Promise<void>>();
/**
 * Load a dealer's saved claims, RC submissions, advance payouts, TA / INF facility and working-capital
 * application once per launch. Await before showing signed-in screens.
 */
export function hydrateDealerStores(dealerId: string): Promise<void> {
  if (!persistable(dealerId)) return Promise.resolve();
  let p = hydrated.get(dealerId);
  if (!p) {
    const raw = (key: string) => secureStorage.get(key).catch(() => null);
    p = Promise.all([
      load<InvoiceClaim>(keyFor(CLAIMS_KEY, dealerId)), load<RcSubmission>(keyFor(RC_KEY, dealerId)), load<AdvanceRecord>(keyFor(ADVANCE_KEY, dealerId)),
      raw(TAINF_KEY(dealerId)), raw(WC_KEY(dealerId)),
    ]).then(([claims, rcs, adv, tainf, wc]) => {
      // Anything changed in memory meanwhile wins over the saved copy.
      invoiceStore.set((o) => ({ ...o, [dealerId]: { ...claims, ...o[dealerId] } }));
      rcStore.set((o) => ({ ...o, [dealerId]: { ...rcs, ...o[dealerId] } }));
      advanceStore.set((o) => ({ ...o, [dealerId]: { ...adv, ...o[dealerId] } }));
      const limit = reviveLimit(tainf);
      if (limit) taInfStore.set((o) => (o[dealerId] ? o : { ...o, [dealerId]: limit }));
      const app = parseApplication(wc);
      wcApplyStore.set((o) => (o[dealerId] ? o : { ...o, [dealerId]: app }));
    });
    hydrated.set(dealerId, p);
  }
  return p;
}

const STATUS_RANK: Record<InvoiceStatus, number> = { 'Not claimed': 0, Claimed: 1, Paid: 2 };
const EMPTY: Record<string, never> = {};

/** Seeded invoices with this dealer's claims applied (a seed that has since moved to Paid stays Paid). */
export function useInvoices(dealerId: string, seed: Invoice[]): Invoice[] {
  const all = useSyncExternalStore(invoiceStore.subscribe, invoiceStore.get, invoiceStore.get);
  const claims = all[dealerId] ?? EMPTY;
  return useMemo(() => seed.map((i) => {
    const c = claims[i.id];
    return c && STATUS_RANK[c.status] > STATUS_RANK[i.status] ? { ...i, status: c.status } : i;
  }), [seed, claims]);
}
export function markInvoiceClaimed(dealerId: string, id: string, ref?: string) {
  invoiceStore.set((o) => ({ ...o, [dealerId]: { ...o[dealerId], [id]: { status: 'Claimed', ref, claimedOn: new Date().toISOString() } } }));
  if (persistable(dealerId)) save(keyFor(CLAIMS_KEY, dealerId), invoiceStore.get()[dealerId] ?? {});
}

/** Local picker URIs only; never persist inline data: URIs (web) into the Keychain / localStorage. */
const keepPhoto = (uri?: string) => (uri && !uri.startsWith('data:') && uri.length <= 300 ? uri : undefined);

const withSubmissions = (seed: RcCase[], subs: Record<string, RcSubmission>) => seed.map((c): RcCase => {
  const s = subs[c.lan];
  return s ? { ...c, status: 'Submitted', regNo: s.regNo, photo: s.photo, submittedOn: new Date(s.submittedOn) } : c;
});

/** Seeded RC cases with this dealer's submissions applied. The setter always notifies and is persisted. */
export function useRcCases(dealerId: string, seed: RcCase[]): [RcCase[], (fn: (p: RcCase[]) => RcCase[]) => void] {
  const all = useSyncExternalStore(rcStore.subscribe, rcStore.get, rcStore.get);
  const subs = all[dealerId] ?? EMPTY;
  const cases = useMemo(() => withSubmissions(seed, subs), [seed, subs]);
  const setCases = useCallback((fn: (p: RcCase[]) => RcCase[]) => {
    rcStore.set((o) => {
      const current = withSubmissions(seed, o[dealerId] ?? EMPTY);
      const next: Record<string, RcSubmission> = {};
      for (const c of fn(current)) {
        if (c.status === 'Submitted') next[c.lan] = { regNo: c.regNo, photo: keepPhoto(c.photo), submittedOn: (c.submittedOn ?? new Date()).toISOString() };
      }
      return { ...o, [dealerId]: next };
    });
    if (persistable(dealerId)) save(keyFor(RC_KEY, dealerId), rcStore.get()[dealerId] ?? {});
  }, [dealerId, seed]);
  return [cases, setCases];
}

/**
 * Advance payout position for a dealer, from the same invoices as the Payouts chart (pass useInvoices output).
 * Not filtered by the shared date range: always the chart's last three calendar months.
 */
export function useAdvance(dealerId: string, invoices: Invoice[]) {
  const all = useSyncExternalStore(advanceStore.subscribe, advanceStore.get, advanceStore.get);
  const recs = all[dealerId] ?? EMPTY;
  return useMemo(() => {
    const records = Object.values(recs).sort((a, b) => (a.takenOn < b.takenOn ? 1 : -1));
    return { ...advancePosition(invoices, records.map((r) => r.outstanding)), records };
  }, [invoices, recs]);
}
export function recordAdvance(dealerId: string, r: Omit<AdvanceRecord, 'takenOn' | 'outstanding'>) {
  advanceStore.set((o) => ({ ...o, [dealerId]: { ...o[dealerId], [r.utr]: { ...r, takenOn: new Date().toISOString(), outstanding: r.amount } } }));
  if (persistable(dealerId)) save(keyFor(ADVANCE_KEY, dealerId), advanceStore.get()[dealerId] ?? {});
}

/*
 * TA / INF facility (keyed by dealer id). The live Limit — balances and tranches — that the Home tile
 * and the TA / INF screen both read. The saved copy is loaded by hydrateDealerStores before the first
 * signed-in paint; a dealer with no saved state starts from the mock generator, and saved drawdowns /
 * repayments are never re-seeded over (no flash of the full seeded limit).
 */
export const taInfStore = createStore<Record<string, Limit>>({});
const safeKey = (dealerId: string) => dealerId.replace(/[^A-Za-z0-9._-]/g, '_');
const TAINF_KEY = (dealerId: string) => `firstgo.tainf.${safeKey(dealerId)}`;

type SavedTranche = Omit<Tranche, 'due' | 'paidOn'> & { due: string; paidOn?: string };
export function reviveLimit(raw: string | null): Limit | null {
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Omit<Limit, 'tranches'> & { tranches: SavedTranche[] };
    if (!l || (l.key !== 'TA' && l.key !== 'INF') || !Array.isArray(l.tranches) || typeof l.utilised !== 'number') return null;
    const tranches = l.tranches.map((t): Tranche => {
      const x: Tranche = { ...t, due: new Date(t.due), paidOn: t.paidOn ? new Date(t.paidOn) : undefined };
      return { ...x, status: trancheStatus(x) };
    });
    return { ...l, tranches };
  } catch { return null; }
}

/**
 * The facility to show: the live (saved / updated) one when it matches the dealer's facility type,
 * else the seed. A saved limit for another facility type (profile changed) is stale. PURE.
 */
export function pickLimit(live: Limit | undefined, seed: Limit | null): Limit | null {
  if (!seed) return null;
  return live && live.key === seed.key ? live : seed;
}

/**
 * Live facility for a dealer: `null` when the dealer has no TA / INF. `seed` is the mock generator for
 * that dealer (taInfFor(profile)). Kept as `Limit | null | undefined` for callers' loading states.
 */
export function useTaInf(dealerId: string | undefined, seed: () => Limit | null): Limit | null | undefined {
  const all = useSyncExternalStore(taInfStore.subscribe, taInfStore.get, taInfStore.get);
  const id = dealerId ?? 'anon';
  const live = all[id];
  const s = seed();
  const shown = pickLimit(live, s);
  // Put the seed in the store so drawdowns / repayments have a base to apply to.
  useEffect(() => { if (shown && shown !== live) taInfStore.set((p) => (p[id] === live ? { ...p, [id]: shown } : p)); }, [id, shown, live]);
  return shown;
}

/** Apply a drawdown / repayment: subscribers update immediately, then the new state is persisted. */
export function updateTaInf(dealerId: string | undefined, fn: (l: Limit) => Limit) {
  const id = dealerId ?? 'anon';
  const cur = taInfStore.get()[id];
  if (!cur) return;
  const next = fn(cur);
  taInfStore.set((p) => ({ ...p, [id]: next }));
  if (persistable(id)) secureStorage.set(TAINF_KEY(id), JSON.stringify(next)).catch(() => {});
}

/*
 * Working-capital application for a dealer with no TA / INF (keyed by dealer id, persisted, hydrated
 * in hydrateDealerStores). One application at a time: once submitted, both Apply CTAs show the pending state.
 */
export const wcApplyStore = createStore<Record<string, WcApplication | null>>({});
const WC_KEY = (dealerId: string) => `firstgo.wcapply.${safeKey(dealerId)}`;
export function parseApplication(raw: string | null): WcApplication | null {
  if (!raw) return null;
  try { const a = JSON.parse(raw) as WcApplication; return a && typeof a.ref === 'string' && (a.facility === 'TA' || a.facility === 'INF') ? a : null; } catch { return null; }
}
/** The dealer's pending application, or `null` when they have not applied. */
export function useWcApplication(dealerId: string | undefined): WcApplication | null | undefined {
  const all = useSyncExternalStore(wcApplyStore.subscribe, wcApplyStore.get, wcApplyStore.get);
  return all[dealerId ?? 'anon'] ?? null;
}
export function saveWcApplication(dealerId: string | undefined, a: WcApplication) {
  const id = dealerId ?? 'anon';
  wcApplyStore.set((p) => ({ ...p, [id]: a }));
  if (persistable(id)) secureStorage.set(WC_KEY(id), JSON.stringify(a)).catch(() => {});
}
