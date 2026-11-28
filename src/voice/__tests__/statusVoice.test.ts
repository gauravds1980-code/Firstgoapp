/**
 * v1.4.9 Feature 5 — Hinglish voice status checks: phrase parsing (Hinglish / English / Devanagari), the ClarifySheet
 * flow (several matches + spoken choice), always-speak (Gaurav #1), counts stay on the current screen (Gaurav #2),
 * per-login gating and the hybrid new-TW money line (Gaurav #4), masking, and that money / payout / alerts / proceed
 * readings are untouched. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockDealerProfile } from '../../services/dealer';
import { isMoneyInFlightEnabled, MIF_NOT_AVAILABLE, mifFilesFor } from '../../services/moneyInFlight';
import { statementInvoicesFor } from '../../services/payoutStatement';
import { addWorkingDays, maskMobilesIn, NEW_TW_TAIL, spokenModel, statusFilesFor, todayActivity, todayCounts } from '../../services/loanStatus';
import { TODAY } from '../../services/business';
import {
  answerForChoice, answerStatusQuery, chooseClarify, hybridMoneyAnswer, parseStatusQuery, statusLocalCommand, statusQueryFor, statusUi,
  type StatusVoiceContext,
} from '../statusVoice';
import { answerMoneyQuery, parseMoneyQuery } from '../moneyVoice';
import { parsePayoutQuery } from '../payoutVoice';
import { parseAlertsQuery } from '../alertsVoice';
import { isAdvancePhrase } from '../voiceStep';
import { replyMode, replyModeFor } from '../voiceCues';

const MOB = { '1111': '9800001111', '2222': '9800002222', '3333': '9800003333', hero: '9800004567' } as const;
const ctx = (m: string): StatusVoiceContext => {
  const p = mockDealerProfile(m).profile;
  return { signedIn: true, mifEnabled: isMoneyInFlightEnabled(p), files: statusFilesFor(m, p), invoices: statementInvoicesFor(m, p) };
};
const mifCtx = (m: string) => { const p = mockDealerProfile(m).profile; return { enabled: isMoneyInFlightEnabled(p), files: mifFilesFor(m, p), openLan: null }; };
const kind = (t: string) => parseStatusQuery(t)?.kind ?? null;
const ask = (m: string, t: string) => answerStatusQuery(parseStatusQuery(t)!, ctx(m));
const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8');

/* ---------------- Parsing ---------------- */

test('file status: Hinglish / English / Devanagari carry the name', () => {
  const cases: [string, string][] = [
    ['Ramesh ka loan kahan tak pahuncha', 'ramesh'], ['Ramesh ka loan kahan tak pahuncha?', 'ramesh'], ['ramesh ki file kis stage pe hai', 'ramesh'],
    ["what's the status of Ramesh's loan", 'ramesh'], ['status of Ramesh Jadhav', 'ramesh jadhav'], ['Priya Kulkarni ka status batao', 'priya kulkarni'],
    ["where has Sneha's loan reached", 'sneha'], ['रमेश का लोन कहाँ तक पहुँचा', 'ramesh'], ['रमेश की फाइल किस स्टेज पे है', 'ramesh'],
  ];
  for (const [t, name] of cases) {
    const q = parseStatusQuery(t);
    assert.equal(q?.kind, 'file', t);
    assert.equal(q?.intent, 'SHOW_FILE_STATUS', t);
    assert.equal(q?.name, name, t);
  }
  assert.equal(parseStatusQuery('TW-184210 ka status')?.lan, 'TW-184210');
  assert.equal(parseStatusQuery('cr 20424 kis stage pe hai')?.lan, 'CR-20424');
});

