/**
 * v1.4.2 confidence gate: shaky phone results wait for Whisper (600 ms cap from release), "Did you mean"
 * when there is no audio, early-Whisper (streaming) hook. Pure. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessDeviceResult, downgradeCommand, gateDiagText, normalizeAsrConfidence, partialStability, pickAfterWait, runGate,
  SHAKY_CONFIDENCE, STABILITY_MIN, UNKNOWN_CONF_MIN_SCORE, WHISPER_WAIT_MS, type GateOutcome,
} from '../confidenceGate';
import { getEarlyWhisper, setEarlyWhisperSource } from '../earlyWhisper';
import { localCommand, matchCommand } from '../intentMatcher';
import { shouldAutoExecute } from '../voiceLogic';
import type { CommandResponse } from '../types';

const local = (text: string) => localCommand(text, matchCommand(text), 0.8);
const asIn = (c: CommandResponse) => ({ status: c.status, score: c.score, band: c.confidenceBand });

const payouts = local('open payouts');
const portfolio = { ...local('open portfolio'), score: 0.9 };
const retry = local('zxqv');

test('normalizeAsrConfidence: -1 / 0 / NaN / undefined are unknown, real values pass through', () => {
  assert.equal(normalizeAsrConfidence(-1, 'android'), null);
  assert.equal(normalizeAsrConfidence(0, 'android'), null);
  assert.equal(normalizeAsrConfidence(0, 'ios'), null);
  assert.equal(normalizeAsrConfidence(undefined, 'ios'), null);
  assert.equal(normalizeAsrConfidence(Number.NaN, 'android'), null);
  assert.equal(normalizeAsrConfidence(0.9, 'android'), 0.9);
  assert.equal(normalizeAsrConfidence(0.5, 'ios'), 0.5);
  assert.equal(normalizeAsrConfidence(1.4, 'ios'), 1);
});

test('partialStability: growing partials ≈ 1, rewritten leading words low, none → null', () => {
  assert.equal(partialStability(['open', 'open pay', 'open payouts'], 'open payouts'), 1);
  const rewritten = partialStability(['oven', 'all pain', 'open pay outs', 'go pen payout'], 'open payouts')!;
  assert.ok(rewritten < STABILITY_MIN, `rewritten ${rewritten}`);
  assert.equal(partialStability([], 'open payouts'), null);
  // The last (still-forming) word changing is normal, not a rewrite.
  assert.equal(partialStability(['show pay', 'show payouts'], 'show payouts'), 1);
});

test('assessDeviceResult: the shaky / confident rules', () => {
  assert.equal(payouts.confidenceBand, 'auto');
  // Confident keyword match with a known high confidence → act.
  assert.deepEqual(assessDeviceResult({ text: 'open payouts', confidence: 0.92, local: asIn(payouts), partials: ['open', 'open payouts'], heardSpeech: true }).shaky, false);
  // Unknown confidence + high score + stable → act.
  assert.equal(assessDeviceResult({ text: 'open payouts', confidence: null, local: asIn(payouts), partials: ['open', 'open payouts'], heardSpeech: true }).shaky, false);
  // Unknown confidence + low score → shaky.
  const low = assessDeviceResult({ text: 'open pay', confidence: null, local: { status: 'ok', score: 0.7, band: 'auto' }, partials: ['open pay'], heardSpeech: true });
  assert.equal(low.shaky, true);
  assert.deepEqual(low.reasons, ['low_match']);
  assert.ok(UNKNOWN_CONF_MIN_SCORE >= 0.8);
  // Unknown confidence + high score but rewritten words → shaky.
  assert.deepEqual(assessDeviceResult({ text: 'open payouts', confidence: null, local: asIn(payouts), partials: ['oven', 'all pain', 'go pen payout'], heardSpeech: true }).reasons, ['unstable']);
  // Clarify band → shaky (whatever the confidence).
  assert.ok(assessDeviceResult({ text: 'pay', confidence: 0.95, local: { status: 'clarify', score: 0.7, band: 'clarify' }, partials: [], heardSpeech: true }).reasons.includes('unsure_match'));
  // Retry → shaky.
  assert.ok(assessDeviceResult({ text: 'zxqv', confidence: 0.95, local: asIn(retry), partials: [], heardSpeech: true }).reasons.includes('no_match'));
  // Empty / garbled after speech → shaky.
  assert.ok(assessDeviceResult({ text: '', confidence: 0.9, local: asIn(payouts), partials: [], heardSpeech: true }).reasons.includes('empty'));
  assert.ok(assessDeviceResult({ text: '??', confidence: 0.9, local: asIn(payouts), partials: [], heardSpeech: true }).reasons.includes('garbled'));
  assert.ok(assessDeviceResult({ text: 'a', confidence: 0.9, local: asIn(payouts), partials: [], heardSpeech: true }).reasons.includes('garbled'));
  // Digits are fine when a number is expected.
  assert.equal(assessDeviceResult({ text: '45000', confidence: 0.9, local: asIn(payouts), partials: [], heardSpeech: true, expect: 'amount' }).shaky, false);
  // Low known confidence → shaky.
  assert.deepEqual(assessDeviceResult({ text: 'open payouts', confidence: SHAKY_CONFIDENCE - 0.1, local: asIn(payouts), partials: [], heardSpeech: true }).reasons, ['low_conf']);
  // Destructive (band confirm, status ok) is not shaky: it always needs Confirm anyway.
  assert.equal(assessDeviceResult({ text: 'start e-sign', confidence: 0.9, local: { status: 'ok', score: 1, band: 'confirm' }, partials: [], heardSpeech: true }).shaky, false);
});

test('pickAfterWait: Whisper better → Whisper; same target → device; no / weak Whisper → downgraded device, never auto', () => {
  const w = pickAfterWait(payouts, portfolio);
  assert.equal(w.use, 'whisper');
  assert.equal(w.command, portfolio);
  const same = pickAfterWait(payouts, { ...local('show payouts'), score: 0.9 });
  assert.equal(same.use, 'device');
  assert.equal(same.downgraded, false);
  assert.equal(same.command, payouts);
  const none = pickAfterWait(payouts, null);
  assert.equal(none.use, 'device');
  assert.equal(none.downgraded, true);
  assert.equal(none.command.status, 'clarify');
  assert.equal(none.command.responseText, 'Did you mean this?');
  assert.deepEqual(none.command.candidates?.map((c) => c.intent), [payouts.intent]);
  assert.equal(shouldAutoExecute(none.command, false), false);
  const weak = pickAfterWait(payouts, { ...portfolio, score: 0.4 });
  assert.equal(weak.downgraded, true);
  assert.equal(shouldAutoExecute(weak.command, false), false);
  // Phone had nothing, Whisper sure → Whisper.
  assert.equal(pickAfterWait(retry, portfolio).use, 'whisper');
  // Phone retry stays a retry when downgraded.
  assert.equal(downgradeCommand(retry).status, 'retry');
  assert.equal(downgradeCommand(retry).autoExecute, false);
});

test('early-Whisper registry: null without a source, swallows a rejecting source', async () => {
  const turn = { id: 1, ctx: { screen: 'home' } as never, releasedAt: 0 };
  assert.equal(getEarlyWhisper(turn), null);
  setEarlyWhisperSource(() => Promise.resolve(portfolio));
  assert.equal(await getEarlyWhisper(turn), portfolio);
  setEarlyWhisperSource(() => Promise.reject(new Error('stream died')));
  assert.equal(await getEarlyWhisper(turn), null);
  setEarlyWhisperSource(() => { throw new Error('bad'); });
  assert.equal(getEarlyWhisper(turn), null);
  setEarlyWhisperSource(null);
  assert.equal(getEarlyWhisper(turn), null);
});

test('runGate timing (real timers, 600 ms cap from release): measured', async () => {
  const clock = () => performance.now();
  const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const run = async (o: { shaky: boolean; wantCheck: boolean; whisperAt?: number; earlyAt?: number; finalAfterRelease?: number }) => {
    const releasedAt = clock() - (o.finalAfterRelease ?? 0);
    const g = await runGate({
      shaky: o.shaky, wantCheck: o.wantCheck, device: payouts, releasedAt, now: clock,
      whisper: o.whisperAt !== undefined ? after(Math.max(0, o.whisperAt - (o.finalAfterRelease ?? 0)), portfolio) : null,
      early: o.earlyAt !== undefined ? Promise.resolve(portfolio) : null,
    });
    return { g, fromRelease: Math.round(clock() - releasedAt) };
  };
  const rows: [string, GateOutcome, number][] = [];
  const conf = await run({ shaky: false, wantCheck: true, whisperAt: 300 });
  rows.push(['confident', conf.g, conf.fromRelease]);
  assert.equal(conf.g.decision, 'confident');
  assert.ok(conf.g.waitedMs <= 5);
  assert.equal(conf.g.command, payouts);

  const fast = await run({ shaky: true, wantCheck: true, whisperAt: 300 });
  rows.push(['shaky+Whisper@300', fast.g, fast.fromRelease]);
  assert.equal(fast.g.use, 'whisper');
  assert.ok(fast.g.waitedMs >= 290 && fast.g.waitedMs < 400, `fast ${fast.g.waitedMs}`);

  const slow = await run({ shaky: true, wantCheck: true, whisperAt: 900 });
  rows.push(['shaky+Whisper@900', slow.g, slow.fromRelease]);
  assert.equal(slow.g.decision, 'late');
  assert.equal(slow.g.downgraded, true);
  assert.equal(shouldAutoExecute(slow.g.command, false), false);
  assert.ok(slow.g.waitedMs >= WHISPER_WAIT_MS - 10 && slow.g.waitedMs < WHISPER_WAIT_MS + 100, `slow ${slow.g.waitedMs}`);

  const early = await run({ shaky: true, wantCheck: true, whisperAt: 900, earlyAt: 0 });
  rows.push(['shaky+stream@release', early.g, early.fromRelease]);
  assert.equal(early.g.decision, 'whisper_early');
  assert.ok(early.g.waitedMs <= 5, `early ${early.g.waitedMs}`);

  const noAudio = await run({ shaky: true, wantCheck: false });
  rows.push(['shaky+no audio', noAudio.g, noAudio.fromRelease]);
  assert.equal(noAudio.g.decision, 'no_audio');
  assert.equal(noAudio.g.downgraded, true);
  assert.ok(noAudio.g.waitedMs <= 5);

  // Final arrived 700 ms after release (past the cap): no further wait, whatever is ready now.
  const lateFinal = await run({ shaky: true, wantCheck: true, whisperAt: 900, finalAfterRelease: 700 });
  rows.push(['final@700, Whisper@900', lateFinal.g, lateFinal.fromRelease]);
  assert.equal(lateFinal.g.decision, 'late');
  assert.ok(lateFinal.g.waitedMs <= 20, `lateFinal ${lateFinal.g.waitedMs}`);

  console.log(`[gate-timing] ${rows.map(([n, g, r]) => `${n}: wait=${g.waitedMs}ms release→decision=${r}ms ${g.decision}/${g.use}${g.downgraded ? '(downgraded)' : ''}`).join(' | ')}`);
});

test('gateDiagText: debug line wording', () => {
  assert.equal(gateDiagText({ decision: 'confident' }), 'confident · acted');
  assert.equal(gateDiagText({ decision: 'whisper', waitedMs: 420, reasons: ['low_match'], confidence: null }), 'shaky (low match, unknown conf) · waited 420 ms · used Whisper');
  assert.equal(gateDiagText({ decision: 'late', waitedMs: 600, reasons: ['low_conf'], confidence: 0.4 }), 'shaky (low conf) · waited 600 ms · Whisper late, asked');
  assert.equal(gateDiagText({ decision: 'no_audio', reasons: ['no_match'], confidence: null, retryText: true }), 'shaky (no match, unknown conf) · no audio, server text');
});
