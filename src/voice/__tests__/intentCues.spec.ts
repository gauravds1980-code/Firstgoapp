/**
 * v1.4.2 dispersed cues, guards, Hindi / Hinglish / Devanagari, vehicle model entity (pure).
 * Imported by intentMatcher.test.ts (tsconfig.voicetest.json lists test files explicitly), so it runs
 * with `npm run test:voice`. The sentence list is shared with firstgo-voice-local/tests/test_cues.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_CATALOG } from '../commandCatalog.generated';
import {
  CONFIRM_SERVER_BUDGET_MS, clausePlan, collapseNumberWords, cueScore, detectVehicle, isQrQuestion, localCommand, matchCommand,
  needsServerText, preferServerOnConfirm, shouldAskServerOnConfirm, vehicleTokens,
} from '../intentMatcher';
import { normalizeText } from '../voiceNormalize';
import { CUE_CASES, type CueCase } from './cueSentences';

const LOAN = new Set(['START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'NEW_TWO_WHEELER_LOAN', 'NEW_CAR_LOAN', 'NEW_CONSUMER_DURABLE_LOAN']);
const run = (t: string) => { const m = matchCommand(t); return { m, c: localCommand(t, m) }; };
const intentOk = (e: string, i: string) => (e === 'LOAN' ? LOAN.has(i) : i === e);

function verdict(s: CueCase): string | null {
  const { m, c } = run(s.t);
  const band = c.confidenceBand;
  const intent = c.intent === 'UNKNOWN' ? m.intent : c.intent;
  const why = `${JSON.stringify(s.t)} → ${intent} ${m.score} ${band} guard=${m.guard ?? '-'}`;
  if (s.w === 'auto') {
    if (!(intentOk(s.e, c.intent) && band === 'auto' && c.autoExecute)) return why;
    if (s.asset && c.slots?.assetId !== s.asset) return `${why} assetId=${c.slots?.assetId}`;
  } else if (s.w === 'confirm') {
    if (!(intentOk(s.e, intent) && c.autoExecute !== true && (band === 'confirm' || band === 'clarify'))) return why;
  } else if (s.w === 'clarify') {
    const ids = (c.candidates ?? []).map((x) => x.option?.id);
    if (c.status !== 'clarify' || c.autoExecute) return why;
    for (const a of s.ambig ?? []) if (!ids.includes(a)) return `${why} missing ${a}`;
  } else if (s.w === 'not_auto') {
    if (c.autoExecute) return why;
  }
  return null;
}

test('cue syntax is exported in the catalogue (normalized token lists, ≥ 2 groups each)', () => {
  const cues = COMMAND_CATALOG.cues as unknown as { intent: string; groups: string[][][] }[];
  const intents = new Set(cues.map((c) => c.intent));
  for (const i of ['START_QR_JOURNEY', 'START_MOBILE_JOURNEY', 'START_NEW_LOAN', 'OPEN_PAYOUTS', 'OPEN_PORTFOLIO', 'OPEN_CASES', 'OPEN_TA_INF', 'OPEN_HELP',
    'SHOW_PENDING_DISBURSALS', 'SHOW_OVERDUE_CASES', 'START_KYC', 'START_FACE_KYC', 'SCAN_AADHAAR', 'SCAN_PAN', 'SHOW_EMI',
    'START_ESIGN', 'SETUP_UPI_MANDATE', 'UPLOAD_RC', 'CONFIRM_OFFER']) assert.ok(intents.has(i), i);
  for (const c of cues) assert.ok(c.groups.length >= 2, c.intent);
});

test('shared sentence list: every case lands as expected on the phone matcher', () => {
  const fails = CUE_CASES.map(verdict).filter(Boolean);
  assert.deepEqual(fails, []);
});

test('required QR sentences auto-start the QR journey (incl. Hindi / Devanagari / dispersed)', () => {
  for (const t of ["let's start a QR journey on the device", 'can you please start for me the new customer QR wala journey', 'QR se journey start karo',
    'start QR', 'QR को चलाओ', 'क्यूआर चालू करो', 'कयूआर चालू करो', 'QR शुरू करो', 'bhai jaldi se customer ke liye QR wali journey chalu kar do',
    'okay so now I want you to open the QR thing for this customer', "please scan the customer's QR code and start the journey", 'start QR journey for Xtreme 125R']) {
    const { c } = run(t);
    assert.equal(c.intent, 'START_QR_JOURNEY', t);
    assert.equal(c.autoExecute, true, t);
  }
});

test('a lone object cue (no verb) does not lift anything; a full cue set beats filler', () => {
  const qr = (COMMAND_CATALOG.cues as unknown as { intent: string; groups: string[][][]; negatives: string[][] }[]).find((c) => c.intent === 'START_QR_JOURNEY')!;
  assert.equal(cueScore(qr, ['qr', 'wala', 'customer']), 0);
  assert.ok(Math.abs(cueScore(qr, ['okay', 'so', 'start', 'for', 'this', 'customer', 'qr']) - 0.9) < 1e-9);
  // Short cues are exact: "rs" is not "rc", "car" is not "qr".
  const rc = (COMMAND_CATALOG.cues as unknown as { intent: string; groups: string[][][]; negatives: string[][] }[]).find((c) => c.intent === 'UPLOAD_RC')!;
  assert.equal(cueScore(rc, ['upload', 'rs']), 0);
  assert.ok(cueScore(rc, ['upload', 'rc']) > 0.85);
  assert.equal(cueScore(qr, ['start', 'car']), 0);
  // Fuzzy longer cues still hit: "strt QR".
  assert.ok(cueScore(qr, ['strt', 'qr']) >= 0.85);
});

test('QR questions never start the journey; "how do I start…" is at most a Confirm', () => {
  for (const t of ['What is a QR code?', 'QR kya hota hai', 'QR code ka matlab kya hai', 'क्यूआर कोड क्या है', 'what is the QR journey',
    'how does the QR journey work', 'QR journey ka matlab kya hai']) {
    assert.ok(isQrQuestion(t), t);
    const { c } = run(t);
    assert.notEqual(c.autoExecute, true, t);
  }
  const { m, c } = run('how do I start a QR journey?');
  assert.equal(m.guard, 'question');
  assert.equal(c.autoExecute, false);
  assert.equal(c.confidenceBand, 'confirm');
});

test('guard-set confirms are never promoted to auto by localCommand (audit bug, line ~153)', () => {
  for (const t of ['how does the QR journey work', "don't go home", 'do not open payouts', 'QR journey start mat karo', "cancel, I don't want the portfolio"]) {
    const { m, c } = run(t);
    assert.ok(m.guard || m.band !== 'auto', t);
    assert.notEqual(c.autoExecute, true, t);
  }
});

test('negations: confirm or retry, never auto (English, Hinglish, Devanagari)', () => {
  for (const t of ["don't start QR", 'QR mat chalao', 'QR journey start mat karo', 'abhi QR nahi', 'do not open payouts', 'QR मत चलाओ', 'नहीं', "don't go home", 'my bike won\'t start']) {
    assert.notEqual(run(t).c.autoExecute, true, t);
  }
});

test('negated clause + positive clause: act on the positive one, never QR', () => {
  assert.deepEqual(clausePlan("don't start the QR journey, open payouts"), { positive: 'open payouts', negated: "don't start the QR journey" });
  const a = run("don't start the QR journey, open payouts");
  assert.equal(a.c.intent, 'OPEN_PAYOUTS');
  assert.equal(a.c.autoExecute, true);
  const b = run('not the QR one, start the mobile journey');
  assert.ok(LOAN.has(b.c.intent), b.c.intent);
  assert.notEqual(run('QR nahi, mobile number wali journey chahiye').c.intent, 'START_QR_JOURNEY');
  // Same thing negated and asked → Confirm.
  assert.notEqual(run("don't open payouts, open payouts").c.autoExecute, true);
});

test('unrelated start / open sentences do not auto-run anything', () => {
  for (const t of ['start the car engine', 'the shop opens at ten', "my bike won't start", 'open the window please']) assert.notEqual(run(t).c.autoExecute, true, t);
});

test('Hindi normalisation lands on the same canonical tokens as the server', () => {
  assert.equal(normalizeText('QR को चलाओ'), 'qr ko start');
  assert.equal(normalizeText('क्यूआर चालू करो'), 'qr start karo');
  assert.equal(normalizeText('कयूआर चालू करो'), 'qr start karo');
  assert.equal(normalizeText('क्यू आर'), 'qr');
  assert.equal(normalizeText('पेआउट खोलो'), 'payouts open');
  assert.equal(normalizeText('मेरे पेआउट्स दिखाओ'), 'mere payouts show');
  assert.equal(normalizeText('केस दिखाओ'), 'case show');
  assert.equal(normalizeText('पोर्टफोलियो खोलो'), 'portfolio open');
  assert.equal(normalizeText('होम पर जाओ'), 'home par jao'); // "par" is no longer "for"
  assert.equal(normalizeText('ghar pe le chalo'), 'home pe le chalo'); // "chalo" is no longer "go"
  assert.equal(normalizeText('ग्राहक को बाइक के लिए लोन चाहिए'), 'customer ko bike ke liye loan chahiye');
  for (const [t, i] of [['होम पर जाओ', 'GO_HOME'], ['ghar pe le chalo', 'GO_HOME'], ['home chalo', 'GO_HOME'], ['पोर्टफोलियो दिखाओ', 'OPEN_PORTFOLIO'], ['payout kitna aaya dikhao', 'OPEN_PAYOUTS']] as const) {
    assert.equal(run(t).c.intent, i, t);
  }
  assert.equal(run('ग्राहक को बाइक के लिए लोन चाहिए').c.intent, 'NEW_TWO_WHEELER_LOAN');
  assert.equal(run('customer ko bike ke liye loan chahiye').c.intent, 'NEW_TWO_WHEELER_LOAN');
});

test('vehicle model entity: exact, misspelt, spoken numbers, Devanagari, ambiguous, unknown', () => {
  assert.deepEqual(collapseNumberWords(['one', 'twenty', 'five']), ['125']);
  assert.deepEqual(collapseNumberWords(['three', 'fifty']), ['350']);
  assert.deepEqual(collapseNumberWords(['two', 'hundred']), ['200']);
  assert.deepEqual(collapseNumberWords(['one', 'hundred', 'twenty', 'five']), ['125']);
  assert.deepEqual(vehicleTokens('loan for four people'), ['loan', 'for', '4', 'people']); // never "44"
  assert.deepEqual(vehicleTokens('एक्सट्रीम वन ट्वेंटी फाइव आर'), ['xtreme', '125', 'ar']);
  for (const t of ['Xtreme 125R', 'extreme 125 R', 'xtreme one twenty five R', 'एक्सट्रीम 125R', 'एक्सट्रीम वन ट्वेंटी फाइव आर']) {
    const v = detectVehicle(t);
    assert.equal(v?.status, 'resolved', t);
    assert.equal(v?.model?.id, 'hero-xtreme', t);
  }
  assert.equal(detectVehicle('splender plus')?.model?.id, 'hero-splendor');
  assert.equal(detectVehicle('I want to select Veda')?.model?.id, 'hero-vida');
  assert.equal(detectVehicle('bullet three fifty')?.model?.id, 're-bullet');
  const x = detectVehicle('start QR journey for Xtreme');
  assert.equal(x?.status, 'ambiguous');
  assert.deepEqual(x?.candidates.map((c) => c.id), ['hero-xtreme', 'hero-xtreme-160r']);
  assert.equal(detectVehicle('Apache ka loan')?.status, 'ambiguous');
  assert.equal(detectVehicle('xtreme 200')?.status, 'ambiguous'); // unknown number → Did you mean
  assert.equal(detectVehicle('loan for a Hayabusa'), null); // unknown model: no guess
  assert.equal(detectVehicle('help videos'), null); // "vida" needs an exact match
});

test('vehicle slot on QR and loan intents; ambiguous model → "Did you mean" with option candidates', () => {
  const q = run('start QR journey for Xtreme 125R').c;
  assert.equal(q.intent, 'START_QR_JOURNEY');
  assert.equal(q.slots?.assetId, 'hero-xtreme');
  assert.equal(q.slots?.vehicleCategory, 'TWO_WHEELER');
  const l = run('Xtreme 125R ka loan karna hai').c;
  assert.equal(l.intent, 'NEW_TWO_WHEELER_LOAN');
  assert.equal(l.slots?.assetId, 'hero-xtreme');
  assert.equal(l.slots?.downPayment, undefined); // a model number is never an amount
  const a = run('Apache ka loan chahiye').c;
  assert.equal(a.status, 'clarify');
  assert.deepEqual(a.candidates?.filter((c) => c.option).map((c) => c.option!.id), ['tvs-apache', 'tvs-apache-200']);
  assert.equal(a.candidates?.[0].option?.kind, 'vehicle_model');
  // A model named with an unrelated command ("go home, extreme 125") is asked, loan first.
  const g = run('So the customer wants to go home, extreme 125, ABS.');
  assert.equal(g.m.guard, 'vehicle_conflict');
  assert.notEqual(g.c.autoExecute, true);
  assert.equal(g.c.candidates?.[0].intent, 'NEW_TWO_WHEELER_LOAN');
  // Digit utterances still go to the server text path (slots / numbers), the local match keeps the model.
  assert.equal(needsServerText('start QR journey for Xtreme 125R'), true);
});

test('QR from any screen: no on-screen options (Payouts, Portfolio, Cases, TA/INF, Home) → local auto', () => {
  for (const t of ['start QR', 'QR journey shuru karo', 'क्यूआर चालू करो']) {
    assert.equal(needsServerText(t, {}), false, t);
    const { c } = run(t);
    assert.equal(c.intent, 'START_QR_JOURNEY', t);
    assert.equal(c.autoExecute, true, t);
  }
});

test('confirm → server helper: plain confirms ask (250 ms budget), guarded ones do not', () => {
  assert.equal(CONFIRM_SERVER_BUDGET_MS, 250);
  const plain = matchCommand('show overdew cases');
  assert.equal(plain.band, 'confirm');
  assert.equal(shouldAskServerOnConfirm(plain), true);
  assert.equal(shouldAskServerOnConfirm(matchCommand("don't go home")), false);
  assert.equal(shouldAskServerOnConfirm(matchCommand('open portfolio')), false); // already auto
  const local = localCommand('show overdew cases', plain);
  const server = { ...local, intent: 'SHOW_OVERDUE_CASES', status: 'ok' as const, confidenceBand: 'auto' as const, autoExecute: true, action: { type: 'navigate' as const, route: 'Cases', filter: 'overdue' } };
  assert.equal(preferServerOnConfirm(local, server), true);
  assert.equal(preferServerOnConfirm(local, { ...server, confidenceBand: 'confirm', autoExecute: false }), false);
  assert.equal(preferServerOnConfirm(local, { ...server, intent: 'START_ESIGN', action: { type: 'navigate', route: 'Esign' } }), false);
});

test('destructive intents never auto-run, whatever the cue score', () => {
  for (const t of ['go ahead and start the e-sign for the customer', 'customer ka UPI mandate set up kar do', 'RC upload karna hai is case ka', 'okay confirm the offer for this customer']) {
    const { m, c } = run(t);
    assert.ok(m.score >= 0.85, t);
    assert.equal(c.autoExecute, false, t);
  }
});

test('latency: the matcher stays fast on the whole list', () => {
  for (const s of CUE_CASES) matchCommand(s.t);
  const t0 = performance.now();
  let worst = 0;
  for (const s of CUE_CASES) { const a = performance.now(); matchCommand(s.t); worst = Math.max(worst, performance.now() - a); }
  const avg = (performance.now() - t0) / CUE_CASES.length;
  assert.ok(avg < 10, `avg ${avg} ms`);
  assert.ok(worst < 50, `worst ${worst} ms`);
});
