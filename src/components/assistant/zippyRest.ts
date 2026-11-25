/**
 * Floating Zippy's rest-spot picker (v1.3.0). PURE (no React Native) so it is unit-tested in Node.
 * Screens register avoid-rects via <ZippyAvoid> (zippyAvoid.tsx); ZippyBubble measures them and asks
 * pickZippyRest for a spot on the left / right edge that covers none of them (or, failing that, the least).
 */

/** Clearance (dp) kept between Zippy's body and an avoid-rect: the safe gutter around controls. */
export const ZIPPY_AVOID_GAP = 8;

export type AvoidRect = { x: number; y: number; width: number; height: number; weight: number };

export type Box = { left: number; top: number; right: number; bottom: number };
export type RestInput = {
  /** Avoid-rects in the overlay's coordinates. */
  rects: AvoidRect[];
  minX: number; maxX: number; minY: number; maxY: number;
  /** Orb (top-left x, y) → everything Zippy draws (ride overhang, bob, shadow). */
  body: (x: number, y: number) => Box;
  /** Preferred side first. */
  side: 'left' | 'right';
  /** 'default': fresh screen, try the lowest spot on `side`, then upwards, then the other side.
   *  'nudge':   stay put unless the current spot covers something, else move to the nearest clear spot. */
  mode: 'default' | 'nudge';
  from?: { x: number; y: number };
  step?: number;
  gap?: number;
};
export type Rest = { x: number; y: number; side: 'left' | 'right'; score: number };

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Covering only the clearance gutter around a control costs this share of covering the control itself.
 * A spot is still "clear" only when it touches no gutter at all; when nothing is clear (dense screens),
 * Zippy prefers grazing gutters and padding over sitting on a figure, chip or CTA.
 */
export const GUTTER_SHARE = 0.15;

/** Weighted area of avoid-rects (inflated by the gutter) that Zippy's body would cover at (x, y). 0 = clear. */
export function zippyCoverScore(input: Pick<RestInput, 'rects' | 'body' | 'gap'>, x: number, y: number) {
  const g = input.gap ?? ZIPPY_AVOID_GAP;
  const b = input.body(x, y);
  let s = 0;
  for (const r of input.rects) {
    const raw = overlap(b, { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });
    const padded = overlap(b, { left: r.x - g, top: r.y - g, right: r.x + r.width + g, bottom: r.y + r.height + g });
    s += r.weight * (raw + GUTTER_SHARE * (padded - raw));
  }
  return s;
}

/**
 * Pick a resting spot for floating Zippy that covers no avoid-rect. Candidates sit on the two side
 * edges (Zippy always snaps to an edge) every `step` dp between minY and maxY. Returns null when
 * Zippy should stay where it is ('nudge' and the current spot is already clear or nothing is better).
 */
export function pickZippyRest(input: RestInput): Rest | null {
  const { minX, maxX, minY, maxY, side, mode, from } = input;
  const step = input.step ?? 8;
  const ys: number[] = [];
  for (let y = maxY; y > minY; y -= step) ys.push(y);
  ys.push(minY);
  const sides: ('left' | 'right')[] = side === 'right' ? ['right', 'left'] : ['left', 'right'];
  const xOf = (s: 'left' | 'right') => (s === 'right' ? maxX : minX);
  let cands = sides.flatMap((s) => ys.map((y) => ({ x: xOf(s), y, side: s })));
  if (mode === 'nudge') {
    if (!from) return null;
    const cur = zippyCoverScore(input, from.x, from.y);
    if (cur === 0) return null;
    // Nearest first; switching sides costs a little extra so Zippy prefers sliding along its own edge.
    const cost = (c: { x: number; y: number; side: string }) => Math.abs(c.y - from.y) + (c.side === side ? 0 : 120);
    cands = [...cands].sort((a, b) => cost(a) - cost(b));
    let best: Rest | null = null;
    for (const c of cands) {
      const score = zippyCoverScore(input, c.x, c.y);
      if (score === 0) return { ...c, score };
      if (!best || score < best.score) best = { ...c, score };
    }
    return best && best.score < cur ? best : null;
  }
  let best: Rest | null = null;
  for (const c of cands) {
    const score = zippyCoverScore(input, c.x, c.y);
    if (score === 0) return { ...c, score };
    if (!best || score < best.score) best = { ...c, score };
  }
  return best;
}
