/**
 * Shared date filter periods (Payouts statement, Portfolio, Cases). Pure: unit-tested in Node.
 * v1.4.8: "Last 3 months" preset (statement spec §d) and the approved default period (Gaurav #2): This month.
 */
import { MONTHS, TODAY } from './business';

export type Preset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom';
export interface DateRange { preset: Preset; from: Date; to: Date }

/** The period every date filter starts on (approved: This month — claim-first, and it holds the ready-to-claim). */
export const DEFAULT_PRESET: Exclude<Preset, 'custom'> = 'thisMonth';

export function presetRange(p: Exclude<Preset, 'custom'>, today: Date = TODAY): DateRange {
  const y = today.getFullYear(); const m = today.getMonth();
  if (p === 'thisMonth') return { preset: p, from: new Date(y, m, 1), to: new Date(today) };
  if (p === 'lastMonth') return { preset: p, from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
  return { preset: p, from: new Date(y, m - 2, 1), to: new Date(today) };
}
export const defaultRange = (today: Date = TODAY): DateRange => presetRange(DEFAULT_PRESET, today);

/** Whole calendar month `m` of year `y` (to today at most) as a custom range — "October ka statement". */
export function monthRange(y: number, m: number, today: Date = TODAY): DateRange {
  const end = new Date(y, m + 1, 0);
  return { preset: 'custom', from: new Date(y, m, 1), to: end > today ? new Date(today) : end };
}

export const inRange = (d: Date, r: DateRange) =>
  d >= new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate()) && d <= new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate(), 23, 59, 59);

/** The narrowest preset that holds `d` (This month, Last month, Last 3 months), else its own calendar month. */
export function rangeContaining(d: Date, today: Date = TODAY): DateRange {
  const pick = (['thisMonth', 'lastMonth', 'last3Months'] as const).map((p) => presetRange(p, today)).find((r) => inRange(d, r));
  return pick ?? monthRange(d.getFullYear(), d.getMonth(), today);
}

const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
export const rangeLabel = (r: DateRange) =>
  r.preset === 'thisMonth' ? `This month · ${dm(r.from)} – ${dm(r.to)}`
    : r.preset === 'lastMonth' ? `Last month · ${dm(r.from)} – ${dm(r.to)}`
      : r.preset === 'last3Months' ? `Last 3 months · ${dm(r.from)} – ${dm(r.to)}`
        : `${dm(r.from)} – ${dm(r.to)} ${r.to.getFullYear()}`;

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fullMonth = (m: number) => FULL_MONTHS[m]!;
/** Statement heading: "November 2026 · 1–24 Nov", "Sep – Nov 2026 · 1 Sep – 24 Nov". */
export function periodTitle(r: DateRange): string {
  const sameMonth = r.from.getFullYear() === r.to.getFullYear() && r.from.getMonth() === r.to.getMonth();
  if (sameMonth) return `${fullMonth(r.from.getMonth())} ${r.from.getFullYear()} · ${r.from.getDate()}–${r.to.getDate()} ${MONTHS[r.to.getMonth()]}`;
  return `${MONTHS[r.from.getMonth()]} – ${MONTHS[r.to.getMonth()]} ${r.to.getFullYear()} · ${r.from.getDate()} ${MONTHS[r.from.getMonth()]} – ${r.to.getDate()} ${MONTHS[r.to.getMonth()]}`;
}
/** Spoken period name: "November", "Sep to Nov". */
export function periodSpoken(r: DateRange): string {
  const sameMonth = r.from.getFullYear() === r.to.getFullYear() && r.from.getMonth() === r.to.getMonth();
  return sameMonth ? fullMonth(r.from.getMonth()) : `${fullMonth(r.from.getMonth())} to ${fullMonth(r.to.getMonth())}`;
}
