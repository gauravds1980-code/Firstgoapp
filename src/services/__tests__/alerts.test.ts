/**
 * v1.4.7 Credit and payout alerts — pure logic: quiet-hours hold / release at 8:00 AM IST (edge times), push batching,
 * dedupe, segment gating of alert types, the short-pay amounts, promotional consent record / withdraw, unread counts
 * per login and the shared (per dealer id) inbox. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDealerProfile } from '../dealer';
import { statementInvoicesFor } from '../payoutStatement';
import { mifFilesFor, MIF_NOW } from '../moneyInFlight';
import {
  addEvent, alertId, alertTypeAllowed, allowedTypes, batchPushes, buildEvent, canSendPromotional, dedupe, defaultPrefs, demoArrival, EMPTY_INBOX,
  fileAlertable, giveConsent, groupAlerts, heldNote, inboxEvents, inQuietHours, istDayKey, istInstant, istMinuteOfDay, markAllRead, markRead,
  planPush, promoLocked, pushReleaseAt, quietLabel, readoutAllowed, readoutLine, reviveInbox, revivePrefs, seedAlertsFor, setPromoSwitch,
  setQuietHours, shortPaysFor, unreadByFilter, unreadCount, withdrawConsent, type InboxState, type QuietHours,
} from '../alerts';

const Q: QuietHours = { enabled: true, startHour: 21, endHour: 8 };
const ist = (d: number, hh: number, mm: number) => istInstant(2026, 10, d, hh, mm); // November 2026, IST wall clock
const login = (m: string) => { const d = mockDealerProfile(m); return { ...d, mobile: m, seeds: seedAlertsFor(m, d.profile) }; };
const L1 = '9800001111', L2 = '9800002222', L3 = '9800003333', HERO = '9800004444';

/* ---------------- Quiet hours ---------------- */

test('IST clock is computed from the instant, not the device timezone', () => {
  // 21:00 IST = 15:30 UTC.
  assert.equal(ist(24, 21, 0).toISOString(), '2026-11-24T15:30:00.000Z');
  assert.equal(istMinuteOfDay(ist(24, 21, 0)), 21 * 60);
  assert.equal(istMinuteOfDay(new Date('2026-11-24T02:30:00Z')), 8 * 60); // 08:00 IST
  // 23:30 IST on the 24th is still the 24th in IST although 18:00 UTC; 00:30 IST on the 25th is the 24th in UTC.
  assert.equal(istDayKey(ist(24, 23, 30)), '2026-11-24');
  assert.equal(istDayKey(ist(25, 0, 30)), '2026-11-25');
});

test('quiet hours edges: 20:59 not held, 21:00 held, 07:59 held, 08:00 not held', () => {
  assert.equal(inQuietHours(ist(24, 20, 59), Q), false);
  assert.equal(inQuietHours(ist(24, 21, 0), Q), true);
  assert.equal(inQuietHours(ist(25, 7, 59), Q), true);
  assert.equal(inQuietHours(ist(25, 8, 0), Q), false);
  assert.equal(inQuietHours(ist(25, 0, 0), Q), true);
  assert.equal(inQuietHours(ist(24, 12, 0), Q), false);
});

test('a held push is released at 8:00 AM IST (next morning from the evening, same morning after midnight)', () => {
  const morning25 = ist(25, 8, 0).toISOString();
  assert.equal(pushReleaseAt(ist(24, 21, 0), Q).toISOString(), morning25);
  assert.equal(pushReleaseAt(ist(24, 23, 30), Q).toISOString(), morning25);
  assert.equal(pushReleaseAt(ist(25, 0, 0), Q).toISOString(), morning25);
  assert.equal(pushReleaseAt(ist(25, 7, 59), Q).toISOString(), morning25);
  // Outside the window: sent at once.
  assert.equal(pushReleaseAt(ist(24, 20, 59), Q).toISOString(), ist(24, 20, 59).toISOString());
  assert.equal(pushReleaseAt(ist(25, 8, 0), Q).toISOString(), ist(25, 8, 0).toISOString());
  // Release instant is 02:30 UTC whatever the device timezone.
  assert.equal(morning25, '2026-11-25T02:30:00.000Z');
});

