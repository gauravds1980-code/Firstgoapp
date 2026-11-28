/**
 * Design tokens — single source of truth for colour, type, spacing, radius,
 * elevation and touch-target sizes.
 *
 * BRAND STATUS: mapped from /workspace/boom-brand/tokens.json + playstore-theme.md
 * (23 Nov 2026). Spacing/touch sizes are deliberately MORE generous than the bank app.
 */
import { Platform } from 'react-native';
import { DISABLED_CTA } from './contrast';

export const brandSource = 'boom-brand/tokens.json' as 'placeholder' | 'boom-brand/tokens.json';

/**
 * Raw palette — mapped from /workspace/boom-brand/tokens.json (website, idfcfirst.bank.in)
 * and /workspace/boom-brand/playstore-theme.md (IDFC FIRST mobile app, com.idfcfirstbank.optimus).
 * Never use these directly in components — use `colors`.
 */
const palette = {
  maroon: '#9D1D27', // primary brand (logo SVG, .btn-red)
  maroonPressed: '#8A1922',
  maroonDark: '#6E0A0F', // gradients / dark text
  maroonDeep: '#67090E', // app icon burgundy
  maroonTint: '#F9E8E9',
  maroonWash: '#FCF1F1',
  gold: '#EFA834', // app primary CTA circles
  goldPressed: '#DE9622',
  goldDark: '#A26B00', // secondary gold (text/glyph on gold)
  goldTint: '#FDF0D9',
  yellow: '#FFCB05', // accent
  canvas: '#FDF4EF', // warm off-white app canvas
  canvasAlt: '#F8EEE8',
  ink: '#121212',
  ink2: '#222222',
  muted: '#54565B', // 7.4:1 on white
  muted2: '#6B6C76', // 5.3:1 on white
  border: '#E9E9E9',
  borderStrong: '#CFCFD4',
  white: '#FFFFFF',
  success: '#00A07A',
  successDark: '#2B8767',
  successTint: '#E3F5EF',
  warningText: '#8A5A00',
  warningTint: '#FFF4DB',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  // v1.4.6 design library: the info-pill pair that lived as raw hex in ui.tsx, folded into the palette (no new colour).
  infoTint: '#E7F3F8',
  infoText: '#1A5E86',
  tileMustard: '#CE993E',
  tileTeal: '#155C7C',
  tileNavy: '#1E2F5C',
  tileMaroon: '#8D2323',
  aiUser: '#434377', // FIRST.AI user bubble
  aiThread: '#F1EFFA', // FIRST.AI assistant bubble
};

export const colors = {
  primary: palette.maroon,
  primaryPressed: palette.maroonPressed,
  primaryDark: palette.maroonDark,
  primaryDeep: palette.maroonDeep,
  primarySoft: palette.maroonTint,
  primaryTint: palette.maroonWash,
  onPrimary: palette.white,

  cta: palette.gold, // main action buttons
  ctaPressed: palette.goldPressed,
  onCta: palette.ink, // ink on gold = 9.6:1 (white on gold would fail AA)
  ctaDark: palette.goldDark,
  ctaTint: palette.goldTint,
  accent: palette.yellow,

  bg: palette.canvas,
  bgAlt: palette.canvasAlt,
  surface: palette.white,
  surfaceMuted: '#F5F1EE',
  /** Disabled CTA: cool neutral grey + dark-grey label (≥ 4.5:1). Not surfaceMuted, which reads as pale gold. */
  disabledBg: DISABLED_CTA.bg,
  onDisabled: DISABLED_CTA.fg,
  disabledBorder: DISABLED_CTA.border,
  border: palette.border,
  borderStrong: palette.borderStrong,

  text: palette.ink,
  textStrong: palette.ink2,
  textSecondary: palette.muted,
  textMuted: palette.muted2,
  textInverse: palette.white,

  success: palette.successDark,
  successBright: palette.success,
  successSoft: palette.successTint,
  warning: palette.warningText,
  warningSoft: palette.warningTint,
  danger: palette.danger,
  dangerSoft: palette.dangerTint,
  info: palette.infoText,
  infoSoft: palette.infoTint,

  tileMustard: palette.tileMustard,
  tileTeal: palette.tileTeal,
  tileNavy: palette.tileNavy,
  tileMaroon: palette.tileMaroon,

  statBlue: '#EAF2F6',
  statMint: palette.successTint,
  statPeach: palette.goldTint,
  statRose: palette.maroonWash,

  aiUser: palette.aiUser,
  aiThread: palette.aiThread,

  scrim: 'rgba(18,18,18,0.5)',
  skeleton: '#EFE6E0',
};

