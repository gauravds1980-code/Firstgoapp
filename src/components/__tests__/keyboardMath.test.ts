import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackKeyboardHeight, keyboardLift, revealDelta, sheetMaxHeight, webKeyboardHeight } from '../keyboardMath.js';

test('keyboardLift: android uses the reported height, iOS drops the home-indicator strip', () => {
  assert.equal(keyboardLift('android', 280, 24), 280);
  assert.equal(keyboardLift('ios', 336, 34), 302);
  assert.equal(keyboardLift('ios', 20, 34), 0);
  assert.equal(keyboardLift('web', 280, 0), 280);
  assert.equal(keyboardLift('android', 0, 24), 0);
  assert.equal(keyboardLift('android', Number.NaN, 24), 0);
});

test('webKeyboardHeight ignores URL-bar jitter', () => {
  assert.equal(webKeyboardHeight(780, 500, 0), 280);
  assert.equal(webKeyboardHeight(780, 740, 0), 0);
  assert.equal(webKeyboardHeight(780, 480, 20), 280);
});

test('fallbackKeyboardHeight is a sane soft-keyboard size', () => {
  assert.equal(fallbackKeyboardHeight(780), 296);
  assert.equal(fallbackKeyboardHeight(500), 260);
  assert.equal(fallbackKeyboardHeight(1200), 340);
});

test('revealDelta scrolls just enough to show the field', () => {
  const view = { y: 100, h: 300 };
  assert.equal(revealDelta({ y: 150, h: 60 }, view), 0);
  assert.equal(revealDelta({ y: 380, h: 60 }, view), 56); // bottom 440+16 vs 400
  assert.equal(revealDelta({ y: 90, h: 60 }, view), -26);
  assert.equal(revealDelta({ y: 500, h: 400 }, view), 384); // taller than view: align top
  assert.equal(revealDelta({ y: 394, h: 56 }, { y: 64, h: 428 }, 16, 140), 98); // room for an inline CTA
  assert.equal(revealDelta({ y: 120, h: 56 }, { y: 100, h: 200 }, 16, 140), 4); // never pushes the field's top out
});

test('sheetMaxHeight stays below the status bar with the keyboard up', () => {
  assert.equal(sheetMaxHeight(780, 0, 24), 780 * 0.88);
  assert.equal(sheetMaxHeight(780, 296, 24), 448);
  assert.equal(sheetMaxHeight(400, 300, 24), 160);
});
