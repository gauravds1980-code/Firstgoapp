import test from 'node:test';
import assert from 'node:assert/strict';
import { ASR_END_WAIT_MS, createAsrSessionGate } from '../asrSession';

/** Fake clock + timers + a fake native emitter with one 'end' channel (no session ids, like expo-speech-recognition). */
function rig() {
  let t = 0;
  const timers: { at: number; cb: () => void; id: number }[] = [];
  let tid = 0;
  const endSubs = new Set<() => void>();
  const deps = {
    now: () => t,
    setTimer: (cb: () => void, ms: number) => { const id = ++tid; timers.push({ at: t + ms, cb, id }); return id; },
    clearTimer: (h: unknown) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
  };
  const advance = (ms: number) => {
    t += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > t) break;
      timers.shift();
      due.cb();
    }
  };
  const emitEnd = () => { [...endSubs].forEach((cb) => cb()); };
  const onceEnd = (cb: () => void) => { endSubs.add(cb); return () => { endSubs.delete(cb); }; };
  return { deps, advance, emitEnd, onceEnd, endSubs };
}

const flush = () => new Promise((r) => setImmediate(r));

test('asr gate: no open session → prepare resolves at once, nothing aborted', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  let aborted = 0;
  const res = await g.prepare({ abort: () => { aborted++; }, onceEnd: r.onceEnd });
  assert.deepEqual(res, { waitedMs: 0, timedOut: false, hadOpen: false, superseded: false });
  assert.equal(aborted, 0);
});

test('asr gate: open session is aborted once and its end is awaited before the next start', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  const s1 = g.begin(() => {});
  let aborted = 0;
  let resolved = false;
  const p = g.prepare({ abort: () => { aborted++; }, onceEnd: r.onceEnd }).then((x) => { resolved = true; return x; });
  r.advance(120);
  await flush();
  assert.equal(resolved, false, 'still waiting for the old end');
  // The old session's own end listener sees its end; then the waiter.
  assert.equal(g.accept(s1, 'end'), true);
  r.emitEnd();
  const res = await p;
  assert.equal(aborted, 1);
  assert.equal(res.timedOut, false);
  assert.equal(res.waitedMs, 120);
  assert.equal(g.isOpen(), false);
});

test('asr gate: handle.abort() then prepare() never aborts the native recogniser twice', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  const s1 = g.begin(() => {});
  let aborted = 0;
  g.abortOpen(s1, () => { aborted++; });
  g.abortOpen(s1, () => { aborted++; });
  const p = g.prepare({ abort: () => { aborted++; }, onceEnd: r.onceEnd });
  r.emitEnd();
  await p;
  assert.equal(aborted, 1);
});

test(`asr gate: the wait is bounded (≤ ${ASR_END_WAIT_MS} ms) when the old end never comes`, async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  let detached = 0;
  g.begin(() => { detached++; });
  const p = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  r.advance(ASR_END_WAIT_MS);
  const res = await p;
  assert.equal(res.timedOut, true);
  assert.ok(res.waitedMs <= ASR_END_WAIT_MS);
  assert.equal(detached, 1, 'old listeners are removed so they cannot see the new session');
  assert.equal(r.endSubs.size, 0, 'waiter unsubscribed');
});

test('asr gate: a late end of an older session never ends the new one', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  g.begin(() => {});
  const p = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  r.advance(ASR_END_WAIT_MS);
  await p;
  const s2 = g.begin(() => {});
  // Late 'end' (and its 'aborted' error / audioend) of session 1 arrive at session 2's listeners first.
  assert.equal(g.accept(s2, 'aborted'), false);
  assert.equal(g.accept(s2, 'audioend'), false);
  assert.equal(g.accept(s2, 'end'), false, 'stale end swallowed');
  assert.equal(g.isOpen(), true, 'new session still open');
  // Session 2's own events and end go through.
  assert.equal(g.accept(s2, 'start'), true);
  assert.equal(g.accept(s2, 'result'), true);
  assert.equal(g.accept(s2, 'end'), true);
  assert.equal(g.isOpen(), false);
});

test('asr gate: start() without prepare() while a session is open → its late end is still swallowed', () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  let detached = 0;
  g.begin(() => { detached++; });
  const s2 = g.begin(() => {});
  assert.equal(detached, 1);
  assert.equal(g.accept(s2, 'end'), false);
  assert.equal(g.accept(s2, 'end'), true, 'only one stale end was owed');
});

test('asr gate: a genuine early error of the new session is never swallowed (not gated on start)', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  g.begin(() => {});
  const p = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  r.advance(ASR_END_WAIT_MS);
  await p;
  const s2 = g.begin(() => {});
  // Permission / language error preempts 'start': delivered, and it settles the stale debt so the following end counts.
  assert.equal(g.accept(s2, 'error'), true);
  assert.equal(g.accept(s2, 'end'), true);
});

test('asr gate: the stale debt expires, so a later real end is delivered', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps, { staleTtlMs: 1000 });
  g.begin(() => {});
  const p = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  r.advance(ASR_END_WAIT_MS);
  await p;
  const s2 = g.begin(() => {});
  r.advance(1500);
  assert.equal(g.staleDebt(), 0);
  assert.equal(g.accept(s2, 'end'), true);
});

test('asr gate: events of a superseded session id are ignored; a newer prepare supersedes an older one', async () => {
  const r = rig();
  const g = createAsrSessionGate(r.deps);
  const s1 = g.begin(() => {});
  const a = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  const b = g.prepare({ abort: () => {}, onceEnd: r.onceEnd });
  g.accept(s1, 'end');
  r.emitEnd();
  assert.equal((await a).superseded, true);
  assert.equal((await b).superseded, false);
  const s2 = g.begin(() => {});
  assert.equal(g.accept(s1, 'result'), false);
  assert.equal(g.accept(s2, 'result'), true);
});