test('count, commission and invoice phrases (Hinglish + English + Devanagari)', () => {
  for (const t of ['aaj kitne approve hue', 'Aaj kitne approve hue?', 'aaj kitni files approve hui', "today's approvals", 'how many were approved today', 'kitne sanctioned aaj', 'aaj kitne sanction hue', 'आज कितने अप्रूव हुए', 'आज कितने सैंक्शन हुए']) assert.equal(kind(t), 'approvals', t);
  for (const t of ['aaj kitne apply hue', 'aaj kitni applications aayi', "today's applications", 'आज कितनी एप्लीकेशन आई']) assert.equal(kind(t), 'applications', t);
  for (const t of ['aaj kitna disburse hua', "today's disbursals", 'disbursed today', 'how much was disbursed today', 'आज कितना डिस्बर्स हुआ']) assert.equal(kind(t), 'disbursals', t);
  for (const t of ['mera commission kab aayega', 'payout kab aayega', 'commission kab credit hoga', 'when will my commission come', 'मेरा कमीशन कब आएगा']) assert.equal(kind(t), 'commission', t);
  for (const t of ['kitna commission pending hai', 'invoices to claim', 'show invoices to claim', 'pending invoices', 'कितना कमीशन पेंडिंग है']) assert.equal(kind(t), 'invoices', t);
});

test('never steals money / payout / alerts / navigation / proceed phrases', () => {
  for (const t of ['mera paisa kahan hai', 'Ramesh ka paisa aaya?', 'Pooja ki file kahan hai', 'aaj kitna credit hua', 'kaunsi file atki hai', 'proceed', 'aage chaliye',
    'आगे चलिए', 'show application status', 'application status', 'payout statement dikhao', 'short payment kahan hai', 'Arjun Mehta ka commission', 'alerts dikhao',
    'kya naya hai', 'open payouts', 'payouts kholo', 'go home', 'mera loan kahan tak pahuncha', 'advance payout kab aayega', 'raise a query']) {
    assert.equal(parseStatusQuery(t), null, t);
  }
  // …and those parsers still read them as before.
  assert.equal(parseMoneyQuery('Ramesh ka paisa aaya?')?.kind, 'file');
  assert.equal(parseMoneyQuery('aaj kitna credit hua')?.kind, 'today');
  assert.equal(parseMoneyQuery('mera paisa kahan hai')?.kind, 'list');
  assert.equal(parsePayoutQuery('payout statement dikhao')?.kind, 'statement');
  assert.equal(parseAlertsQuery('kya naya hai')?.kind !== undefined, true);
  assert.equal(isAdvancePhrase('aage chaliye'), true);
  assert.equal(isAdvancePhrase('proceed'), true);
  // The new phrases are not read by the older parsers in a way that would win first in handleText (payout → alerts).
  for (const t of ['mera commission kab aayega', 'kitna commission pending hai', 'aaj kitne approve hue', 'aaj kitna disburse hua', 'invoices to claim']) {
    assert.equal(parsePayoutQuery(t), null, t);
    assert.equal(parseAlertsQuery(t), null, t);
  }
});

test('server / Whisper intents map back (details from the transcript); "TA INF" stays TaInf', () => {
  assert.deepEqual(statusQueryFor({ intent: 'SHOW_FILE_STATUS', transcript: 'Ramesh ka loan kahan tak pahuncha' }), { kind: 'file', intent: 'SHOW_FILE_STATUS', name: 'ramesh' });
  assert.equal(statusQueryFor({ intent: 'SHOW_TODAYS_APPROVALS', transcript: 'aaj kitne approve hue' })?.kind, 'approvals');
  assert.equal(statusQueryFor({ intent: 'SHOW_INVOICES_TO_CLAIM', transcript: 'TA INF' }), null);
  assert.equal(statusQueryFor({ intent: 'SHOW_INVOICES_TO_CLAIM', transcript: 'invoices to claim' })?.kind, 'invoices');
  // An older server's intent for a status sentence: the phone still reads the transcript.
  assert.equal(statusQueryFor({ intent: 'SHOW_FILE_MONEY_STATUS', transcript: 'Ramesh ka loan kahan tak pahuncha' })?.kind, 'file');
  assert.equal(statusQueryFor({ intent: 'SHOW_APPLICATION_STATUS', transcript: 'show application status' }), null);
  const c = statusLocalCommand('aaj kitne approve hue', parseStatusQuery('aaj kitne approve hue')!);
  assert.equal(c.intent, 'SHOW_TODAYS_APPROVALS');
  assert.equal(c.action.type, 'none');
});

