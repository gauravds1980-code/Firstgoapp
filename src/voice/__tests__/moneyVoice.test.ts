/**
 * v1.4.6 Money in flight by voice: the phone's own reading of the new phrases (Hinglish + English), the answer per
 * dealer (gated Hero → polite not-available; 1111 → summary / Ramesh's file / stuck), and that "proceed" /
 * "aage chaliye" and the old commands are untouched. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDealerProfile } from '../../services/dealer';
import { isMoneyInFlightEnabled, MIF_NOT_AVAILABLE, mifFilesFor } from '../../services/moneyInFlight';
import { answerMoneyQuery, mifLocalCommand, moneyQueryFor, nameFromQuestion, mifNorm, parseMoneyQuery } from '../moneyVoice';
import { isAdvancePhrase } from '../voiceStep';
import { matchCommand } from '../intentMatcher';
import { CUE_CASES } from './cueSentences';

const ctxFor = (m: string, openLan: string | null = null) => {
  const p = mockDealerProfile(m).profile;
  return { enabled: isMoneyInFlightEnabled(p), files: mifFilesFor(m, p), openLan };
};
const kind = (t: string) => parseMoneyQuery(t)?.kind ?? null;

test('list phrases: mera paisa kahan hai / where is my money / money in flight', () => {
  for (const t of ['mera paisa kahan hai', 'Mera paisa kahaan hai?', 'paisa kahan hai', 'where is my money', "where's my money", 'Where is my money?', 'money in flight',
    'open money in flight', 'pending credits dikhao', 'मेरा पैसा कहाँ है']) {
    assert.equal(kind(t), 'list', t);
  }
});

test('stuck phrases: kaunsi file atki hai / which file is stuck', () => {
  for (const t of ['kaunsi file atki hai', 'kaun si file atki hai', 'konsi file atki hai?', 'which file is stuck', 'Which files are stuck?', 'stuck files', 'overdue files dikhao', 'show stuck files']) {
    assert.equal(kind(t), 'stuck', t);
  }
});

test("file phrases carry the name: Ramesh ka paisa aaya? / has Ramesh's money come", () => {
  const cases: [string, string][] = [
    ['Ramesh ka paisa aaya?', 'ramesh'], ['ramesh ka paisa aaya kya', 'ramesh'], ['Ramesh Jadhav ka paisa aa gaya?', 'ramesh jadhav'],
    ["has Ramesh's money come", 'ramesh'], ["Has Ramesh's money come in?", 'ramesh'], ['has ramesh money come', 'ramesh'],
    ['Pooja ki file kahan hai', 'pooja'], ["did Rahul's money come", 'rahul'], ["is Rahul's money credited", 'rahul'], ["where is Pooja's money", 'pooja'],
  ];
  for (const [t, name] of cases) {
    const q = parseMoneyQuery(t);
    assert.equal(q?.kind, 'file', t);
    assert.equal(q?.name, name, t);
  }
  assert.equal(parseMoneyQuery('is loan ka paisa aaya ya nahi')?.kind, 'file');
  assert.equal(parseMoneyQuery('is loan ka paisa aaya ya nahi')?.name, undefined, 'no name: the open file');
  assert.equal(nameFromQuestion(mifNorm('mera paisa kahan hai')), undefined);
});

test('today / query phrases', () => {
  assert.equal(kind('aaj kitna credit hua'), 'today');
  assert.equal(kind("today's credits"), 'today');
  assert.equal(kind('raise a query'), 'query');
  assert.equal(kind('is file pe query raise karo'), 'query');
});

test('never steals other commands: proceed / aage chaliye, payouts, commission, RC pendency, loans', () => {
  for (const t of ['proceed', 'aage chaliye', 'aage badho', 'go ahead', 'open payouts', 'show my commission', 'payouts dikhao', 'RC pendency',
    'show pending disbursals', 'new loan', 'loan chahiye', 'open portfolio', 'go home', 'update Vikram Rao', 'open Rahul Sharma', 'Show overdue cases',
    'repay 80000', 'enhance my limit', 'loan amount 1 lakh', 'what is the EMI']) {
    assert.equal(parseMoneyQuery(t), null, t);
  }
  assert.ok(isAdvancePhrase('proceed') && isAdvancePhrase('aage chaliye'), 'ADVANCE grammar unchanged');
});

test('Hero default dealer (new TW only): every MIF question → polite not-available, nothing opens', () => {
  const ctx = ctxFor('9876543210');
  assert.equal(ctx.enabled, false);
  for (const t of ['mera paisa kahan hai', 'Ramesh ka paisa aaya?', 'kaunsi file atki hai', 'where is my money']) {
    const a = answerMoneyQuery(parseMoneyQuery(t)!, ctx);
    assert.deepEqual(a, { kind: 'gated', say: MIF_NOT_AVAILABLE }, t);
  }
  assert.equal(MIF_NOT_AVAILABLE, 'Money in flight is not available for new two-wheeler dealers yet.');
});

test('1111: summary, Ramesh opens his sheet with a spoken status, stuck opens the Stuck filter', () => {
  const ctx = ctxFor('9822011111');
  const list = answerMoneyQuery(parseMoneyQuery('mera paisa kahan hai')!, ctx);
  assert.equal(list.kind, 'open');
  assert.deepEqual(list.kind === 'open' && list.params, { filter: 'all' });
  assert.equal(list.kind === 'open' && list.say, '5 files in flight, 22.9 lakh. 2 overdue.');

  const ramesh = answerMoneyQuery(parseMoneyQuery('Ramesh ka paisa aaya?')!, ctx);
  assert.equal(ramesh.kind, 'open');
  assert.deepEqual(ramesh.kind === 'open' && ramesh.params, { lan: 'CR-20424' });
  assert.match(ramesh.kind === 'open' ? ramesh.say : '', /^Ramesh Jadhav, Maruti Swift\. Not credited yet/);
  const en = answerMoneyQuery(parseMoneyQuery("has Ramesh's money come")!, ctx);
  assert.deepEqual(en.kind === 'open' && en.params, { lan: 'CR-20424' });

  const rahul = answerMoneyQuery(parseMoneyQuery('Rahul ka paisa aaya?')!, ctx);
  assert.equal(rahul.kind === 'open' && rahul.say, "Rahul's money has come. 1.35 lakh credited today at 9:43 AM.");

  const stuck = answerMoneyQuery(parseMoneyQuery('kaunsi file atki hai')!, ctx);
  assert.deepEqual(stuck.kind === 'open' && stuck.params, { filter: 'stuck' });
  assert.match(stuck.kind === 'open' ? stuck.say : '', /Oldest is Pooja Iyer, RC copy pending, 6 days\.$/);

  const unknown = answerMoneyQuery(parseMoneyQuery('Sanjay Pawar ka paisa aaya?')!, ctx);
  assert.equal(unknown.kind, 'absent');
  assert.equal(unknown.say, 'Sanjay Pawar is not on this list.');

  // "is loan ka paisa aaya" with Pooja's sheet open → Pooja.
  const open = answerMoneyQuery(parseMoneyQuery('is loan ka paisa aaya')!, ctxFor('9822011111', 'TW-184408'));
  assert.deepEqual(open.kind === 'open' && open.params, { lan: 'TW-184408' });
  // Raise a query: the open file, else the oldest overdue.
  const q = answerMoneyQuery(parseMoneyQuery('raise a query')!, ctx);
  assert.deepEqual(q.kind === 'open' && q.params, { lan: 'TW-184408', query: true });
});

test('two files with one first name are clarified (3333 has Divya / Suresh once each; 2222 + names)', () => {
  // Two "Anita Shah" never share one dealer; build a clarify case from 3333 + a duplicate first name.
  const ctx = ctxFor('9822013333');
  const files = [...ctx.files, { ...ctx.files.find((f) => f.customer === 'Divya Menon')!, lan: 'CV-39999', customer: 'Divya Rao', vehicle: 'Tata Ace Gold' }];
  const a = answerMoneyQuery(parseMoneyQuery('Divya ka paisa aaya?')!, { ...ctx, files });
  assert.equal(a.kind, 'clarify');
  assert.match(a.say, /^Divya Menon, Tata Intra V30 or Divya Rao, Tata Ace Gold\?$/);
});

test('server / Whisper MIF intent → same reading (name from the transcript); old server intent kept', () => {
  assert.deepEqual(moneyQueryFor({ intent: 'SHOW_FILE_MONEY_STATUS', transcript: 'Ramesh ka paisa aaya' }), { kind: 'file', intent: 'SHOW_FILE_MONEY_STATUS', name: 'ramesh' });
  assert.deepEqual(moneyQueryFor({ intent: 'SHOW_MONEY_IN_FLIGHT', transcript: 'paisa' }), { kind: 'list', intent: 'SHOW_MONEY_IN_FLIGHT' });
  assert.equal(moneyQueryFor({ intent: 'OPEN_PAYOUTS', transcript: 'open payouts' }), null);
  // An older server that answered UNKNOWN for the Hinglish phrase: the transcript still decides.
  assert.equal(moneyQueryFor({ intent: 'UNKNOWN', transcript: 'mera paisa kahan hai' })?.kind, 'list');
  const cmd = mifLocalCommand('mera paisa kahan hai', parseMoneyQuery('mera paisa kahan hai')!);
  assert.equal(cmd.intent, 'SHOW_MONEY_IN_FLIGHT');
  assert.equal(cmd.action.type, 'navigate');
});

test('regenerated command catalogue: the phone matcher knows the new intents', () => {
  assert.equal(matchCommand('money in flight').intent, 'SHOW_MONEY_IN_FLIGHT');
  assert.equal(matchCommand('where is my money').intent, 'SHOW_MONEY_IN_FLIGHT');
  assert.equal(matchCommand('which file is stuck').intent, 'SHOW_STUCK_FILES');
  assert.equal(matchCommand('proceed').intent, 'ADVANCE');
  assert.equal(matchCommand('aage chaliye').intent, 'ADVANCE');
  assert.equal(matchCommand('open payouts').intent, 'OPEN_PAYOUTS');
});

test('the shared cue sentences (server + app) are never read as a Money-in-flight question', () => {
  const stolen = CUE_CASES.filter((c) => !c.e.startsWith('SHOW_MONEY') && !c.e.startsWith('SHOW_STUCK') && parseMoneyQuery(c.t)).map((c) => c.t);
  assert.deepEqual(stolen, []);
});
