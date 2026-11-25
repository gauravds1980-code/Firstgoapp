/**
 * Zippy "drop a short" trigger rules (v1.3.0). Pure Node tests. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COOLDOWN_MS, FIRST_VISIT_DELAY_MS, IDLE_MS, NEVER_NUDGE_SCREENS, SESSION_CAP, StuckDetector, WINDOW_MS,
  formatClock, formatShortLength, nudgeHeadline,
} from '../stuckDetector';
import { SCREEN_SHORT, SHORT_IDS, SHORT_INFO, screenToShort } from '../shortMap';

/** A detector that has already introduced every screen (no first-visit offers) unless told otherwise. */
function make(opts: { introduced?: string[] | 'all' } = {}) {
  const introducedLog: string[] = [];
  const d = new StuckDetector({ shortFor: screenToShort, onIntroduced: (s) => introducedLog.push(s) });
  d.setIntroduced(opts.introduced === 'all' || opts.introduced === undefined ? Object.keys(SCREEN_SHORT) : opts.introduced);
  return { d, introducedLog };
}

/** Run tick() every second from `from` to `to` (inclusive); return the triggers. */
function tickRange(d: StuckDetector, from: number, to: number) {
  const out = [];
  for (let t = from; t <= to; t += 1000) { const r = d.tick(t); if (r) out.push(r); }
  return out;
}

// ---- screen → short map ----

test('every screen maps to the requested short', () => {
  const expect: Record<string, string | null> = {
    DealerLogin: 'login', DealerOtp: 'login', ScanQr: 'scan-offer', SearchMobile: 'scan-offer', Offer: 'scan-offer', OfferReveal: 'scan-offer',
    Asset: 'vehicle-emi', FaceKyc: 'ekyc', Mandate: 'mandate', Esign: 'esign', Docs: 'docs-disbursal', Disbursal: 'docs-disbursal',
    Payouts: 'payouts-utr', Portfolio: 'portfolio-cases-rc', Cases: 'portfolio-cases-rc', RcPendency: 'portfolio-cases-rc', QuickList: 'portfolio-cases-rc',
    TaInf: 'tainf', Home: 'zippy-voice', Profile: 'zippy-voice', Help: null, ShortsFeed: null,
  };
  for (const [screen, id] of Object.entries(expect)) assert.equal(screenToShort(screen), id, screen);
  assert.equal(screenToShort('Nope'), null);
  assert.equal(screenToShort(undefined), null);
  // Every short except the full tutorial is offered on at least one screen; every id has copy.
  for (const id of SHORT_IDS) {
    assert.ok(SHORT_INFO[id].title && SHORT_INFO[id].durationSec > 0, id);
    if (id !== 'full') assert.ok(Object.values(SCREEN_SHORT).includes(id as never), id);
  }
});

test('copy uses the short duration', () => {
  assert.equal(nudgeHeadline('idle', 15), 'Need a hand? Watch a 15s how-to');
  assert.equal(nudgeHeadline('validation', 18), 'Need a hand? Watch an 18s how-to');
  assert.equal(nudgeHeadline('back-nav', 8), 'Need a hand? Watch an 8s how-to');
  assert.equal(nudgeHeadline('idle', 11), 'Need a hand? Watch an 11s how-to');
  assert.equal(nudgeHeadline('first-visit', 16), 'New here? Watch a 16s how-to');
  assert.equal(formatShortLength(90), '1.5 min');
  assert.equal(formatClock(18), '0:18');
  assert.equal(formatClock(95), '1:35');
});

// ---- first visit ----

test('first visit: offers the short ~1.5 s after the screen settles, once', () => {
  const { d, introducedLog } = make({ introduced: [] });
  d.setEnabled(true);
  assert.equal(d.navigate('Asset', 0), null);
  assert.equal(d.tick(FIRST_VISIT_DELAY_MS - 1), null);
  const t = d.tick(FIRST_VISIT_DELAY_MS);
  assert.deepEqual(t && { screen: t.screen, shortId: t.shortId, reason: t.reason }, { screen: 'Asset', shortId: 'vehicle-emi', reason: 'first-visit' });
  assert.deepEqual(introducedLog, ['Asset']);
  // Same screen again later: already introduced and already shown this session.
  d.navigate('Home', 10 * 60_000);
  d.navigate('Asset', 20 * 60_000);
  assert.deepEqual(tickRange(d, 20 * 60_000, 20 * 60_000 + 5_000), []);
});