/* ---------------- Clarify ---------------- */

test('1111 "Ramesh ka loan kahan tak pahuncha" → ClarifySheet: Ramesh Jadhav + Ramesh Kale, spoken both', () => {
  const a = ask(MOB['1111'], 'Ramesh ka loan kahan tak pahuncha');
  assert.equal(a.ui, 'clarify');
  if (a.ui !== 'clarify') return;
  assert.deepEqual(a.options.map((f) => f.customer).sort(), ['Ramesh Jadhav', 'Ramesh Kale']);
  assert.match(a.say, /^Do Ramesh hain\. /);
  assert.match(a.say, /Ramesh Jadhav, Swift, aaj approve hua, e-sign pending\? Ya Ramesh Kale, Activa, pehle se disbursed\?$/);
  // Spoken choice: vehicle / LAN tail / full name / ordinal; "proceed" never guesses.
  const by = (t: string) => chooseClarify(t, a.options)?.customer ?? null;
  assert.equal(by('Swift wala'), 'Ramesh Jadhav');
  assert.equal(by('Activa'), 'Ramesh Kale');
  assert.equal(by('Ramesh Kale'), 'Ramesh Kale');
  assert.equal(by('Jadhav'), 'Ramesh Jadhav');
  assert.equal(by('184210'), 'Ramesh Kale');
  assert.equal(by('dusra'), 'Ramesh Kale');
  assert.equal(by('proceed'), null);
  assert.equal(by('aage chaliye'), null);
  assert.equal(by('Ramesh'), null);
  // Choosing Jadhav: in-scope used car → plain status line, no new-TW tail.
  const j = a.options.find((f) => f.customer === 'Ramesh Jadhav')!;
  const ans = answerForChoice(j, ctx(MOB['1111']));
  assert.equal(ans.say, 'Ramesh Jadhav, Swift, aaj approve hua, abhi e-sign pending hai.');
  assert.equal(j.inMif, true);
  assert.equal(j.remind, true);
  const k = a.options.find((f) => f.customer === 'Ramesh Kale')!;
  assert.equal(answerForChoice(k, ctx(MOB['1111'])).say, `Ramesh Kale, Activa, 12 Oct ko disburse ho chuka hai, loan active hai. ${NEW_TW_TAIL}`);
});

test('unique names open the file sheet; unknown names are refused', () => {
  const a = ask(MOB['1111'], 'Priya ka loan kahan tak pahuncha');
  assert.equal(a.ui, 'file');
  if (a.ui === 'file') {
    assert.equal(a.file.lan, 'TW-184401');
    assert.equal(a.say, `Priya Kulkarni, Apache, aaj approve hua, abhi e-sign pending hai. ${NEW_TW_TAIL}`);
    assert.equal(a.tone, 'warning');
    assert.deepEqual(a.file.steps.map((s) => s.state), ['done', 'done', 'done', 'current', 'future', 'future']);
  }
  const lan = ask(MOB['1111'], 'TW-184210 ka status');
  assert.equal(lan.ui === 'file' && lan.file.customer, 'Ramesh Kale');
  const no = ask(MOB['1111'], 'Sanjay Pawar ka loan kahan tak pahuncha');
  assert.deepEqual(no, { ui: 'card', say: 'Sanjay Pawar is not on this list.', tone: 'warning' });
});

/* ---------------- Counts stay on the current screen (Gaurav #2) ---------------- */

