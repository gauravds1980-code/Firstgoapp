/**
 * v1.4.7 alerts by voice: the phone's reading of the new phrases (Hinglish + English), the answer per dealer (inbox /
 * Piper readout / settings), and that Money-in-flight, Payouts, proceed and the shared cue sentences are untouched. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDealerProfile } from '../../services/dealer';
import { EMPTY_INBOX, markAllRead, seedAlertsFor } from '../../services/alerts';
import { MIF_NOW } from '../../services/moneyInFlight';
import { alertsLocalCommand, alertsQueryFor, answerAlertsQuery, parseAlertsQuery } from '../alertsVoice';
import { parseMoneyQuery } from '../moneyVoice';
import { isAdvancePhrase } from '../voiceStep';
import { matchCommand } from '../intentMatcher';
import { CUE_CASES } from './cueSentences';

const kind = (t: string) => parseAlertsQuery(t)?.kind ?? null;
const ctx = (m: string) => { const p = mockDealerProfile(m).profile; return { events: seedAlertsFor(m, p), inbox: EMPTY_INBOX }; };

test('SHOW_ALERTS phrases (Hinglish + English)', () => {
  for (const t of ['alerts dikhao', 'naya alert kya hai', 'show my alerts', 'kya naya hai', 'notifications dikhao', 'alerts kholo', 'open alerts',
    'show notifications', 'any new alerts', 'koi naya alert hai', 'Alerts', 'naye alerts aaye', 'what\'s new', 'अलर्ट्स दिखाओ']) {
    assert.equal(kind(t), 'show', t);
  }
});

test('READ_ALERTS phrases', () => {
  for (const t of ['read my alerts', 'aaj ke alerts padh ke sunao', 'alerts padh ke sunao', 'alerts sunao', 'read alerts', 'read out my notifications',
    'naye alerts sunao', 'alerts padho', 'read my notifications']) {
    assert.equal(kind(t), 'read', t);
  }
});

test('OPEN_ALERT_SETTINGS phrases ("band karo" opens settings, never switches off by itself)', () => {
  for (const t of ['notification settings kholo', 'alerts band karo', 'open notification settings', 'alert settings', 'quiet hours', 'turn off alerts', 'notifications band kar do']) {
    assert.equal(kind(t), 'settings', t);
  }
});

test('not alerts: Money in flight, Payouts, proceed, other commands', () => {
  for (const t of ['mera paisa kahan hai', 'aaj kitna credit hua', 'which file is stuck', 'open payouts', 'commission alerts', 'proceed', 'aage chaliye',
    'start QR', 'Ramesh ka paisa aaya', 'show cases', 'open RC pendency', 'invoice dikhao']) {
    assert.equal(kind(t), null, t);
  }
  // The other way round: alert phrases are not Money-in-flight questions.
  for (const t of ['alerts dikhao', 'read my alerts', 'naya alert kya hai', 'notification settings kholo']) assert.equal(parseMoneyQuery(t), null, t);
  assert.equal(isAdvancePhrase('proceed'), true);
  assert.equal(isAdvancePhrase('aage chaliye'), true);
});

test('shared cue sentences are not stolen by the alerts parser', () => {
  const stolen = CUE_CASES.filter((c) => !/ALERT/.test(c.e) && parseAlertsQuery(c.t)).map((c) => c.t);
  assert.deepEqual(stolen, []);
});

test('answers: show → inbox with the count; read → Piper readout (Hinglish); settings → AlertSettings', () => {
  const c = ctx('9800001111');
  const show = answerAlertsQuery({ kind: 'show', intent: 'SHOW_ALERTS' }, c);
  assert.equal(show.route, 'Alerts');
  assert.equal(show.toast, 'Alerts · 3 unread');
  assert.ok(show.say.startsWith('Teen naye alerts.'), show.say);
  const read = answerAlertsQuery({ kind: 'read', intent: 'READ_ALERTS' }, c);
  assert.equal(read.readAloud, true);
  assert.ok(read.say.includes('Neha ka 6.62 lakh credit ho gaya.'), read.say);
  assert.ok(!/\d{10}/.test(read.say));
  const set = answerAlertsQuery({ kind: 'settings', intent: 'OPEN_ALERT_SETTINGS' }, c);
  assert.equal(set.route, 'AlertSettings');
  // Hero: commission only.
  const hero = answerAlertsQuery({ kind: 'read', intent: 'READ_ALERTS' }, ctx('9800004444'));
  assert.ok(hero.say.startsWith('Ek naya alert.'), hero.say);
  assert.ok(hero.say.includes('payout claim ke liye ready hai'), hero.say);
  // All read → today's alerts.
  const all = { ...c, inbox: markAllRead(EMPTY_INBOX, c.events, MIF_NOW) };
  assert.equal(answerAlertsQuery({ kind: 'show', intent: 'SHOW_ALERTS' }, all).toast, 'Opening Alerts');
});

test('server / Whisper intent or transcript lands the same; local command shape', () => {
  assert.deepEqual(alertsQueryFor({ intent: 'READ_ALERTS', transcript: 'whatever' }), { kind: 'read', intent: 'READ_ALERTS' });
  assert.deepEqual(alertsQueryFor({ intent: 'UNKNOWN', transcript: 'alerts dikhao' }), { kind: 'show', intent: 'SHOW_ALERTS' });
  const cmd = alertsLocalCommand('alerts dikhao', { kind: 'show', intent: 'SHOW_ALERTS' });
  assert.equal(cmd.intent, 'SHOW_ALERTS');
  assert.equal(cmd.transcript, 'alerts dikhao');
});

test('regenerated catalogue: the phone matcher knows the new intents too', () => {
  assert.equal(matchCommand('alerts dikhao').intent, 'SHOW_ALERTS');
  assert.equal(matchCommand('read my alerts').intent, 'READ_ALERTS');
  assert.equal(matchCommand('notification settings kholo').intent, 'OPEN_ALERT_SETTINGS');
  assert.equal(matchCommand('open payouts').intent, 'OPEN_PAYOUTS');
  assert.equal(matchCommand('money in flight').intent, 'SHOW_MONEY_IN_FLIGHT');
});
