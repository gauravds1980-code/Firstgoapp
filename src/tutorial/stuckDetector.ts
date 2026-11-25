/**
 * Zippy "drop a short" trigger logic (v1.3.0). PURE: no React Native imports, every method takes the
 * current time, so it runs and is unit-tested in plain Node (npm run test:voice).
 *
 * Two kinds of offers:
 *  - first visit: the dealer opens a screen whose intro offer has not been made yet → offer its short
 *    FIRST_VISIT_DELAY_MS after the screen settles. A screen counts as "introduced" once the offer was
 *    actually shown (or its short was already watched), so an offer blocked by the cooldown / cap is
 *    tried again on the next visit instead of being lost.
 *  - stuck: the dealer seems stuck on a screen —
 *      idle        no activity and no route change for IDLE_MS;
 *      back-nav    >= BACK_THRESHOLD back navigations away from / back to the same screen within WINDOW_MS;
 *      validation  >= ERROR_THRESHOLD validation errors on the same screen within WINDOW_MS.
 *
 * Rules for both kinds: global toggle on; nothing suppressing (sheet / modal / player / voice listening /
 * Undo toast / a bubble already up); the screen maps to a short and is not a celebration / success
 * screen; not "don't show again" for that screen; each screen at most once per session; at most
 * SESSION_CAP offers per session; and COOLDOWN_MS after any offer before the next one.
 */

export type NudgeReason = 'first-visit' | 'idle' | 'back-nav' | 'validation' | 'forced';

export type NudgeTrigger = {
  /** The screen the offer is about (its short is offered). */
  screen: string;
  shortId: string;
  reason: NudgeReason;
  at: number;
};

export const IDLE_MS = 20_000;
export const WINDOW_MS = 60_000;
export const BACK_THRESHOLD = 2;
export const ERROR_THRESHOLD = 2;
export const COOLDOWN_MS = 3 * 60_000;
export const SESSION_CAP = 3;
export const FIRST_VISIT_DELAY_MS = 1_500;

/** Never offered on these: the offer celebration, the disbursal success screen and the shorts feed itself. */
export const NEVER_NUDGE_SCREENS: ReadonlySet<string> = new Set(['OfferReveal', 'Disbursal', 'ShortsFeed']);

export type DetectorOptions = {
  /** Screen → short id, or null when the screen has no short. */
  shortFor: (screen: string) => string | null;
  idleMs?: number;
  windowMs?: number;
  cooldownMs?: number;
  sessionCap?: number;
  firstVisitDelayMs?: number;
  /** Called when a screen becomes "introduced" (persist it). */
  onIntroduced?: (screen: string) => void;
};

type Stamp = { screen: string; at: number };

export class StuckDetector {
  private readonly o: Required<Omit<DetectorOptions, 'onIntroduced'>> & Pick<DetectorOptions, 'onIntroduced'>;
  private screen: string | null = null;
  /** Last activity or route change on the current screen. */
  private lastActivity = 0;
  private pendingFirstVisit: { screen: string; dueAt: number } | null = null;
  private backs: Stamp[] = [];
  private errors: Stamp[] = [];
  private suppressors = new Set<string>();
  private enabled = true;
  private introduced = new Set<string>();
  private dontShow = new Set<string>();
  private watched = new Set<string>();
  // Session state (in memory only).
  private shownScreens = new Set<string>();
  private shownCount = 0;
  private lastShownAt: number | null = null;

  constructor(opts: DetectorOptions) {
    this.o = {
      idleMs: IDLE_MS, windowMs: WINDOW_MS, cooldownMs: COOLDOWN_MS, sessionCap: SESSION_CAP, firstVisitDelayMs: FIRST_VISIT_DELAY_MS,
      ...opts,
    };
  }

  // ---- Persisted preferences (hydrated by the app) ----
  setEnabled(on: boolean) { this.enabled = on; if (!on) this.pendingFirstVisit = null; }
  isEnabled() { return this.enabled; }
  setIntroduced(screens: Iterable<string>) { this.introduced = new Set(screens); }
  setDontShow(screens: Iterable<string>) { this.dontShow = new Set(screens); }
  addDontShow(screen: string) { this.dontShow.add(screen); if (this.pendingFirstVisit?.screen === screen) this.pendingFirstVisit = null; }
  setWatched(shortIds: Iterable<string>) { this.watched = new Set(shortIds); }
  addWatched(shortId: string) { this.watched.add(shortId); }

  // ---- Suppression (sheet, modal, player, voice, undo toast, bubble) ----
  suppress(key: string, on: boolean, at: number) {
    const was = this.suppressors.size > 0;
    if (on) this.suppressors.add(key); else this.suppressors.delete(key);
    // Leaving a sheet / player counts as activity: the idle clock restarts from there.
    if (was && this.suppressors.size === 0) this.lastActivity = at;
  }
  isSuppressed() { return this.suppressors.size > 0; }

  get currentScreen() { return this.screen; }

