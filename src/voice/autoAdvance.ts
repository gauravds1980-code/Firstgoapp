/**
 * v1.4.5 "tap optional, auto by default" (FINDINGS.md pattern). One per step that can move on by itself:
 *
 *   typed / slider value  → wait AUTO_ADVANCE_MS (800–1000 ms) after the last edit, then advance if still valid
 *   complete voice value  → advance at once
 *   edit / drag / tap     → cancel the countdown (a tap presses through `press`, once)
 *   isAdvancing           → one advance per step: a tap during the countdown, a voice "proceed" and the timer can
 *                           never double-navigate. `reset()` when the step is shown again.
 *   invalid / below-min / over-cap values never start the countdown (the caller passes `valid`).
 *
 * Pure (timers injectable): unit-tested in Node. Screens use it through useAutoAdvance (src/voice/useAutoAdvance.ts).
 */

export const AUTO_ADVANCE_MS = 900;

type TimerApi = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AutoAdvancer {
  private timer: unknown = null;
  private advancing = false;
  constructor(private advance: () => void, private delayMs: number = AUTO_ADVANCE_MS, private timers: TimerApi = realTimers) {}

  /** Swap the advance callback (the latest render's closure). */
  setAdvance(fn: () => void): void { this.advance = fn; }

  /** True while a countdown runs. */
  get pending(): boolean { return this.timer !== null; }
  /** True once this step advanced (until reset). */
  get done(): boolean { return this.advancing; }

  /** A typed / dragged value changed: restart the countdown when `valid`, else just cancel it. */
  typed(valid: boolean): void {
    this.cancel();
    if (!valid || this.advancing) return;
    this.timer = this.timers.set(() => { this.timer = null; this.fire(); }, this.delayMs);
  }

  /** A complete voice value (or a voice "proceed"): advance now when `valid`. */
  voice(valid: boolean): boolean {
    this.cancel();
    return valid ? this.fire() : false;
  }

  /** The dealer tapped the CTA: cancel the countdown and advance once. */
  press(): boolean { this.cancel(); return this.fire(); }

  cancel(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  /** The step is shown again (Change amount, sheet reopened): allow one more advance. */
  reset(): void { this.cancel(); this.advancing = false; }

  private fire(): boolean {
    if (this.advancing) return false;
    this.advancing = true;
    this.advance();
    return true;
  }
}
