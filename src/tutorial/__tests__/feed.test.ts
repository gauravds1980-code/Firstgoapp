/**
 * Reels-style shorts feed helpers: ordering, "Try it now" targets, player window, hint. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CTA_ROUTE, ctaRouteFor, feedOrder, inJourney, playerWindow, progressOf, shouldShowSwipeHint, startIndexFor, ttffLine } from '../feed';
import { SHORT_IDS } from '../shortMap';

test('feed order: journey order, extras, sign-in late, full tutorial last', () => {
  const order = feedOrder([...SHORT_IDS, 'rc-upload']);
  assert.deepEqual(order, [
    'scan-offer', 'vehicle-emi', 'ekyc', 'mandate', 'esign', 'docs-disbursal', 'payouts-utr', 'portfolio-cases-rc', 'tainf', 'zippy-voice',
    'rc-upload', 'login', 'full',
  ]);
  assert.equal(feedOrder([...SHORT_IDS], { signedIn: false })[0], 'login');
  assert.equal(feedOrder([...SHORT_IDS]).at(-1), 'full');
  assert.equal(new Set(order).size, order.length);
});

test('start index: the requested short, else the first', () => {
  const order = feedOrder([...SHORT_IDS]);
  assert.equal(startIndexFor(order, 'mandate'), 3);
  assert.equal(startIndexFor(order, 'full'), order.length - 1);
  assert.equal(startIndexFor(order, 'nope'), 0);
  assert.equal(startIndexFor(order, undefined), 0);
});

test('Try it now: every short maps; journey screens fall back to Scan QR without a case', () => {
  for (const id of SHORT_IDS) assert.ok(id in CTA_ROUTE, id);
  const out = { signedIn: true, inJourney: false };
  const mid = { signedIn: true, inJourney: true };
  assert.equal(ctaRouteFor('login', out), null);
  assert.equal(ctaRouteFor('scan-offer', out), 'ScanQr');
  assert.equal(ctaRouteFor('full', out), 'ScanQr');
  for (const [id, route] of [['vehicle-emi', 'Asset'], ['ekyc', 'FaceKyc'], ['mandate', 'Mandate'], ['esign', 'Esign'], ['docs-disbursal', 'Docs']] as const) {
    assert.equal(ctaRouteFor(id, out), 'ScanQr', `${id} without a case`);
    assert.equal(ctaRouteFor(id, mid), route, `${id} in a case`);
  }
  assert.equal(ctaRouteFor('payouts-utr', out), 'Payouts');
  assert.equal(ctaRouteFor('portfolio-cases-rc', out), 'Portfolio');
  assert.equal(ctaRouteFor('zippy-voice', out), 'Home');
  assert.equal(ctaRouteFor('tainf', out), 'TaInf');
  assert.equal(ctaRouteFor('tainf', { ...out, hasTaInf: false }), null);
  assert.equal(ctaRouteFor('mandate', { signedIn: false, inJourney: true }), null);
  assert.equal(ctaRouteFor('unknown-extra', out), null);
  assert.equal(inJourney(['Home', 'Asset', 'FaceKyc', 'ShortsFeed']), true);
  assert.equal(inJourney(['Home', 'Help', 'ShortsFeed']), false);
});

test('player window: active + 2 ahead, max 3, skips coming soon, clamps at the end', () => {
  assert.deepEqual(playerWindow(0, 12), [0, 1, 2]);
  assert.deepEqual(playerWindow(5, 12), [5, 6, 7]);
  assert.deepEqual(playerWindow(11, 12), [11]);
  assert.deepEqual(playerWindow(10, 12), [10, 11]);
  assert.deepEqual(playerWindow(0, 12, 2, (i) => i === 1), [0, 2]);
  assert.deepEqual(playerWindow(0, 12, 1), [0, 1]);
  assert.ok(playerWindow(3, 100).length <= 3);
});

test('swipe hint: first open only (if there is a next page), or forced', () => {
  assert.equal(shouldShowSwipeHint({ seenBefore: false, forced: false, count: 12, startIndex: 0 }), true);
  assert.equal(shouldShowSwipeHint({ seenBefore: true, forced: false, count: 12, startIndex: 0 }), false);
  assert.equal(shouldShowSwipeHint({ seenBefore: false, forced: false, count: 12, startIndex: 11 }), false);
  assert.equal(shouldShowSwipeHint({ seenBefore: true, forced: true, count: 12, startIndex: 11 }), true);
});

test('progress and TTFF line', () => {
  assert.equal(progressOf(5, 20), 0.25);
  assert.equal(progressOf(5, 0), 0);
  assert.equal(progressOf(NaN, 10), 0);
  assert.equal(progressOf(30, 20), 1);
  assert.equal(ttffLine('scan-offer', 'hls', 812.4), '[tutorial] ttff scan-offer hls 812 ms');
});
