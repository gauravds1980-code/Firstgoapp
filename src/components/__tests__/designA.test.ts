import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, DISABLED_CTA, INK, wellGlyph, WHITE } from '../../theme/contrast.js';
import { DOCK_DEFAULT_ROUTES, routeDockDecision, type RouteDockInput } from '../assistant/zippyDockDefault.js';

// Same hex values as tokens.ts (tokens.ts imports react-native, so it cannot load under node).
const MUSTARD = '#CE993E', TEAL = '#155C7C', NAVY = '#1E2F5C', MAROON = '#8D2323', PRIMARY_DARK = '#6E0A0F';
const GOLD = '#EFA834', SURFACE_MUTED = '#F5F1EE';

test('icon wells: ink on mustard, white on teal / navy / maroon / primaryDark, all ≥ 4.5:1', () => {
  assert.ok(contrastRatio(WHITE, MUSTARD) < 3, 'white on mustard fails even the 3:1 UI-graphics bar');
  assert.equal(wellGlyph(MUSTARD), INK);
  assert.ok(contrastRatio(INK, MUSTARD) >= 7);
  for (const bg of [TEAL, NAVY, MAROON, PRIMARY_DARK]) {
    assert.equal(wellGlyph(bg), WHITE, bg);
    assert.ok(contrastRatio(WHITE, bg) >= 7, `${bg} ${contrastRatio(WHITE, bg).toFixed(2)}`);
  }
});

test('disabled CTA: dark label on a cool neutral grey, ≥ 4.5:1, not the warm surfaceMuted', () => {
  assert.ok(contrastRatio(DISABLED_CTA.fg, DISABLED_CTA.bg) >= 4.5, contrastRatio(DISABLED_CTA.fg, DISABLED_CTA.bg).toFixed(2));
  assert.notEqual(DISABLED_CTA.bg.toUpperCase(), SURFACE_MUTED);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(DISABLED_CTA.bg.slice(i, i + 2), 16)) as [number, number, number];
  assert.ok(b >= r && b >= g, 'cool grey: blue channel is the highest (no warm / amber cast)');
  assert.ok(contrastRatio(INK, GOLD) >= 4.5, 'enabled gold CTA keeps its ink label');
});

const base: RouteDockInput = { route: 'Home', phase: 'floating', globalPref: 'floating', routeDocked: false, undockedVisit: null, forced: false };

test('dock default: data screens dock, Home and journeys stay floating', () => {
  for (const r of ['Portfolio', 'Cases', 'Payouts', 'TaInf']) {
    assert.ok(DOCK_DEFAULT_ROUTES.has(r));
    assert.equal(routeDockDecision({ ...base, route: r }), 'dock', r);
  }
  for (const r of ['Home', 'Offer', 'Disbursal', 'Help', 'DealerLogin', 'DealerOtp']) assert.equal(routeDockDecision({ ...base, route: r }), null, r);
});

test('dock default: leaving a data screen floats again only if the route default docked it', () => {
  assert.equal(routeDockDecision({ ...base, route: 'Home', phase: 'docked', routeDocked: true }), 'float');
  assert.equal(routeDockDecision({ ...base, route: 'Home', phase: 'docked', routeDocked: false }), null);
});

test('dock default: global docked pref, ?zippy= override, in-flight phases and a visit undock are respected', () => {
  assert.equal(routeDockDecision({ ...base, route: 'Home', phase: 'docked', globalPref: 'docked' }), null);
  assert.equal(routeDockDecision({ ...base, route: 'Portfolio', forced: true }), null);
  assert.equal(routeDockDecision({ ...base, route: 'Portfolio', phase: 'hydrating' }), null);
  assert.equal(routeDockDecision({ ...base, route: 'Portfolio', phase: 'returning' }), null);
  assert.equal(routeDockDecision({ ...base, route: 'Portfolio', undockedVisit: 'Portfolio' }), null);
  assert.equal(routeDockDecision({ ...base, route: 'Cases', undockedVisit: 'Portfolio' }), 'dock');
});
