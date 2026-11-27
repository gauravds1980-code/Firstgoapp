/**
 * v1.4.5 open-session gate for the phone recogniser (pure; no React Native imports so `npm run test:voice` runs it).
 *
 * expo-speech-recognition's events carry no session id, and on Android abort() posts its 'end' to the main
 * handler AFTER the call returns (ExpoSpeechService.teardownAndEnd). Before v1.4.5 the next turn registered its
 * listeners at once, so the aborted session's late 'end' landed on the NEW session: its listeners were removed,
 * the bubble vanished and the turn dangled (logged "cancelled" by the next press). See bubble-fix-notes/STATUS.md.
 *
 * Rules:
 *  - One session is "open" from start() until its own 'end'.
 *  - A new session while one is open: abort the old one (once) and wait for its 'end', bounded (ASR_END_WAIT_MS),
 *    BEFORE the new listeners are registered and start() is called.
 *  - The wait timed out (start() can destroy a recogniser without any 'end'): the old 'end' may still come late.
 *    It is owed as "stale debt": the new session swallows an 'end' / 'aborted' error / 'audioend' only while it has
 *    seen no event of its own yet (and the debt is young). Any own event (start, result, speech, other error)
 *    clears the debt — so a genuine early error is never swallowed and nothing is gated on 'start'.
 */

/** Longest wait for the previous session's 'end' before the next session starts anyway. */
export const ASR_END_WAIT_MS = 400;
/** A stale 'end' older than this is no longer expected. */
export const ASR_STALE_TTL_MS = 2000;

export type AsrEventKind = 'start' | 'result' | 'speech' | 'error' | 'aborted' | 'audioend' | 'end';

export interface AsrGateDeps {
  now: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

export interface PrepareOps {
  /** Abort the native recogniser (called at most once per open session). */
  abort: () => void;
  /** Subscribe to the next native 'end'; returns an unsubscribe. */
  onceEnd: (cb: () => void) => () => void;
}

export type PrepareResult = { waitedMs: number; timedOut: boolean; hadOpen: boolean; superseded: boolean };

export function createAsrSessionGate(deps: AsrGateDeps, opts: { waitMs?: number; staleTtlMs?: number } = {}) {
  const waitMs = opts.waitMs ?? ASR_END_WAIT_MS;
  const staleTtl = opts.staleTtlMs ?? ASR_STALE_TTL_MS;
  let seq = 0;
  /** Session started and its own 'end' not seen yet. */
  let open: { id: number; aborted: boolean; detach: () => void } | null = null;
  /** The session whose listeners are live (the newest one). */
  let current: { id: number; sawOwnEvent: boolean } | null = null;
  let stale = { count: 0, until: 0 };
  let prepareSeq = 0;

  return {
    /** Is a session still waiting for its 'end'? */
    isOpen: () => open !== null,
    openId: () => open?.id ?? null,
    staleDebt: () => (stale.count > 0 && deps.now() < stale.until ? stale.count : 0),

    /** The hook / handle aborts the open session: remember so prepare() does not abort it a second time. */
    abortOpen(id: number, abort: () => void): void {
      if (!open || open.id !== id || open.aborted) return;
      open.aborted = true;
      try { abort(); } catch { /* already stopped */ }
    },

    /**
     * Before a new session: abort the open one (if not yet aborted) and wait ≤ waitMs for its 'end'.
     * `superseded`: a later prepare() started meanwhile — the caller must not start.
     */
    prepare(ops: PrepareOps): Promise<PrepareResult> {
      const mine = ++prepareSeq;
      const was = open;
      if (!was) return Promise.resolve({ waitedMs: 0, timedOut: false, hadOpen: false, superseded: false });
      const t0 = deps.now();
      return new Promise<PrepareResult>((resolve) => {
        let done = false;
        let unsub: () => void = () => {};
        let timer: unknown = null;
        const finish = (ended: boolean) => {
          if (done) return;
          done = true;
          try { unsub(); } catch { /* gone */ }
          if (timer !== null) deps.clearTimer(timer);
          if (open === was) {
            if (!ended) {
              // Its 'end' never came in time: detach its listeners, owe the late 'end' as stale debt.
              try { was.detach(); } catch { /* gone */ }
              stale = { count: stale.count + 1, until: deps.now() + staleTtl };
            }
            open = null;
          }
          resolve({ waitedMs: deps.now() - t0, timedOut: !ended, hadOpen: true, superseded: mine !== prepareSeq });
        };
        unsub = ops.onceEnd(() => finish(true));
        timer = deps.setTimer(() => finish(false), waitMs);
        if (!was.aborted) { was.aborted = true; try { ops.abort(); } catch { /* already stopped */ } }
        // The session may have ended between the check and the subscription.
        if (open !== was) finish(true);
      });
    },

    /**
     * Register a new session (listeners are about to be added and start() called). If a session is still open
     * here (no prepare()), its late 'end' becomes stale debt right away.
     */
    begin(detach: () => void): number {
      if (open) {
        try { open.detach(); } catch { /* gone */ }
        stale = { count: stale.count + 1, until: deps.now() + staleTtl };
      }
      const id = ++seq;
      open = { id, aborted: false, detach };
      current = { id, sawOwnEvent: false };
      return id;
    },

    /** start() threw: the session never opened. */
    failed(id: number): void {
      if (open?.id === id) open = null;
    },

    /**
     * An event reached session `id`'s listeners. Returns true when the session should handle it,
     * false when it is stale (belongs to an older session) and must be ignored.
     */
    accept(id: number, kind: AsrEventKind): boolean {
      if (!current || current.id !== id) return false;
      const debt = stale.count > 0 && deps.now() < stale.until;
      if (!debt) stale = { count: 0, until: 0 };
      if (!current.sawOwnEvent && debt && (kind === 'end' || kind === 'aborted' || kind === 'audioend')) {
        if (kind === 'end') stale.count -= 1;
        return false;
      }
      if (kind !== 'end' && kind !== 'aborted' && kind !== 'audioend') { current.sawOwnEvent = true; stale = { count: 0, until: 0 }; }
      if (kind === 'end' && open?.id === id) open = null;
      return true;
    },

  };
}

export type AsrSessionGate = ReturnType<typeof createAsrSessionGate>;