test('quiet hours off / edited window / non-wrapping window', () => {
  assert.equal(inQuietHours(ist(24, 23, 0), { ...Q, enabled: false }), false);
  const q2: QuietHours = { enabled: true, startHour: 22, endHour: 7 };
  assert.equal(inQuietHours(ist(24, 21, 30), q2), false);
  assert.equal(pushReleaseAt(ist(24, 22, 0), q2).toISOString(), ist(25, 7, 0).toISOString());
  const q3: QuietHours = { enabled: true, startHour: 1, endHour: 6 }; // does not wrap midnight
  assert.equal(inQuietHours(ist(24, 0, 59), q3), false);
  assert.equal(pushReleaseAt(ist(24, 3, 0), q3).toISOString(), ist(24, 6, 0).toISOString());
  assert.equal(quietLabel(Q), '9:00 PM – 8:00 AM');
  // An empty window is refused.
  const p = defaultPrefs();
  assert.deepEqual(setQuietHours(p, { startHour: 8 }).quiet, p.quiet);
  assert.equal(setQuietHours(p, { startHour: 22 }).quiet.startHour, 22);
});

test('NO breakthrough: loan credited and overdue are held like everything else; readout blocked in the window', () => {
  const prefs = defaultPrefs();
  for (const type of ['loan.credited', 'loan.overdue', 'payout.shortPaid'] as const) {
    const p = planPush({ type, at: ist(24, 23, 0) }, prefs);
    assert.equal(p.held, true, type);
    assert.equal(p.deliverAt!.toISOString(), ist(25, 8, 0).toISOString());
  }
  assert.equal(readoutAllowed(ist(24, 21, 0), prefs.quiet), false);
  assert.equal(readoutAllowed(ist(25, 7, 59), prefs.quiet), false);
  assert.equal(readoutAllowed(ist(25, 8, 0), prefs.quiet), true);
  assert.equal(readoutAllowed(ist(24, 20, 59), prefs.quiet), true);
});

test('push switch / type switch: no push planned; overnight burst = one summary push at 8:00', () => {
  const prefs = defaultPrefs();
  assert.equal(planPush({ type: 'loan.credited', at: ist(24, 12, 0) }, { ...prefs, push: false }).send, false);
  assert.equal(planPush({ type: 'loan.credited', at: ist(24, 12, 0) }, { ...prefs, types: { ...prefs.types, 'loan.credited': false } }).reason, 'typeOff');
  const mk = (lan: string, h: number, d = 24) => buildEvent({ type: 'loan.credited', at: ist(d, h, 0), lan, customer: 'Neha Deshmukh', amount: 100000 });
  const batches = batchPushes([mk('CR-1', 22), mk('CR-2', 23), mk('CR-3', 2, 25), mk('CR-4', 12)], prefs);
  assert.equal(batches.length, 2);
  assert.equal(batches[0]!.ids.length, 1); // noon: its own push
  assert.equal(batches[1]!.text, '3 updates waiting');
  assert.equal(batches[1]!.deliverAt.toISOString(), ist(25, 8, 0).toISOString());
});

/* ---------------- Dedupe ---------------- */

test('dedupe: one event id per (type, subject, IST day); a refresh never adds a second "Neha credited"', () => {
  const a = buildEvent({ type: 'loan.credited', at: ist(24, 8, 40), lan: 'CR-20409', customer: 'Neha Deshmukh', amount: 662000 });
  const b = buildEvent({ type: 'loan.credited', at: ist(24, 10, 0), lan: 'CR-20409', customer: 'Neha Deshmukh', amount: 662000 });
  const c = buildEvent({ type: 'loan.credited', at: ist(25, 10, 0), lan: 'CR-20409', customer: 'Neha Deshmukh', amount: 662000 });
  const d = buildEvent({ type: 'loan.blocker', at: ist(24, 10, 0), lan: 'CR-20409', customer: 'Neha Deshmukh', blocker: 'PDD hold' });
  assert.equal(a.id, alertId('loan.credited', 'CR-20409', ist(24, 0, 0)));
  assert.equal(a.id, b.id);
  assert.deepEqual(dedupe([a, b, c, d]).map((e) => e.id), [a.id, c.id, d.id]);

  const u = login(L1);
  const neha = u.seeds.find((e) => e.subject === 'CR-20409')!;
  const replay = { ...neha, seedRead: undefined };
  const r = addEvent(EMPTY_INBOX, u.seeds, replay, defaultPrefs(), u.profile);
  assert.equal(r.added, false);
  assert.equal(r.reason, 'duplicate');
  assert.equal(inboxEvents(u.seeds, r.state).filter((e) => e.subject === 'CR-20409').length, 1);
});

