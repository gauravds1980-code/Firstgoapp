/**
 * v1.4.0 on-device keyword + fuzzy matcher (pure). Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_VERSION, COMMAND_CATALOG } from '../commandCatalog.generated';
import { chooseCandidate, LOCAL_AUTO, localCommand, matchCommand, needsServerText, sameTarget } from '../intentMatcher';
import { planTarget, shouldAutoExecute } from '../voiceLogic';
import { normalizeText } from '../voiceNormalize';

const intentOf = (t: string) => matchCommand(t).intent;

test('generated catalogue is present and carries the v1.4.0 intents', () => {
  assert.ok(CATALOG_VERSION.length >= 8);
  const intents = new Set<string>(COMMAND_CATALOG.phrases.map((p) => p.intent));
  for (const i of ['GO_HOME', 'OPEN_PAYOUTS', 'OPEN_CASES', 'OPEN_TA_INF', 'OPEN_OFFER', 'OPEN_HELP', 'SHOW_RC_PENDENCY', 'START_ESIGN']) assert.ok(intents.has(i), i);
  assert.ok((COMMAND_CATALOG.destructive as readonly string[]).includes('START_ESIGN'));
});

test('exact keywords act (auto band, keyword method)', () => {
  for (const [t, i] of [
    ['open portfolio', 'OPEN_PORTFOLIO'], ['Go home', 'GO_HOME'], ['open payouts', 'OPEN_PAYOUTS'], ['show pending disbursals', 'SHOW_PENDING_DISBURSALS'],
    ['show RC pendency', 'SHOW_RC_PENDENCY'], ['open cases', 'OPEN_CASES'], ['start face KYC', 'START_FACE_KYC'], ['open help', 'OPEN_HELP'],
  ] as const) {
    const m = matchCommand(t);
    assert.equal(m.intent, i, t);
    assert.equal(m.band, 'auto', t);
    assert.equal(m.method, 'keyword', t);
  }
});

test('fuzzy typos still land', () => {
  assert.equal(intentOf('opn portfolo'), 'OPEN_PORTFOLIO');
  assert.equal(intentOf('shwo pending disbursels'), 'SHOW_PENDING_DISBURSALS');
  // A typo that sits between two commands is a "Did you mean", with the right one offered.
  const amb = matchCommand('show overdew cases');
  assert.equal(amb.band, 'confirm');
  assert.ok(amb.candidates.some((c) => c.intent === 'SHOW_OVERDUE_CASES'));
  const m = matchCommand('opn portfolo');
  assert.equal(m.method, 'fuzzy');
  assert.ok(m.score >= 0.6);
});

test('known ASR confusions: TA/DA, payouts/layouts, dikhao/decal, Hi and', () => {
  assert.equal(intentOf('open TA'), 'OPEN_TA_INF');
  assert.equal(intentOf('open DA'), 'OPEN_TA_INF');
  assert.equal(intentOf('open T.A.'), 'OPEN_TA_INF');
  assert.equal(intentOf('open layouts'), 'OPEN_PAYOUTS');
  assert.equal(intentOf('show my layouts'), 'OPEN_PAYOUTS');
  assert.equal(intentOf('pending disbursals decal'), 'SHOW_PENDING_DISBURSALS');
  assert.equal(intentOf('overdue cases decal'), 'SHOW_OVERDUE_CASES');
  assert.equal(intentOf('Hi and Zippy'), 'TALK_TO_ZIPPY');
  assert.equal(normalizeText("Hi, I'm Zippy"), normalizeText('Hi and Zippy'));
});

test('Hinglish verbs (dikhao, kholo, batao, chalo) and Devanagari', () => {
  assert.equal(intentOf('portfolio dikhao'), 'OPEN_PORTFOLIO');
  assert.equal(intentOf('payouts kholo'), 'OPEN_PAYOUTS');
  assert.equal(intentOf('overdue cases batao'), 'SHOW_OVERDUE_CASES');
  assert.equal(intentOf('home chalo'), 'GO_HOME');
  assert.equal(intentOf('TA kholo'), 'OPEN_TA_INF');
  assert.equal(intentOf('face KYC shuru karo'), 'START_FACE_KYC');
  assert.equal(intentOf('QR wali journey chalu karo'), 'START_QR_JOURNEY');
  // hi-IN recognizer output comes back in Devanagari.
  assert.equal(intentOf('क्यूआर जर्नी शुरू करो'), 'START_QR_JOURNEY');
  assert.equal(intentOf('मुझे लोन चाहिए'), 'START_NEW_LOAN');
});

test('loan + QR mention goes to the QR journey; SCAN_QR is an alias', () => {
  assert.equal(intentOf('scan QR'), 'START_QR_JOURNEY');
  assert.equal(intentOf('new loan with QR'), 'START_QR_JOURNEY');
});

test('low confidence → "Did you mean" (clarify with candidates), nothing auto-runs', () => {
  const m = matchCommand('show me the pending stuff');
  assert.notEqual(m.band, 'auto');
  const cmd = localCommand('show me the pending stuff', m);
  assert.ok(cmd.status === 'clarify' || cmd.status === 'retry');
  assert.equal(shouldAutoExecute(cmd, false), false);
  assert.deepEqual(planTarget(cmd), { kind: 'none' });
  if (cmd.status === 'clarify') assert.ok((cmd.candidates?.length ?? 0) >= 1);
});

test('gibberish is retry with no noisy candidates', () => {
  const m = matchCommand('zxqv blorp');
  assert.equal(m.band, 'retry');
  assert.ok(m.candidates.every((c) => c.score >= 0.45));
  assert.equal(localCommand('zxqv blorp', m).status, 'retry');
  assert.equal(matchCommand('').intent, 'UNKNOWN');
});

test('auto command is shaped like a server reply and auto-executes', () => {
  const cmd = localCommand('open payouts', matchCommand('open payouts'));
  assert.equal(cmd.status, 'ok');
  assert.equal(cmd.engine, 'device');
  assert.deepEqual(cmd.action, { type: 'navigate', route: 'Payouts' });
  assert.equal(cmd.responseText, 'Opening payouts.');
  assert.equal(shouldAutoExecute(cmd, false), true);
  assert.equal(shouldAutoExecute(cmd, true), false, 'Ask before acting still forces Confirm');
});

test('destructive intents never auto-act, even on an exact keyword', () => {
  for (const t of ['start e-sign', 'set up UPI mandate', 'confirm offer', 'upload RC', 'take delivery photo', 'open UPI app']) {
    const m = matchCommand(t);
    assert.ok(m.score >= LOCAL_AUTO, t);
    const cmd = localCommand(t, m);
    assert.equal(cmd.autoExecute, false, t);
    assert.equal(shouldAutoExecute(cmd, false), false, t);
  }
});

test('assistant intents keep their read-out action', () => {
  const cmd = localCommand('what can I say', matchCommand('what can I say'));
  assert.deepEqual(cmd.action, { type: 'assistant', action: 'list_commands' });
  assert.deepEqual(planTarget(cmd), { kind: 'assistant' });
});

test('chooseCandidate stages the pick with its catalogue action and reply', () => {
  const clar = localCommand('x', { ...matchCommand('open payouts'), band: 'confirm', candidates: [{ intent: 'OPEN_PAYOUTS', phrase: 'Open payouts', score: 0.7 }, { intent: 'WHAT_CAN_I_SAY', phrase: 'What can I say', score: 0.6 }] });
  assert.equal(clar.status, 'clarify');
  const a = chooseCandidate(clar, clar.candidates![0]);
  assert.deepEqual(a.action, { type: 'navigate', route: 'Payouts' });
  assert.equal(a.responseText, 'Opening payouts.');
  const b = chooseCandidate(clar, clar.candidates![1]);
  assert.deepEqual(b.action, { type: 'assistant', action: 'list_commands' });
});

test('slots, numbers, OTP screens and option screens go to the server text path', () => {
  assert.equal(needsServerText('open payouts'), false);
  assert.equal(needsServerText('new loan for Ramesh, Activa 125'), true);
  assert.equal(needsServerText('nine eight two'), false);
  assert.equal(needsServerText('9820012345'), true);
  assert.equal(needsServerText('open payouts', { expect: 'otp' }), true);
  assert.equal(needsServerText('xtreme', { options: [{}] }), true);
});

test('sameTarget compares actions, not wording', () => {
  const a = localCommand('open payouts', matchCommand('open payouts'));
  const b = localCommand('show my payouts', matchCommand('show my payouts'));
  const c = localCommand('open portfolio', matchCommand('open portfolio'));
  assert.equal(sameTarget(a, b), true);
  assert.equal(sameTarget(a, c), false);
});

test('matcher is fast (p95 under 5 ms per utterance in Node)', () => {
  const xs: number[] = [];
  const utter = ['open payouts', 'pending disbursals dikhao', 'opn portfolo', 'new loan for ramesh activa 125 down payment 15000', 'zxqv blorp'];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    matchCommand(utter[i % utter.length]);
    xs.push(performance.now() - t0);
  }
  xs.sort((x, y) => x - y);
  assert.ok(xs[Math.floor(xs.length * 0.95)] < 5, `p95 ${xs[Math.floor(xs.length * 0.95)]}`);
});
