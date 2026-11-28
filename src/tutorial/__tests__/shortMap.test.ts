/**
 * v1.3.0 tutorial catalogue tidy: real durations from the server manifest, the E-sign title, every
 * navigator route mapped (incl. HelpSupport / PrivacyTerms / ComingSoon), no scan-offer alias. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RootStackParamList } from '../../navigation/types';
import { ASSET_ALIAS, assetIdFor } from '../catalog';
import { SCREEN_SHORT, SHORT_IDS, SHORT_INFO, screenToShort } from '../shortMap';
import { formatClock } from '../stuckDetector';

test('durations match the rendered videos (manifest.json)', () => {
  const want: Record<string, number> = {
    full: 148.77, login: 20, 'scan-offer': 20, 'vehicle-emi': 20, ekyc: 19, mandate: 19, esign: 19,
    'docs-disbursal': 19, 'payouts-utr': 18, 'portfolio-cases-rc': 20, tainf: 15, 'zippy-voice': 20,
  };
  assert.deepEqual(Object.keys(want).sort(), [...SHORT_IDS].sort());
  for (const id of SHORT_IDS) assert.equal(SHORT_INFO[id].durationSec, want[id], id);
  assert.equal(formatClock(SHORT_INFO.full.durationSec), '2:29');
});

test('esign is titled "E-sign" (no KFS consent)', () => {
  assert.equal(SHORT_INFO.esign.title, 'E-sign');
  for (const id of SHORT_IDS) assert.ok(!/KFS consent/i.test(SHORT_INFO[id].title), id);
});

// Compile-time exhaustive: adding a route to RootStackParamList without listing it here fails tsc.
const ROUTES: Record<keyof RootStackParamList, true> = {
  DealerLogin: true, DealerOtp: true, Home: true, Profile: true, HelpSupport: true, PrivacyTerms: true, ComingSoon: true,
  QuickList: true, ScanQr: true, SearchMobile: true, Offer: true, OfferReveal: true, Asset: true, FaceKyc: true, Mandate: true,
  Esign: true, Docs: true, Disbursal: true, Payouts: true, Portfolio: true, Cases: true, RcPendency: true, TaInf: true,
  Help: true, ShortsFeed: true, MoneyInFlight: true, Alerts: true, AlertSettings: true,
};

test('SCREEN_SHORT lists every route, including the logo-fix ones', () => {
  assert.deepEqual(Object.keys(SCREEN_SHORT).sort(), Object.keys(ROUTES).sort());
  for (const r of ['HelpSupport', 'PrivacyTerms', 'ComingSoon', 'Help', 'ShortsFeed']) assert.equal(screenToShort(r), null, r);
  assert.equal(screenToShort('TaInf'), 'tainf');
  assert.equal(screenToShort('Esign'), 'esign');
});

test('scan-offer streams its own file (no sample-scan-qr alias)', () => {
  assert.equal(ASSET_ALIAS['scan-offer'], undefined);
  assert.notEqual(assetIdFor('scan-offer'), 'sample-scan-qr');
  assert.equal(assetIdFor('scan-offer'), 'scan-offer');
});