test('arrival: added once, unread; a second try is a duplicate; a switched-off type adds no row', () => {
  const u = login(L1);
  const ev = demoArrival(L1, u.profile, false)!;
  assert.equal(ev.type, 'payout.paid');
  const r1 = addEvent(EMPTY_INBOX, u.seeds, ev, defaultPrefs(), u.profile);
  assert.equal(r1.added, true);
  assert.equal(unreadCount(inboxEvents(u.seeds, r1.state), r1.state), 4);
  assert.equal(addEvent(r1.state, u.seeds, ev, defaultPrefs(), u.profile).reason, 'duplicate');
  const off = defaultPrefs(); off.types['payout.paid'] = false;
  assert.equal(addEvent(EMPTY_INBOX, u.seeds, ev, off, u.profile).reason, 'typeOff');
  // Night arrival (11:30 PM): a different invoice, its push held until 8:00 AM.
  const night = demoArrival(L1, u.profile, true)!;
  assert.notEqual(night.id, ev.id);
  assert.equal(night.at.getHours(), 23);
});

/* ---------------- Segment gating ---------------- */

test('segment gating: new-TW-only (Hero) gets commission alerts only; 1111 / 2222 / 3333 get both', () => {
  const hero = mockDealerProfile(HERO).profile;
  assert.deepEqual(allowedTypes(hero), ['payout.paid', 'payout.readyToClaim', 'payout.shortPaid']);
  for (const t of ['loan.credited', 'loan.disbursalInitiated', 'loan.blocker', 'loan.overdue'] as const) assert.equal(alertTypeAllowed(t, hero), false);
  for (const m of [L1, L2, L3]) assert.equal(allowedTypes(mockDealerProfile(m).profile).length, 7, m);
  const h = login(HERO);
  assert.ok(h.seeds.length > 0);
  assert.ok(h.seeds.every((e) => e.type.startsWith('payout.')));
  // A loan event never gets into a gated dealer's inbox, even by arrival.
  const loanEv = buildEvent({ type: 'loan.credited', at: MIF_NOW, lan: 'TW-1', customer: 'Asha K', amount: 90000 });
  assert.equal(addEvent(EMPTY_INBOX, h.seeds, loanEv, defaultPrefs(), hero).reason, 'gated');
  // No loan alert for a new two-wheeler file; used TW is in scope.
  assert.equal(fileAlertable({ product: 'twoWheeler', condition: 'new' }), false);
  assert.equal(fileAlertable({ product: 'twoWheeler', condition: 'used' }), true);
  // No session / no profile → no alerts.
  assert.deepEqual(seedAlertsFor('9800000000', null), []);
});

/* ---------------- Mock data agrees with Money in flight and Payouts ---------------- */

test('loan rows match the Money-in-flight files (LAN, first name, amount, credit time)', () => {
  for (const m of [L1, L2, L3]) {
    const u = login(m);
    const files = mifFilesFor(m, u.profile);
    for (const e of u.seeds.filter((x) => x.type.startsWith('loan.'))) {
      const f = files.find((x) => x.lan === e.subject);
      assert.ok(f, `${m} ${e.subject} is a Money-in-flight file`);
      assert.ok(e.title.includes(f!.customer.split(' ')[0]!), e.title);
      assert.ok(!(f!.product === 'twoWheeler' && f!.condition === 'new'));
      if (e.type === 'loan.credited') { assert.equal(e.at.getTime(), f!.credited!.at.getTime()); assert.equal(e.amount, f!.credited!.amount); }
    }
  }
  const neha = login(L1).seeds.find((e) => e.subject === 'CR-20409')!;
  assert.equal(neha.title, '₹6,62,000 credited for Neha');
  assert.equal(neha.push, '₹6,62,000 credited for Neha · CR-20409');
  assert.deepEqual(neha.target, { screen: 'MoneyInFlight', lan: 'CR-20409' });
  const amit = login(L1).seeds.find((e) => e.type === 'loan.overdue' && e.subject === 'CR-20417')!;
  assert.equal(amit.title, "Amit's file overdue, PDD hold");
  assert.deepEqual(amit.target, { screen: 'MoneyInFlight', lan: 'CR-20417', filter: 'overdue' });
});