  // ---- Signals ----
  /** Route change. `back` = the dealer went back (pop / back gesture / returning to an earlier route). */
  navigate(to: string, at: number, back = false): NudgeTrigger | null {
    const from = this.screen;
    this.screen = to;
    this.lastActivity = at;
    this.pendingFirstVisit = null;
    let trigger: NudgeTrigger | null = null;
    if (back && from && from !== to) {
      this.backs.push({ screen: from, at }, { screen: to, at });
      this.prune(at);
      // The screen they keep backing out of is the one they are stuck on; else the one they keep landing on.
      const subject = [from, to].find((s) => this.count(this.backs, s) >= BACK_THRESHOLD);
      if (subject) {
        trigger = this.offer(subject, 'back-nav', at);
        if (trigger) this.backs = this.backs.filter((b) => b.screen !== subject);
      }
    }
    if (!trigger && !this.introduced.has(to) && this.firstVisitEligible(to)) {
      this.pendingFirstVisit = { screen: to, dueAt: at + this.o.firstVisitDelayMs };
    }
    return trigger;
  }

  /** Any touch / keystroke / scroll. */
  activity(at: number) { this.lastActivity = at; }

  /** A validation error on `screen` (defaults to the current screen). */
  validationError(at: number, screen?: string): NudgeTrigger | null {
    const s = screen ?? this.screen;
    if (!s) return null;
    this.lastActivity = at;
    this.errors.push({ screen: s, at });
    this.prune(at);
    if (this.count(this.errors, s) < ERROR_THRESHOLD) return null;
    const t = this.offer(s, 'validation', at);
    if (t) this.errors = this.errors.filter((e) => e.screen !== s);
    return t;
  }

  /** Call about once a second: fires the first-visit offer and the idle signal. */
  tick(at: number): NudgeTrigger | null {
    const s = this.screen;
    if (!s) return null;
    const fv = this.pendingFirstVisit;
    if (fv && fv.screen === s && at >= fv.dueAt) {
      // Wait out a sheet / player / voice on the same visit; drop it once the screen is left.
      if (this.isSuppressed()) return null;
      this.pendingFirstVisit = null;
      const t = this.offer(s, 'first-visit', at);
      if (t) return t;
    }
    if (at - this.lastActivity >= this.o.idleMs) {
      // One idle evaluation per quiet stretch: restart the clock whether or not it is shown.
      const t = this.isSuppressed() ? null : this.offer(s, 'idle', at);
      if (!this.isSuppressed()) this.lastActivity = at;
      return t;
    }
    return null;
  }

  /** Web screenshot hook (?nudge=1): offer the current screen's short now, ignoring the rules. */
  force(at: number): NudgeTrigger | null {
    const s = this.screen;
    const shortId = s ? this.o.shortFor(s) : null;
    if (!s || !shortId) return null;
    return { screen: s, shortId, reason: 'forced', at };
  }

  /** "Don't show again" etc. are applied by the caller; this reports why a screen would be blocked. */
  blockReason(screen: string, at: number): string | null {
    if (!this.enabled) return 'disabled';
    if (this.isSuppressed()) return 'suppressed';
    if (this.screen && NEVER_NUDGE_SCREENS.has(this.screen)) return 'celebration';
    if (NEVER_NUDGE_SCREENS.has(screen)) return 'celebration';
    if (!this.o.shortFor(screen)) return 'no-short';
    if (this.dontShow.has(screen)) return 'dont-show';
    if (this.shownScreens.has(screen)) return 'shown-this-session';
    if (this.shownCount >= this.o.sessionCap) return 'session-cap';
    if (this.lastShownAt !== null && at - this.lastShownAt < this.o.cooldownMs) return 'cooldown';
    return null;
  }

  /** Session counters (for tests / debugging). */
  stats() { return { shownCount: this.shownCount, lastShownAt: this.lastShownAt, shownScreens: [...this.shownScreens] }; }

  // ---- internals ----
  private firstVisitEligible(screen: string) {
    const id = this.o.shortFor(screen);
    return !!id && !NEVER_NUDGE_SCREENS.has(screen) && !this.dontShow.has(screen) && !this.watched.has(id);
  }

  private offer(screen: string, reason: NudgeReason, at: number): NudgeTrigger | null {
    if (this.blockReason(screen, at)) return null;
    const shortId = this.o.shortFor(screen)!;
    this.shownScreens.add(screen);
    this.shownCount += 1;
    this.lastShownAt = at;
    if (!this.introduced.has(screen)) { this.introduced.add(screen); this.o.onIntroduced?.(screen); }
    return { screen, shortId, reason, at };
  }

  private prune(at: number) {
    const keep = (x: Stamp) => at - x.at <= this.o.windowMs;
    this.backs = this.backs.filter(keep);
    this.errors = this.errors.filter(keep);
  }

  private count(list: Stamp[], screen: string) { return list.filter((x) => x.screen === screen).length; }
}

/** "Need a hand? Watch a 15s how-to" / "New here? Watch an 18s how-to". */
export function nudgeHeadline(reason: NudgeReason, durationSec: number): string {
  const lead = reason === 'first-visit' ? 'New here?' : 'Need a hand?';
  const len = formatShortLength(durationSec);
  return `${lead} Watch ${article(len)} ${len} how-to`;
}

/** "a 15s" but "an 18s" / "an 8s" / "an 11s" / "an 80s" (spoken: eighteen, eight, eleven, eighty). */
function article(len: string): 'a' | 'an' {
  const n = parseInt(len, 10);
  return /^8/.test(String(n)) || n === 11 || n === 18 ? 'an' : 'a';
}

/** 15 → "15s", 90 → "1.5 min", 120 → "2 min". */
export function formatShortLength(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.round((s / 60) * 2) / 2;
  return `${m} min`;
}

/** 18 → "0:18", 95 → "1:35". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
