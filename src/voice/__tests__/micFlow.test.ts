import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bubbleFor, clock, DIDNT_CATCH, micView, nextLiveSince, pressAction, prevTurnEndReason, selfEndAction } from '../micFlow';
import { failureOutcome } from '../voiceTurnLog';

const src = (f: string) => readFileSync(join(process.cwd(), 'src/voice', f), 'utf8');

test('micFlow: the bubble shows "Listening" exactly when the disc shows recording (same state)', () => {
  for (const phase of ['idle', 'listening', 'thinking'] as const) {
    for (const mode of ['ptt', 'handsfree'] as const) {
      const disc = micView(phase);
      const b = bubbleFor({ phase, mode, heard: '', final: false, checkingLive: false, elapsedMs: 3200 });
      assert.equal(!!b?.listening, disc.live, `${phase}/${mode}`);
      if (disc.live) assert.equal(b?.timer, clock(3200), 'same elapsed timer as the disc');
    }
  }
  assert.equal(bubbleFor({ phase: 'listening', mode: 'ptt', heard: '', final: false, checkingLive: false, elapsedMs: 0 })?.text, 'Listening… let go to send');
  assert.equal(bubbleFor({ phase: 'listening', mode: 'handsfree', heard: '', final: false, checkingLive: false, elapsedMs: 0 })?.text, 'Listening… tap to cancel');
  const words = bubbleFor({ phase: 'listening', mode: 'ptt', heard: 'show disbursals', final: false, checkingLive: false, elapsedMs: 0 });
  assert.equal(words?.text, 'show disbursals');
  assert.equal(words?.interim, true);
  assert.equal(bubbleFor({ phase: 'idle', mode: 'ptt', heard: '', final: false, checkingLive: false, elapsedMs: 0 }), null);
  const fin = bubbleFor({ phase: 'idle', mode: 'ptt', heard: 'go home', final: true, checkingLive: true, elapsedMs: 0 });
  assert.equal(fin?.text, '“go home”');
  assert.equal(fin?.checking, true);
  assert.equal(fin?.timer, null);
});

test('micFlow: a held finger alone never paints recording (VoiceMic has no local pressed flag)', () => {
  const mic = src('VoiceMic.tsx');
  assert.ok(!/useState\(false\)/.test(mic) && !mic.includes('setPressed'), 'no local pressed state');
  assert.match(mic, /const live = view\.live;/);
  const host = src('VoiceHost.tsx');
  assert.match(host, /const view = micView\(voice\.phase\)/);
  assert.match(host, /<VoiceMic placement=\{placement\} view=\{view\} elapsed=\{elapsed\} \/>/);
  assert.match(host, /bubbleFor\(\{ phase: voice\.phase/);
});

test('micFlow: one timer start, kept across a transparent restart, cleared when listening ends', () => {
  let since: number | null = null;
  since = nextLiveSince(since, true, 1000);
  assert.equal(since, 1000);
  since = nextLiveSince(since, true, 4000); // restart: listening never flipped off
  assert.equal(since, 1000);
  since = nextLiveSince(since, false, 5000);
  assert.equal(since, null);
  assert.equal(clock(65_400), '1:05');
  assert.equal(clock(-5), '0:00');
});

test('micFlow: recogniser ends by itself while the finger is held → restart once, then a clear message', () => {
  const base = { mode: 'ptt' as const, released: false, handled: false, partial: '' };
  assert.equal(selfEndAction({ ...base, restarts: 0 }), 'restart');
  assert.equal(selfEndAction({ ...base, restarts: 1 }), 'give_up');
  assert.equal(selfEndAction({ ...base, restarts: 0, partial: 'show pay' }), 'finalize', 'partial text is kept, not thrown away');
  assert.equal(selfEndAction({ ...base, restarts: 0, released: true }), 'ignore', 'after release the grace timer decides');
  assert.equal(selfEndAction({ ...base, restarts: 0, handled: true }), 'ignore');
  assert.equal(selfEndAction({ ...base, mode: 'handsfree', restarts: 0 }), 'give_up', 'hands-free end-of-speech is not restarted');
  assert.match(DIDNT_CATCH, /hold and speak again/);
  const hook = src('useVoiceCommand.ts');
  assert.match(hook, /setInfo\(DIDNT_CATCH\)/);
  assert.match(hook, /const h = launch\(\);/);
});

test('micFlow: pressing during a Piper read-out stops it and listens (no WAIT refusal)', () => {
  assert.equal(pressAction({ readingOut: true }), 'stop_readout_then_listen');
  assert.equal(pressAction({ readingOut: false }), 'listen');
  const hook = src('useVoiceCommand.ts');
  assert.ok(!hook.includes('WAIT_FOR_ZIPPY'), 'the refusal is gone');
  const begin = hook.slice(hook.indexOf('const beginTurn = useCallback'), hook.indexOf('setListening(true);', hook.indexOf('const beginTurn = useCallback')));
  assert.match(begin, /void stopSpeaking\(\);/);
  assert.ok(!/isReadingOut\(\)\)\s*\{[^}]*return;/.test(begin), 'beginTurn never returns early on a read-out');
});

test('micFlow: beginTurn does not log the previous turn as "cancelled" for the late-end race', () => {
  assert.equal(prevTurnEndReason({ handled: true, released: true, asrEnded: true }), null);
  assert.equal(prevTurnEndReason({ handled: false, released: false, asrEnded: true }), 'asr_ended');
  assert.equal(prevTurnEndReason({ handled: false, released: true, asrEnded: false }), 'superseded');
  assert.equal(prevTurnEndReason({ handled: false, released: false, asrEnded: false }), 'cancelled');
  assert.deepEqual(failureOutcome('superseded'), { outcome: 'dropped', reason: 'superseded' });
  const hook = src('useVoiceCommand.ts');
  assert.ok(!hook.includes("logTurnEnd(prev, 'cancelled')"));
  // The device path waits for the previous session's end before the new listeners exist.
  const i = hook.indexOf('await prepareDeviceAsr()');
  assert.ok(i > 0 && i < hook.indexOf('const launch = (): DeviceAsrHandle | null => startDeviceAsr('));
});