test('commission rows match the payout statement; short-pay = the statement line (v1.4.8: genuine, >= ₹100)', () => {
  const u = login(L1);
  const invoices = statementInvoicesFor(L1, u.profile);
  const ready = u.seeds.find((e) => e.type === 'payout.readyToClaim')!;
  const inv = invoices.find((i) => i.id === ready.subject)!;
  assert.equal(inv.status, 'Not claimed');
  assert.equal(ready.amount, inv.amount);
  assert.equal(ready.subject, 'INV/26-27/1196');
  assert.equal(ready.amount, 21750);
  const sp = u.seeds.find((e) => e.type === 'payout.shortPaid')!;
  assert.deepEqual(sp.short, { invoice: 'INV/26-27/1176', lan: 'CR-20320', customer: 'Arjun Mehta', expected: 5100, paid: 3950, difference: 1150, reason: 'Scheme cap' });
  assert.equal(sp.title, '₹1,150 difference found on commission');
  assert.equal(sp.push, '₹1,150 difference found on INV/26-27/1176 commission');
  assert.deepEqual(sp.target, { screen: 'Payouts', invoice: 'INV/26-27/1176', lan: 'CR-20320' });
  assert.deepEqual(shortPaysFor(L1, u.profile), [sp.short]);
  // Hero has its own (read) ₹600 short-pay on its TW line; 2222 / 3333 have none.
  assert.equal(shortPaysFor(HERO, login(HERO).profile)[0]!.difference, 600);
  assert.deepEqual(shortPaysFor(L2, login(L2).profile), []);
  assert.deepEqual(shortPaysFor(L3, login(L3).profile), []);
});

/* ---------------- Unread counts per login, shared inbox ---------------- */

test('unread counts per login (spec §g): 1111 → 3, 2222 → 1, 3333 → 2, Hero → 1', () => {
  const want: Record<string, number> = { [L1]: 3, [L2]: 1, [L3]: 2, [HERO]: 1 };
  for (const [m, n] of Object.entries(want)) assert.equal(unreadCount(login(m).seeds, EMPTY_INBOX), n, m);
  const u = login(L1);
  assert.deepEqual(unreadByFilter(u.seeds, EMPTY_INBOX), { all: 3, loan: 1, payout: 2 });
  assert.equal(u.seeds.length, 9);
  const groups = groupAlerts(u.seeds);
  assert.deepEqual(groups.map((g) => g.title), ['Today', 'Earlier']);
  assert.equal(groups[0]!.items[0]!.subject, 'TW-184392'); // Rahul 9:43 AM, newest
});

test('mark read / mark all read; one shared inbox per dealer id (every login of that dealer)', () => {
  const u = login(L1);
  const now = new Date(2026, 10, 24, 11, 30);
  let s: InboxState = markRead(EMPTY_INBOX, u.seeds.find((e) => e.subject === 'CR-20409')!.id, now);
  assert.equal(unreadCount(u.seeds, s), 2);
  s = markAllRead(s, u.seeds, now);
  assert.equal(unreadCount(u.seeds, s), 0);
  // Store keyed by dealer id: a second login / device on the same dealer reads the same state.
  const byDealer: Record<string, InboxState> = { [u.dealerId]: s };
  const other = mockDealerProfile('9811111111'); // another staff mobile of the same mock dealer (ends 1111)
  assert.equal(other.dealerId, u.dealerId);
  assert.equal(unreadCount(seedAlertsFor('9811111111', other.profile), byDealer[other.dealerId] ?? EMPTY_INBOX), 0);
  // A different dealer is unaffected.
  const d2 = login(L2);
  assert.equal(unreadCount(d2.seeds, byDealer[d2.dealerId] ?? EMPTY_INBOX), 1);
  // Persisted shape survives a reload.
  const ev = demoArrival(L1, u.profile, true)!;
  const withNew = addEvent(s, u.seeds, ev, defaultPrefs(), u.profile).state;
  const back = reviveInbox(JSON.stringify(withNew));
  assert.equal(back.added[0]!.at.getTime(), ev.at.getTime());
  assert.equal(unreadCount(inboxEvents(u.seeds, back), back), 1);
  assert.deepEqual(reviveInbox('{bad'), { read: {}, added: [] });
});

