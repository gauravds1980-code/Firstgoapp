/**
 * Pure keyboard-avoid maths (no React Native imports, so node tests can run it).
 * Used by useKeyboardLift / useKeyboardReveal in ./keyboard.
 */

export type KeyboardOS = 'ios' | 'android' | 'web' | string;

/**
 * How far a bottom-anchored container must lift so its content clears the keyboard.
 *  - Android: RN reports the IME height minus the navigation bar. The app (and every Modal) is
 *    edge-to-edge, so the window never shrinks; the container's own bottom inset padding covers the
 *    nav-bar strip, so the lift is exactly the reported height.
 *  - iOS: the reported height includes the home-indicator strip that the container already pads for.
 *  - web: the visualViewport-derived height (bottom inset is 0 there).
 */
export function keyboardLift(os: KeyboardOS, height: number, bottomInset: number): number {
  if (!(height > 0)) return 0;
  return Math.round(os === 'android' ? height : Math.max(0, height - bottomInset));
}

/** Web: the on-screen keyboard is the part of the layout viewport the visual viewport no longer shows. */
export function webKeyboardHeight(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const h = innerHeight - vvHeight - vvOffsetTop;
  // Small differences are URL-bar / pinch-zoom jitter, not a keyboard.
  return h > 80 ? Math.round(h) : 0;
}

/**
 * Android safety net for Modals: if no keyboard event reaches JS while a field in a sheet is focused,
 * assume a typical soft keyboard so the field and CTA still sit above it.
 */
export function fallbackKeyboardHeight(windowHeight: number): number {
  return Math.round(Math.min(340, Math.max(260, windowHeight * 0.38)));
}

/**
 * Scroll delta that brings a focused field (window coords) into a scroll viewport (window coords), with
 * `margin` above it and `below` room under it (e.g. for an inline action button when the screen has no
 * sticky footer). Positive = scroll down. Never scrolls the field's own top out of view.
 */
export function revealDelta(field: { y: number; h: number }, view: { y: number; h: number }, margin = 16, below = margin): number {
  const top = field.y - margin;
  const need = field.y + field.h + below - (view.y + view.h);
  if (need > 0) return Math.min(need, top - view.y);
  if (top < view.y) return top - view.y;
  return 0;
}

/** Sheet height cap: 88% of the container, and never above the status bar once the keyboard is up. */
export function sheetMaxHeight(containerHeight: number, lift: number, topInset: number, gap = 12): number {
  return Math.max(160, Math.min(containerHeight * 0.88, containerHeight - lift - topInset - gap));
}
