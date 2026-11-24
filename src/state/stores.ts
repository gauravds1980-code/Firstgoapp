import { fmtDayMonth } from '../services/business';
/** Tiny shared stores (no extra deps): date filter shared by Payouts / Portfolio / Cases, and RC pendency state for the Home badge. */
import { useSyncExternalStore } from 'react';
import { RcCase, TODAY } from '../services/business';

function createStore<T>(initial: T) {
  let value = initial; const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T | ((p: T) => T)) => { value = typeof v === 'function' ? (v as (p: T) => T)(value) : v; subs.forEach((s) => s()); },
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    /** Seed without notifying (safe during render). */
    seed: (fn: (p: T) => T) => { value = fn(value); },
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

/* RC pendency (keyed by dealer id so profiles don't mix) */
export const rcStore = createStore<Record<string, RcCase[]>>({});
export function useRcCases(dealerId: string, seed: () => RcCase[]): [RcCase[], (fn: (p: RcCase[]) => RcCase[]) => void] {
  const all = useSyncExternalStore(rcStore.subscribe, rcStore.get, rcStore.get);
  if (!all[dealerId]) { const s = seed(); rcStore.seed((p) => ({ ...p, [dealerId]: s })); return [s, (fn) => rcStore.set((p) => ({ ...p, [dealerId]: fn(p[dealerId] ?? s) }))]; }
  return [all[dealerId]!, (fn) => rcStore.set((p) => ({ ...p, [dealerId]: fn(p[dealerId] ?? []) }))];
}
