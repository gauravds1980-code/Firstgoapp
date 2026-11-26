/**
 * Pure colour-contrast helpers (no React Native imports, so node tests can run them).
 * WCAG 2.x relative luminance / contrast ratio.
 */

/** '#RRGGBB' → [r, g, b] in 0..255. */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const INK = '#121212';
export const WHITE = '#FFFFFF';

/**
 * Glyph colour for a coloured icon well: white unless ink reads better. Mustard (#CE993E) gets ink
 * (7.4:1) — white on mustard is only 2.55:1 and fails even the 3:1 UI-graphics bar.
 */
export function wellGlyph(bg: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

/**
 * Disabled CTA: a cool neutral grey fill with a dark-grey label (≥ 4.5:1), so a disabled gold CTA no
 * longer reads as a faded amber / pale-gold pill.
 */
export const DISABLED_CTA = { bg: '#E2E4E8', fg: '#4A4D55', border: '#C9CCD2' } as const;
