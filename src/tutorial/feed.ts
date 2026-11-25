/**
 * Reels-style shorts feed helpers (v1.3.0). PURE: ordering, the "Try it now" target, which pages get
 * a player, the swipe hint and TTFF formatting. Unit-tested in Node.
 */
import { SHORT_IDS } from './shortMap';

/**
 * Feed order: the shorts in journey order (what a dealer does first comes first), then any extra
 * shorts from the remote manifest, and the 90 s full tutorial LAST — a long-form video in the middle
 * would break the snackable swipe rhythm, but it stays reachable at the end (and from the Help hero).
 * Sign-in is irrelevant once signed in, so it moves to the end too (before the full tutorial).
 */
const JOURNEY_ORDER: readonly string[] = [
  'scan-offer', 'vehicle-emi', 'ekyc', 'mandate', 'esign', 'docs-disbursal',
  'payouts-utr', 'portfolio-cases-rc', 'tainf', 'zippy-voice',
];

export function feedOrder(ids: readonly string[], opts: { signedIn: boolean } = { signedIn: true }): string[] {
  const set = new Set(ids);
  const known = JOURNEY_ORDER.filter((id) => set.has(id));
  const extras = ids.filter((id) => !JOURNEY_ORDER.includes(id) && id !== 'full' && id !== 'login');
  const login = set.has('login') ? ['login'] : [];
  const out = opts.signedIn ? [...known, ...extras, ...login] : [...login, ...known, ...extras];
  if (set.has('full')) out.push('full');
  return out;
}

/** Index to open the feed at (unknown id → 0). */
export const startIndexFor = (order: readonly string[], startId?: string | null): number => {
  const i = startId ? order.indexOf(startId) : -1;
  return i >= 0 ? i : 0;
};

/** Journey screens that read the active loan; opening them without a case would show stale data. */
const NEEDS_CASE: ReadonlySet<string> = new Set(['Asset', 'FaceKyc', 'Mandate', 'Esign', 'Docs']);

/** Short id → the screen "Try it now" opens (null = no CTA). */
export const CTA_ROUTE: Readonly<Record<string, string | null>> = {
  // Already signed in when watching; there is nothing to "try" for sign-in.
  login: null,
  'scan-offer': 'ScanQr',
  'vehicle-emi': 'Asset',
  ekyc: 'FaceKyc',
  mandate: 'Mandate',
  esign: 'Esign',
  'docs-disbursal': 'Docs',
  'payouts-utr': 'Payouts',
  'portfolio-cases-rc': 'Portfolio',
  tainf: 'TaInf',
  'zippy-voice': 'Home',
  full: 'ScanQr',
};

/**
 * Where "Try it now" goes. Journey screens only open directly when a loan case is in progress
 * (`inJourney`); otherwise the safe entry, Scan QR, which starts one. Signed out → no CTA (the feed's
 * targets are all main-stack screens). TA / INF only for dealers that have it.
 */
export function ctaRouteFor(id: string, ctx: { signedIn: boolean; inJourney: boolean; hasTaInf?: boolean }): string | null {
  if (!ctx.signedIn) return null;
  const r = CTA_ROUTE[id];
  if (!r) return null;
  if (r === 'TaInf' && ctx.hasTaInf === false) return null;
  if (NEEDS_CASE.has(r) && !ctx.inJourney) return 'ScanQr';
  return r;
}

/** Is a loan case open? True when the navigation stack contains a journey screen. */
export const inJourney = (stackRouteNames: readonly string[]): boolean => stackRouteNames.some((r) => NEEDS_CASE.has(r));

/**
 * Pages that get a live player: the active one plus `ahead` pages after it (preloaded, paused) — at
 * most 1 + ahead players. Pages behind are released (their poster shows instantly on the way back).
 * `skip` (coming-soon pages) never get a player.
 */
export function playerWindow(active: number, count: number, ahead = 2, skip: (i: number) => boolean = () => false): number[] {
  const out: number[] = [];
  for (let i = active; i < count && i <= active + ahead; i++) if (i >= 0 && !skip(i)) out.push(i);
  return out;
}

/** Show the swipe hint: forced (web ?feedhint=1), or the first time ever and there is a next page. */
export const shouldShowSwipeHint = (o: { seenBefore: boolean; forced: boolean; count: number; startIndex: number }): boolean =>
  o.forced || (!o.seenBefore && o.startIndex < o.count - 1);

/** 0..1 progress, safe for 0 / NaN durations. */
export const progressOf = (t: number, d: number): number => (d > 0 && Number.isFinite(t) ? Math.min(1, Math.max(0, t / d)) : 0);

/** Dev log line for time-to-first-frame (no PII: short id, source kind, ms). */
export const ttffLine = (id: string, kind: string, ms: number): string => `[tutorial] ttff ${id} ${kind} ${Math.round(ms)} ms`;
