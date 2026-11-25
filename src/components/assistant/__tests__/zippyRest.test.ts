/**
 * v1.3.0 floating Zippy rest-spot picker: clear spots first; when none is clear, graze gutters and
 * soft copy rather than sit on a hard control. Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type AvoidRect, pickZippyRest, zippyCoverScore, ZIPPY_AVOID_GAP } from '../zippyRest';

// A 60×60 orb with no overhang, on a 360dp-wide screen: left edge x = 10, right edge x = 290.
const body = (x: number, y: number) => ({ left: x, top: y, right: x + 60, bottom: y + 60 });
const base = { minX: 10, maxX: 290, minY: 100, maxY: 600, body, side: 'right' as const, mode: 'default' as const, step: 4 };
const hard = (x: number, y: number, width: number, height: number): AvoidRect => ({ x, y, width, height, weight: 10 });
const soft = (x: number, y: number, width: number, height: number): AvoidRect => ({ ...hard(x, y, width, height), weight: 1 });

test('fresh screen with nothing registered: lowest spot on the preferred side', () => {
  assert.deepEqual(pickZippyRest({ ...base, rects: [] }), { x: 290, y: 600, side: 'right', score: 0 });
});

test('a chip row at the bottom-right pushes Zippy up to a clear spot', () => {
  const r = pickZippyRest({ ...base, rects: [hard(20, 560, 320, 48)] })!;
  assert.equal(r.score, 0);
  assert.ok(r.y + 60 + ZIPPY_AVOID_GAP <= 560, 'body plus gutter stays above the chips');
});

test('nothing clear: prefers soft copy over a hard figure', () => {
  // Full-width bands with no gaps: hard rows except one soft caption row.
  const rects = [hard(20, 90, 320, 300), soft(20, 390, 320, 80), hard(20, 470, 320, 300)];
  const r = pickZippyRest({ ...base, rects })!;
  assert.ok(r.score > 0);
  assert.ok(r.y >= 390 - ZIPPY_AVOID_GAP && r.y + 60 <= 470 + ZIPPY_AVOID_GAP, `rests on the soft row (y=${r.y})`);
});

test('grazing a gutter costs less than covering the control itself', () => {
  const rects = [hard(20, 200, 320, 40)];
  const grazing = zippyCoverScore({ rects, body }, 290, 200 - 60 - 4); // 4dp into the 8dp gutter above
  const covering = zippyCoverScore({ rects, body }, 290, 200 - 60 + 4); // 4dp into the control
  assert.ok(grazing > 0, 'still not "clear"');
  assert.ok(grazing < covering);
});

test('nudge: stays put when the current spot is clear', () => {
  assert.equal(pickZippyRest({ ...base, mode: 'nudge', from: { x: 290, y: 300 }, rects: [hard(20, 560, 320, 48)] }), null);
});