test('1111 counts: speak only (card, no route), and match Home Today tiles (3 · 3 · ₹8.6L)', () => {
  const c = todayCounts(ctx(MOB['1111']).files);
  assert.deepEqual(c, { apps: 3, approved: 3, disbursed: 863500, disbursedCount: 3 });
  const a = ask(MOB['1111'], 'aaj kitne approve hue');
  assert.deepEqual(a, { ui: 'card', say: 'Aaj teen files approve hui. Ramesh Jadhav, Priya Kulkarni aur Sneha Joshi.', tone: 'info' });
  assert.equal('route' in a, false);
  const ap = ask(MOB['1111'], 'aaj kitne apply hue');
  assert.equal(ap.ui, 'card');
  assert.equal(ap.say, 'Aaj teen applications aayi. Ramesh Jadhav, Priya Kulkarni aur Sneha Joshi.');
  const d = ask(MOB['1111'], 'aaj kitna disburse hua');
  assert.equal(d.ui, 'card');
  assert.equal(d.say, 'Aaj 8.63 lakh disburse hua, teen files. Neha Deshmukh, Vikram Rao aur Rahul Sharma.');
  // Home's Loans preview rows come from the same list.
  assert.equal(todayActivity(ctx(MOB['1111']).files).length, 6);
});

test('"aaj kitna credit hua" stays Money in flight (credits only) for 1111', () => {
  const mq = parseMoneyQuery('aaj kitna credit hua')!;
  const a = answerMoneyQuery(mq, mifCtx(MOB['1111']));
  assert.equal(a.kind, 'open');
  assert.match(a.say, /3 files credited today, 8\.63 lakh\./);
});

/* ---------------- Commission ---------------- */

test('commission: 1111 opens Payouts on INV/26-27/1196 with the claim + two-to-three-days line', () => {
  assert.equal(TODAY.getDay(), 2); // Tuesday
  assert.equal(addWorkingDays(TODAY, 2).getDay(), 4); // Thursday
  const a = ask(MOB['1111'], 'mera commission kab aayega');
  assert.equal(a.ui, 'navigate');
  if (a.ui !== 'navigate') return;
  assert.equal(a.route, 'Payouts');
  assert.equal(a.params.invoice, 'INV/26-27/1196');
  assert.equal(a.params.period, 'thisMonth');
  assert.equal(a.say, 'Commission invoice 1196, 21 thousand 750 rupees, claim ke liye ready hai. Claim karne ke baad do se teen working days mein account mein aata hai. Aaj Tuesday hai, aaj claim karein to Thursday tak aa sakta hai.');
  const inv = ask(MOB['1111'], 'kitna commission pending hai');
  assert.equal(inv.ui, 'navigate');
  if (inv.ui === 'navigate') { assert.equal(inv.params.filter, 'ready'); assert.match(inv.say, /claim ke liye ready/); }
  // Claimed in this session → "claim ho chuka hai".
  const c = ctx(MOB['1111']);
  const claimed = { ...c, invoices: c.invoices.map((i) => (i.status === 'Not claimed' ? { ...i, status: 'Claimed' as const } : i)) };
  const cl = answerStatusQuery(parseStatusQuery('payout kab aayega')!, claimed);
  assert.match(cl.say, /claim ho chuka hai\. Usually do se teen working days mein credit hota hai\.$/);
});

/* ---------------- Per-login gating (feature 1 segment gate) ---------------- */

test('default Hero (new TW only): money questions → polite unavailable line; status, counts and commission still answer', () => {
  const m = MOB.hero;
  const c = ctx(m);
  assert.equal(c.mifEnabled, false);
  for (const t of ['mera paisa kahan hai', 'aaj kitna credit hua', 'Rakesh ka paisa aaya?']) {
    const mq = parseMoneyQuery(t)!;
    assert.equal(hybridMoneyAnswer(mq, c), null, t); // no hybrid: the gate answers
    assert.deepEqual(answerMoneyQuery(mq, mifCtx(m)), { kind: 'gated', say: MIF_NOT_AVAILABLE }, t);
  }
  assert.equal(ask(m, 'aaj kitne approve hue').say, 'Aaj do files approve hui. Rakesh More aur Swati Kadam.');
  assert.equal(ask(m, 'aaj kitne apply hue').say, 'Aaj teen applications aayi. Rakesh More, Swati Kadam aur Kiran Jadhav.');
  assert.equal(ask(m, 'aaj kitna disburse hua').say, 'Aaj 69 thousand 200 rupees disburse hua, ek file. Ganesh Patil.');
  const f = ask(m, 'Rakesh ka loan kahan tak pahuncha');
  assert.equal(f.ui, 'file');
  assert.equal(f.say, 'Rakesh More, Splendor, aaj approve hua, abhi e-sign pending hai.'); // no MIF tail for a new-TW-only dealer
  assert.equal(f.ui === 'file' && f.tone, 'info');
  const com = ask(m, 'mera commission kab aayega');
  assert.equal(com.ui === 'navigate' && com.params.invoice, 'INV/26-27/1199');
});