export const space = {
  xxs: 4, // half-step, for icon/label gaps only
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 48,
} as const;

/** Radii from brand: 8 / 12 / 16 / 24, pill buttons. */
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target (Material 48dp / Apple 44pt — we use 48). */
export const touch = { min: 48, cta: 56, fab: 56, tabBar: 72, heroCta: 72 } as const;

/**
 * v1.3.0: every header action (Zippy dock slot, mic, bell, avatar, Home) is the same 40dp circle in a
 * 44pt box, so the wordmark keeps its room at 360dp. `hitSlop` tops the touch area up to touch.min.
 */
export const headerBtn = { box: 44, disc: 40, hitSlop: 2 } as const;

/** Screen gutters (16–24). */
export const gutter = { screen: 20, card: 16 } as const;

/** Inter (brand font on idfcfirst.bank.in), bundled via @expo-google-fonts/inter. */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
};

/** Type scale (1.2 ratio-ish, rounded to 4pt line heights). */
/** Type scale (Inter). fontFamily carries the weight so it renders correctly on Android. */
export const type = {
  display: { fontSize: 32, lineHeight: 40, fontFamily: fontFamily.extrabold },
  h1: { fontSize: 24, lineHeight: 32, fontFamily: fontFamily.bold },
  h2: { fontSize: 20, lineHeight: 28, fontFamily: fontFamily.bold },
  h3: { fontSize: 17, lineHeight: 24, fontFamily: fontFamily.semibold },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.regular },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.semibold },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.semibold },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.regular },
  overline: { fontSize: 11, lineHeight: 16, fontFamily: fontFamily.bold, letterSpacing: 1.2 },
};

/**
 * Android-only text metrics fix. Inter ships tall ascender/descender metrics, and Android's default
 * `includeFontPadding: true` adds that as extra top/bottom padding on top of `lineHeight` — glyphs then
 * sit high or low inside fixed-height pills, buttons, OTP boxes and inputs. iOS / web ignore these props.
 */
export const textFix = Platform.select({
  android: { includeFontPadding: false, textAlignVertical: 'center' as const },
  default: {},
});

/** Caps on OS font scaling for dense, height-bound controls (CTAs, pills, badges, OTP digits). */
export const fontScaleCap = { control: 1.2, compact: 1.3 } as const;

/** Brand soft shadow: 0 4px 8px rgba(37,36,59,0.1). */
export const elevation = {
  card: Platform.select({
    web: { boxShadow: '0 4px 8px rgba(37,36,59,0.1)' } as object,
    default: { shadowColor: '#25243B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  }),
  raised: Platform.select({
    web: { boxShadow: '0 8px 20px rgba(110,10,15,0.28)' } as object,
    default: { shadowColor: '#6E0A0F', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  }),
};

export const button = {
  height: touch.cta,
  radius: radius.pill,
  paddingH: space.lg,
  text: type.h3,
  /** Label line height inside CTAs — a touch tighter than h3 so a 2-line label still fits a ~64dp pill. */
  lineHeight: 21,
};

export const motion = { pressScale: 0.97, fast: 120, normal: 220 } as const;

export const tokens = { gutter, colors, space, radius, touch, headerBtn, type, textFix, fontScaleCap, fontFamily, elevation, button, motion, brandSource };
export default tokens;