test('first visit: leaving before it settles cancels it, and the screen stays un-introduced', () => {
  const { d, introducedLog } = make({ introduced: [] });
  d.setEnabled(true);
  d.navigate('Mandate', 0);
  d.navigate('Esign', 1_000);
  const t = d.tick(2_600);
  assert.equal(t?.screen, 'Esign');
  assert.deepEqual(introducedLog, ['Esign']);
  // Mandate was never offered, so a later visit still gets its intro offer (after the cooldown).
  d.navigate('Mandate', COOLDOWN_MS + 3_000);
  assert.equal(d.tick(COOLDOWN_MS + 3_000 + FIRST_VISIT_DELAY_MS)?.reason, 'first-visit');
});

test('first visit: blocked by the cooldown is retried on the next visit, not lost', () => {
  const { d } = make({ introduced: [] });
  d.setEnabled(true);
  d.navigate('Asset', 0);
  assert.equal(d.tick(1_500)?.screen, 'Asset');
  d.navigate('FaceKyc', 10_000);
  assert.equal(d.tick(11_500), null); // cooldown
  d.navigate('Mandate', COOLDOWN_MS + 20_000);
  d.navigate('FaceKyc', COOLDOWN_MS + 21_000, true);
  assert.equal(d.tick(COOLDOWN_MS + 22_500)?.screen, 'FaceKyc');
});

test('first visit: not on celebration / success screens, screens without a short, or watched shorts', () => {
  const { d } = make({ introduced: [] });
  d.setEnabled(true);
  for (const s of NEVER_NUDGE_SCREENS) { d.navigate(s, 0); assert.deepEqual(tickRange(d, 0, 25_000), [], s); }
  d.navigate('Help', 0);
  assert.deepEqual(tickRange(d, 0, 25_000), []);
  d.setWatched(['mandate']);
  d.navigate('Mandate', 30_000);
  assert.equal(d.tick(31_500), null); // no intro for an already watched short
});

test('first visit waits for a sheet / player to close on the same visit', () => {
  const { d } = make({ introduced: [] });
  d.setEnabled(true);
  d.navigate('Docs', 0);
  d.suppress('sheet', true, 500);
  assert.deepEqual(tickRange(d, 1_000, 6_000), []);
  d.suppress('sheet', false, 6_500);
  assert.equal(d.tick(7_000)?.reason, 'first-visit');
});

// ---- idle ----

test('idle: triggers at 20 s without activity, not before', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Asset', 0);
  assert.deepEqual(tickRange(d, 1_000, IDLE_MS - 1_000), []);
  const t = d.tick(IDLE_MS);
  assert.equal(t?.reason, 'idle');
  assert.equal(t?.shortId, 'vehicle-emi');
});

test('idle: activity and route changes restart the clock', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Asset', 0);
  d.activity(15_000);
  assert.equal(d.tick(IDLE_MS), null);
  assert.equal(d.tick(15_000 + IDLE_MS - 1), null);
  d.navigate('FaceKyc', 30_000);
  assert.equal(d.tick(30_000 + IDLE_MS - 1_000), null);
  assert.equal(d.tick(30_000 + IDLE_MS)?.screen, 'FaceKyc');
});

// ---- back navigation ----

test('back-nav: A->B->A->B->A (two backs out of B within 60 s) offers B', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Home', 0);
  d.navigate('Asset', 5_000);
  assert.equal(d.navigate('Home', 10_000, true), null);
  d.navigate('Asset', 15_000);
  const t = d.navigate('Home', 20_000, true);
  assert.equal(t?.reason, 'back-nav');
  assert.equal(t?.screen, 'Asset');
});

test('back-nav: backs spread over more than 60 s do not count, forward navigations never do', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Home', 0);
  d.navigate('Mandate', 1_000);
  d.navigate('Home', 2_000, true);
  d.navigate('Mandate', WINDOW_MS + 10_000);
  assert.equal(d.navigate('Home', WINDOW_MS + 12_000, true), null);
  const f = make().d; f.setEnabled(true);
  for (let i = 0; i < 6; i++) assert.equal(f.navigate(i % 2 ? 'Asset' : 'Home', i * 1_000), null);
});

test('back-nav: going back from the same screen twice (to different screens) triggers', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Docs', 0);
  d.navigate('Esign', 1_000, true);
  d.navigate('Docs', 2_000);
  const t = d.navigate('Home', 3_000, true);
  assert.equal(t?.screen, 'Docs');
});

// ---- validation errors ----