test('1111 (mixed dealer): named new-TW money question opens the file with the short line; in-scope names stay feature 1', () => {
  const c = ctx(MOB['1111']);
  const priya = hybridMoneyAnswer(parseMoneyQuery('Priya ka paisa aaya?')!, c);
  assert.equal(priya?.ui, 'file');
  assert.equal(priya?.say, 'Priya Kulkarni new two-wheeler hai, money in flight isme nahi dikhta. Abhi e-sign pending hai.');
  assert.equal(priya?.tone, 'warning');
  const kale = hybridMoneyAnswer(parseMoneyQuery('Ramesh Kale ka paisa aaya?')!, c);
  assert.equal(kale?.say, 'Ramesh Kale new two-wheeler hai, money in flight isme nahi dikhta. File 12 Oct ko disburse ho chuki hai.');
  // v1.4.6 re-base: Pooja (used Pulsar) and Ramesh Jadhav (used Swift) are Money-in-flight files → feature 1 answers.
  assert.equal(hybridMoneyAnswer(parseMoneyQuery('Pooja ka paisa aaya?')!, c), null);
  assert.equal(hybridMoneyAnswer(parseMoneyQuery('Ramesh ka paisa aaya?')!, c), null);
  assert.equal(answerMoneyQuery(parseMoneyQuery('Pooja ka paisa aaya?')!, mifCtx(MOB['1111'])).kind, 'open');
  // Portfolio money question is unchanged.
  assert.match(answerMoneyQuery(parseMoneyQuery('mera paisa kahan hai')!, mifCtx(MOB['1111'])).say, /^5 files in flight, 22\.9 lakh\. 2 overdue\.$/);
  // Choosing a new-TW row on a money ClarifySheet speaks the hybrid line.
  const p = c.files.find((f) => f.customer === 'Priya Kulkarni')!;
  assert.match(answerForChoice(p, c, true).say, /money in flight isme nahi dikhta/);
});

test('2222 / 3333: answers stay inside the dealer (no 1111 names), pre-sanction files get the not-sanctioned line', () => {
  assert.deepEqual(ask(MOB['2222'], 'Ramesh ka loan kahan tak pahuncha'), { ui: 'card', say: 'Ramesh is not on this list.', tone: 'warning' });
  assert.equal(ask(MOB['2222'], 'aaj kitne approve hue').say, 'Aaj abhi tak koi file approve nahi hui.');
  assert.equal(ask(MOB['2222'], 'aaj kitne apply hue').say, 'Aaj ek application aayi. Nikhil Joshi.');
  assert.equal(ask(MOB['2222'], 'aaj kitna disburse hua').say, 'Aaj 5.72 lakh disburse hua, ek file. Meera Pillai.');
  const nik = hybridMoneyAnswer(parseMoneyQuery('Nikhil ka paisa aaya?')!, ctx(MOB['2222']));
  assert.equal(nik?.say, 'Nikhil Joshi ka loan abhi sanction nahi hua, isliye money in flight mein nahi hai. Abhi offer pending hai.');
  assert.equal(ask(MOB['3333'], 'aaj kitna disburse hua').say, 'Aaj 5.12 lakh disburse hua, ek file. Manoj Verma.');
  const sk = ask(MOB['3333'], 'Prakash ka loan kahan tak pahuncha');
  assert.equal(sk.say, 'Prakash Shinde, Intra, aaj apply hua, abhi kyc pending hai.');
  for (const m of [MOB['2222'], MOB['3333']]) assert.equal(ctx(m).files.some((f) => f.customer === 'Priya Kulkarni' || f.lan.startsWith('TW-')), false);
});

