/**
 * v1.4.2: the mic's press handling with "double-tap opens the live transcript". Pure TS (unit-tested in Node).
 *
 * The first press is NEVER gated: push-to-talk starts listening on touch-down and hands-free starts on the
 * tap, exactly as before. Only a SHORT first press (≤ TAP_MAX_MS, i.e. a tap, not a hold) arms the
 * double-tap window:
 *  - a second press-in within DOUBLE_TAP_MS of that tap's release → `discard()` the turn the first tap
 *    started (silently: no delivery, banner, read-out or success metric) and `toggleSheet()`. The second
 *    press does not start a turn, and its release is swallowed.
 *  - push-to-talk: the release of a tap is held back until the window closes (≤ DOUBLE_TAP_MS), then sent
 *    with its ORIGINAL timestamp. A tap that short is always "too short" for push-to-talk, so this only
 *    delays that hint, never a real command. A hold (> TAP_MAX_MS) is released at once and never arms the
 *    window, so a quick press after a hold is a new turn, not a double-tap.
 *  - hands-free: the tap goes through at once (start, or cancel a live turn), as before.
 */
import type { TalkMode } from './voiceMode';

/** Max gap between the first tap's release and the second press-in. */
export const DOUBLE_TAP_MS = 300;
/** A press held longer than this is a hold (push-to-talk), never half of a double-tap. */
export const TAP_MAX_MS = 300;

export type MicGestureActions = {
  pressIn: (at: number) => void;
  pressOut: (at: number) => void;
  tap: (at: number) => void;
  /** Cancel the turn the first tap started, with no side effects. */
  discard: () => void;
  /** Open (or close) the live transcript sheet. */
  toggleSheet: () => void;
};

export type MicGestureDeps = {
  mode: () => TalkMode;
  actions: MicGestureActions;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export type MicGesture = {
  /** Touch-down. Returns 'double' when this press completed a double-tap. */
  down: (at: number) => 'press' | 'double';
  /** Touch-up. */
  up: (at: number) => void;
  /** Unmount / screen change: flush a held-back release, forget the window. */
  reset: () => void;
};

export function createMicGesture(deps: MicGestureDeps): MicGesture {
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const a = deps.actions;
  let downAt: number | null = null;
  let downMode: TalkMode = 'ptt';
  /** Release time of the last tap that can start a double-tap. */
  let tapUpAt: number | null = null;
  let held: { timer: unknown; at: number } | null = null;
  let swallowUp = false;

  const flush = () => {
    if (!held) return;
    const h = held;
    held = null;
    clearT(h.timer);
    a.pressOut(h.at);
  };

  return {
    down(at) {
      if (tapUpAt !== null && at - tapUpAt <= DOUBLE_TAP_MS) {
        tapUpAt = null;
        if (held) { clearT(held.timer); held = null; } // the first tap's release is never sent
        swallowUp = true;
        downAt = null;
        a.discard();
        a.toggleSheet();
        return 'double';
      }
      tapUpAt = null;
      flush(); // a late second press: the first tap's release goes out first, as it would have
      swallowUp = false;
      downAt = at;
      downMode = deps.mode();
      if (downMode === 'ptt') a.pressIn(at);
      return 'press';
    },
    up(at) {
      if (swallowUp) { swallowUp = false; return; }
      if (downAt === null) return;
      const heldMs = at - downAt;
      downAt = null;
      const isTap = heldMs <= TAP_MAX_MS;
      if (downMode === 'handsfree') {
        a.tap(at);
        tapUpAt = isTap ? at : null;
        return;
      }
      if (!isTap) { tapUpAt = null; a.pressOut(at); return; }
      tapUpAt = at;
      const timer = setT(() => { if (held && held.timer === timer) { held = null; a.pressOut(at); } tapUpAt = tapUpAt === at ? null : tapUpAt; }, DOUBLE_TAP_MS);
      held = { timer, at };
    },
    reset() {
      flush();
      tapUpAt = null;
      downAt = null;
      swallowUp = false;
    },
  };
}
