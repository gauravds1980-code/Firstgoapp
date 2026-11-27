/** v1.4.2: bottom-right mic placement and the footer-offset rule. Run: npm run test:voice */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboveMic, alignedMicBottom, clearOfCentreDisc, MIC_DISC, MIC_EDGE, MIC_GAP, micDock, micPlacement } from '../micDock';

test('mic: 56 dp disc (≥ 48 dp touch), 16 dp from the right, 16 dp above the safe area by default', () => {
  assert.equal(MIC_DISC, 56);
  assert.ok(MIC_DISC >= 48);
  assert.deepEqual(micPlacement({ route: 'Portfolio', insetBottom: 0, footer: 0 }), { right: MIC_EDGE, bottom: MIC_GAP, size: 56 });
  assert.equal(micPlacement({ route: 'Portfolio', insetBottom: 24, footer: 0 })!.bottom, 24 + 16, 'gesture bar');
  assert.equal(micPlacement({ route: 'Portfolio', insetBottom: 34, footer: 0 })!.bottom, 34 + 16, 'home indicator');
});

test('mic: 16 dp above a sticky footer (TA/INF, Disburse), which already includes its safe-area padding', () => {
  assert.equal(micPlacement({ route: 'TaInf', insetBottom: 24, footer: 104 })!.bottom, 104 + 16);
  assert.equal(micPlacement({ route: 'Disbursal', insetBottom: 34, footer: 20 })!.bottom, 34 + 16, 'a footer shorter than the inset never pulls it down');
  assert.equal(micPlacement({ route: 'TaInf', insetBottom: 24, footer: 104, keyboardLift: 300 })!.bottom, 104 + 16 + 300, 'rides on the keyboard with the footer');
});

test('mic: hidden on Scan QR, the shorts player and while a screen hides it (Face e-KYC camera)', () => {
  assert.equal(micPlacement({ route: 'ScanQr', insetBottom: 0, footer: 120 }), null);
  assert.equal(micPlacement({ route: 'ShortsFeed', insetBottom: 0, footer: 0 }), null);
  assert.equal(micPlacement({ route: undefined, insetBottom: 0, footer: 0 }), null);
  micDock.reset();
  const release = micDock.hide('FaceKyc');
  const release2 = micDock.hide('FaceKyc');
  assert.equal(micPlacement({ route: 'FaceKyc', insetBottom: 0, footer: 0, hidden: micDock.isHidden('FaceKyc') }), null);
  release(); release(); // idempotent
  assert.equal(micDock.isHidden('FaceKyc'), true, 'still hidden by the second owner');
  release2();
  assert.equal(micDock.isHidden('FaceKyc'), false);
  assert.ok(micPlacement({ route: 'FaceKyc', insetBottom: 0, footer: 80, hidden: micDock.isHidden('FaceKyc') }), 'instructions / result step shows it');
});

test('mic: Home lines up with the bottom-centre Scan QR disc and never overlaps it', () => {
  micDock.reset();
  const fabBottom = 24 + 8;
  const bottom = alignedMicBottom(fabBottom, 72);
  assert.equal(bottom, fabBottom + 8, 'same centre line as the 72 dp disc');
  assert.equal(bottom + MIC_DISC / 2, fabBottom + 72 / 2);
  micDock.setAnchor('Home', bottom);
  // The anchor wins over Home's reported "footer" (the FAB zone).
  assert.equal(micPlacement({ route: 'Home', insetBottom: 24, footer: 130, anchorBottom: micDock.anchor('Home') })!.bottom, bottom);
  for (const w of [320, 360, 412]) assert.ok(clearOfCentreDisc(w, 72), `clear gap at ${w} dp`);
  micDock.setAnchor('Home', null);
  assert.equal(micDock.anchor('Home'), null);
});

test('mic: the pill / sheet sit just above the disc', () => {
  const p = micPlacement({ route: 'Payouts', insetBottom: 24, footer: 0 })!;
  const y = aboveMic(p);
  assert.ok(y - (p.bottom + p.size) >= 8 && y - (p.bottom + p.size) <= 12);
});