/* ---------------- Always speak (Gaurav #1) ---------------- */

test('status answers are always spoken with Piper; other replies keep the spoken-replies flag', () => {
  assert.equal(replyModeFor('status', false), 'speech');
  assert.equal(replyModeFor('status', true), 'speech');
  assert.equal(replyModeFor('other', false), 'cue');
  assert.equal(replyModeFor('other', false), replyMode(false));
  assert.equal(replyModeFor('other', true), 'speech');
  const p = src('voice/piper.ts');
  // Only the status path bypasses the flag; playReply / speak keep their safety net (voiceCues.test.ts checks its shape).
  assert.match(p, /export async function speakStatusAnswer\(.*\n {2}if \(!text\.trim\(\)\) \{ cb\?\.onDone\?\.\(\); return; \}\n {2}return playReplyNow\(text, cb\);/);
  assert.doesNotMatch(p, /googleapis|texttospeech|from 'expo-speech'/i);
  const u = src('voice/useVoiceCommand.ts');
  assert.match(u, /function statusRespond\([\s\S]*?replyModeFor\('status'[\s\S]*?speakStatusAnswer\(/);
  assert.match(u, /const presentStatus = [\s\S]*?statusRespond\(ans\.say, t\.metric\)/);
  // Gated money line + MIF status answers are spoken; a query request keeps the flag.
  assert.match(u, /if \(ans\.kind === 'gated'\) \{[\s\S]*?statusRespond\(ans\.say, t\.metric\)/);
  assert.match(u, /if \(isStatusAsk\) statusRespond\(ans\.say, t\.metric\);\n\s+else voiceRespond/);
  // speakStatusAnswer is used only by the status paths.
  for (const f of ['voice/applyCommand.ts', 'voice/VoiceHost.tsx', 'voice/VoicePreviewSheet.tsx']) assert.doesNotMatch(src(f), /speakStatusAnswer/, f);
});

test('status routing never runs on an OTP turn, and comes after ADVANCE', () => {
  const u = src('voice/useVoiceCommand.ts');
  for (const line of u.split('\n').filter((l) => /parseStatusQuery\(text\)|statusQueryFor\(command\)|statusUi\.clarifyOpen\(\)/.test(l) && !/^\s*(?:\/\/|\*)/.test(l))) {
    assert.ok(/!t\.otp|t\.otp \?|if \(!t\.otp\)/.test(line) || /const (?:sq|cl) = /.test(line), line);
  }
  const adv = u.indexOf('isAdvanceReply(command)');
  assert.ok(adv > 0 && adv < u.indexOf('const sq = statusQueryFor(command)'));
  const ht = u.indexOf('const adv = resolveAdvance(text');
  assert.ok(ht > 0 && ht < u.indexOf('const sq = parseStatusQuery(text)'));
});

/* ---------------- Masking ---------------- */

test('answers never show a full mobile; the on-screen store masks question and answer', () => {
  assert.equal(maskMobilesIn('call 9822011188 now'), 'call ••••••1188 now');
  statusUi.show({ kind: 'card', question: 'Ramesh 9822011188 ka loan', say: 'Mobile 9822011188', tone: 'info' });
  assert.equal(statusUi.get()?.question, 'Ramesh ••••••1188 ka loan');
  assert.equal(statusUi.get()?.say, 'Mobile ••••••1188');
  statusUi.clear();
  assert.equal(statusUi.get(), null);
  for (const m of Object.values(MOB)) {
    for (const f of ctx(m).files) {
      const a = answerForChoice(f, ctx(m));
      assert.doesNotMatch(a.say, /\d{10}/, f.customer);
    }
  }
});

test('spokenModel drops brand and variant words', () => {
  assert.equal(spokenModel('Hero Splendor+'), 'Splendor');
  assert.equal(spokenModel('Honda Activa 6G'), 'Activa');
  assert.equal(spokenModel('Maruti Swift (2021, used)'), 'Swift');
  assert.equal(spokenModel('TVS Apache RTR 160'), 'Apache');
  assert.equal(spokenModel('Tata 407 Gold SFC'), '407 Gold');
});
