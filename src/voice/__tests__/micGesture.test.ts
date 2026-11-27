/** v1.4.2: double-tap the mic opens the live transcript; single press / hold are not delayed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMicGesture, DOUBLE_TAP_MS, TAP_MAX_MS } from '../micGesture';
import type { TalkMode } from '../voiceMode';

function rig(mode: TalkMode = 'ptt') {
  const log: string[] = [];
  let timers: { fn: () => void; at: number; id: number }[] = [];
  let clock = 0;
  let nextId = 1;
  const g = createMicGesture({
    mode: () => mode,
    actions: {
      pressIn: (at) => log.push(`in@${at}`), pressOut: (at) => log.push(`out@${at}`), tap: (at) => log.push(`tap@${at}`),
      discard: () => log.push('discard'), toggleSheet: () => log.push('sheet'),
    },
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ fn, at: clock + ms, id }); return id; },
    clearTimer: (h) => { timers = timers.filter((t) => t.id !== h); },
  });
  const advance = (to: number) => {
    clock = to;
    const due = timers.filter((t) => t.at <= to);
    timers = timers.filter((t) => t.at > to);
    due.forEach((t) => t.fn());
  };
  return { g, log, advance, setMode: (m: TalkMode) => { mode = m; } };
}

test('window constants are ~300 ms', () => { assert.equal(DOUBLE_TAP_MS, 300); assert.equal(TAP_MAX_MS, 300); });

test('push-to-talk: listening starts on the first touch-down, no gate', () => {
  const r = rig('ptt');
  assert.equal(r.g.down(0), 'press');
  assert.deepEqual(r.log, ['in@0'], 'pressIn fired synchronously');
});

test('push-to-talk hold: the release goes out at once (not delayed)', () => {
  const r = rig('ptt');
  r.g.down(0); r.g.up(1200);
  assert.deepEqual(r.log, ['in@0', 'out@1200']);
  // A quick press right after a hold is a new turn, never a double-tap.
  r.advance(1300);
  assert.equal(r.g.down(1300), 'press');
  assert.deepEqual(r.log, ['in@0', 'out@1200', 'in@1300']);
});

test('push-to-talk tap + second tap within 300 ms: turn discarded, sheet opens, nothing delivered', () => {
  const r = rig('ptt');
  r.g.down(0); r.advance(90); r.g.up(90);
  assert.deepEqual(r.log, ['in@0'], 'the tap release is held for the window');
  r.advance(250);
  assert.equal(r.g.down(250), 'double');
  r.g.up(320);
  r.advance(2000);
  assert.deepEqual(r.log, ['in@0', 'discard', 'sheet'], 'no pressOut for the cancelled turn, no new turn');
});

test('push-to-talk late second tap (> 300 ms after release): no sheet, two separate turns', () => {
  const r = rig('ptt');
  r.g.down(0); r.g.up(90);
  r.advance(90 + DOUBLE_TAP_MS);
  assert.deepEqual(r.log, ['in@0', 'out@90'], 'release sent with its original time when the window closes');
  r.advance(500);
  assert.equal(r.g.down(500), 'press');
  assert.deepEqual(r.log, ['in@0', 'out@90', 'in@500']);
  assert.ok(!r.log.includes('sheet'));
});

test('hands-free: the tap acts at once; a second tap within 300 ms opens the sheet instead of cancelling', () => {
  const r = rig('handsfree');
  r.g.down(0);
  assert.deepEqual(r.log, [], 'hands-free starts on the tap (release), as before');
  r.g.up(80);
  assert.deepEqual(r.log, ['tap@80'], 'not delayed');
  assert.equal(r.g.down(200), 'double');
  r.g.up(260);
  assert.deepEqual(r.log, ['tap@80', 'discard', 'sheet']);
});

test('hands-free: a late second tap is the normal "tap again to cancel"', () => {
  const r = rig('handsfree');
  r.g.down(0); r.g.up(80);
  r.advance(500);
  r.g.down(500); r.g.up(560);
  assert.deepEqual(r.log, ['tap@80', 'tap@560']);
});

test('double-tap again closes the sheet (toggle), and a triple tap does not chain', () => {
  const r = rig('handsfree');
  r.g.down(0); r.g.up(50); r.g.down(150); r.g.up(200);
  // Third tap right after: a normal tap (the double-tap consumed the window).
  r.g.down(260); r.g.up(300);
  assert.deepEqual(r.log, ['tap@50', 'discard', 'sheet', 'tap@300']);
  r.advance(1000);
  r.g.down(1000); r.g.up(1040); r.g.down(1100); r.g.up(1150);
  assert.deepEqual(r.log.slice(-3), ['tap@1040', 'discard', 'sheet']);
});

test('reset flushes a held-back push-to-talk release', () => {
  const r = rig('ptt');
  r.g.down(0); r.g.up(60);
  r.g.reset();
  assert.deepEqual(r.log, ['in@0', 'out@60']);
  r.advance(1000);
  assert.deepEqual(r.log, ['in@0', 'out@60']);
});