test('validation: two errors on the same screen within 60 s trigger', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('DealerLogin', 0);
  assert.equal(d.validationError(1_000), null);
  const t = d.validationError(5_000);
  assert.equal(t?.reason, 'validation');
  assert.equal(t?.shortId, 'login');
});

test('validation: errors on different screens or > 60 s apart do not trigger', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Esign', 0);
  assert.equal(d.validationError(1_000, 'Esign'), null);
  assert.equal(d.validationError(2_000, 'Docs'), null);
  assert.equal(d.validationError(1_000 + WINDOW_MS + 1, 'Esign'), null);
});

// ---- cooldown, caps, suppression, don't show again ----

test('cooldown: nothing else for 3 minutes after a bubble', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Asset', 0);
  assert.ok(d.tick(IDLE_MS));
  d.navigate('FaceKyc', 25_000);
  assert.equal(d.tick(25_000 + IDLE_MS), null);
  assert.equal(d.blockReason('FaceKyc', 25_000 + IDLE_MS), 'cooldown');
  d.activity(IDLE_MS + COOLDOWN_MS - IDLE_MS);
  assert.ok(d.tick(IDLE_MS + COOLDOWN_MS));
});

test('per session: each screen at most once, at most 3 bubbles', () => {
  const { d } = make();
  d.setEnabled(true);
  let now = 0;
  const shown: string[] = [];
  for (const s of ['Asset', 'Asset', 'FaceKyc', 'Mandate', 'Esign', 'Docs']) {
    d.navigate(s, now);
    const t = d.tick(now + IDLE_MS);
    if (t) shown.push(t.screen);
    now += COOLDOWN_MS + IDLE_MS + 1_000;
  }
  assert.deepEqual(shown, ['Asset', 'FaceKyc', 'Mandate']);
  assert.equal(shown.length, SESSION_CAP);
  assert.equal(d.blockReason('Docs', now), 'session-cap');
});

test('suppression: sheet, player, voice or undo toast blocks every signal', () => {
  for (const key of ['sheet', 'player', 'voice', 'undo', 'bubble']) {
    const { d } = make();
    d.setEnabled(true);
    d.navigate('Asset', 0);
    d.suppress(key, true, 0);
    assert.deepEqual(tickRange(d, 0, 40_000), [], key);
    d.validationError(41_000); assert.equal(d.validationError(42_000), null, key);
    d.suppress(key, false, 50_000);
    assert.equal(d.tick(50_000 + IDLE_MS - 1_000), null, `${key}: idle restarts when it closes`);
    assert.equal(d.tick(50_000 + IDLE_MS)?.reason, 'idle', key);
  }
});

test('never on the offer celebration or disbursal success, even for back-nav subjects', () => {
  const { d } = make();
  d.setEnabled(true);
  d.navigate('Disbursal', 0);
  assert.deepEqual(tickRange(d, 0, 30_000), []);
  d.validationError(31_000); assert.equal(d.validationError(32_000), null);
  d.navigate('OfferReveal', 40_000);
  assert.deepEqual(tickRange(d, 40_000, 70_000), []);
});

test("don't show again: persists per screen and blocks every reason there", () => {
  const { d } = make({ introduced: [] });
  d.setEnabled(true);
  d.setDontShow(['Mandate']);
  d.navigate('Mandate', 0);
  assert.deepEqual(tickRange(d, 0, 30_000), []);
  d.validationError(31_000); assert.equal(d.validationError(32_000), null);
  d.addDontShow('Asset');
  d.navigate('Asset', 40_000);
  assert.deepEqual(tickRange(d, 40_000, 70_000), []);
  // Other screens are unaffected.
  d.navigate('Esign', 80_000);
  assert.equal(d.tick(81_500)?.screen, 'Esign');
});

test('global toggle off: nothing triggers', () => {
  const { d } = make({ introduced: [] });
  d.setEnabled(false);
  d.navigate('Asset', 0);
  assert.deepEqual(tickRange(d, 0, 30_000), []);
  d.validationError(31_000); assert.equal(d.validationError(32_000), null);
  assert.equal(d.blockReason('Asset', 40_000), 'disabled');
});

test('force (web ?nudge=1) ignores the rules but needs a short', () => {
  const { d } = make();
  d.setEnabled(false);
  d.navigate('Mandate', 0);
  assert.equal(d.force(1)?.shortId, 'mandate');
  d.navigate('Help', 2);
  assert.equal(d.force(3), null);
});