test('held note on rows whose push fell in quiet hours (6:30 AM overdue → 8:00 AM)', () => {
  const u = login(L1);
  const amit = u.seeds.find((e) => e.type === 'loan.overdue' && e.subject === 'CR-20417')!;
  const prefs = defaultPrefs();
  // Mock times are local wall clock; read them as IST on this check (the phone runs in IST for the demo).
  const asIst = { ...amit, at: istInstant(amit.at.getFullYear(), amit.at.getMonth(), amit.at.getDate(), amit.at.getHours(), amit.at.getMinutes()) };
  assert.equal(heldNote(asIst, prefs), 'Push held until 8:00 AM');
  const neha = u.seeds.find((e) => e.subject === 'CR-20409')!;
  const nehaIst = { ...neha, at: istInstant(2026, 10, 24, 8, 40) };
  assert.equal(heldNote(nehaIst, prefs), undefined);
  assert.equal(heldNote(asIst, { ...prefs, push: false }), undefined);
});

/* ---------------- Promotional consent ---------------- */

test('promo consent: locked until ticked; tick records a timestamp; untick withdraws, locks, turns off', () => {
  let p = defaultPrefs();
  assert.equal(promoLocked(p), true);
  assert.equal(setPromoSwitch(p, 'videos', true).promo.switches.videos, false); // locked: no change
  const t1 = new Date('2026-11-24T06:00:00.000Z');
  p = giveConsent(p, t1);
  assert.equal(p.promo.consentAt, '2026-11-24T06:00:00.000Z');
  assert.equal(promoLocked(p), false);
  assert.deepEqual(Object.values(p.promo.switches), [false, false, false, false]); // still default off
  p = setPromoSwitch(p, 'videos', true);
  assert.equal(p.promo.switches.videos, true);
  assert.equal(canSendPromotional(p), false); // never sent in this version
  const t2 = new Date('2026-11-25T06:00:00.000Z');
  p = withdrawConsent(p, t2);
  assert.equal(p.promo.consentAt, null);
  assert.equal(p.promo.withdrawnAt, '2026-11-25T06:00:00.000Z');
  assert.equal(promoLocked(p), true);
  assert.deepEqual(Object.values(p.promo.switches), [false, false, false, false]);
  // Saved and reloaded.
  const consented = giveConsent(defaultPrefs(), t1);
  assert.equal(revivePrefs(JSON.stringify(consented)).promo.consentAt, t1.toISOString());
  assert.deepEqual(revivePrefs(JSON.stringify({ promo: { consentAt: null, withdrawnAt: null, switches: { videos: true } } })).promo.switches.videos, false);
  assert.deepEqual(revivePrefs('nope'), defaultPrefs());
  // Transactional types default on.
  assert.ok(Object.values(defaultPrefs().types).every(Boolean));
});

/* ---------------- Readout ---------------- */

test('readout: up to three latest unread, Hinglish, no mobile numbers; today when all read', () => {
  const u = login(L1);
  const line = readoutLine(u.seeds, EMPTY_INBOX);
  assert.ok(line.startsWith('Teen naye alerts.'), line);
  assert.ok(line.includes('Neha ka 6.62 lakh credit ho gaya.'), line);
  assert.ok(line.includes('ka difference mila'), line);
  assert.ok(!/\d{10}/.test(line));
  const all = markAllRead(EMPTY_INBOX, u.seeds, MIF_NOW);
  assert.ok(readoutLine(u.seeds, all).startsWith('Koi naya alert nahi. Aaj ke alerts.'));
  assert.equal(readoutLine([], EMPTY_INBOX), 'Koi naya alert nahi hai.');
  assert.ok(readoutLine(login(HERO).seeds, EMPTY_INBOX).startsWith('Ek naya alert.'));
});
