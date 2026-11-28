/**
 * v1.4.6 in-app design library: semantic aliases ONLY. Every value points at an existing token in `tokens.ts`
 * (no new hex). Shared components in `src/components/library/` read these; feature screens never declare colours.
 * Spec: /workspace/dealer-research/designs/00-design-library.md.
 */
import { colors } from './tokens';
import type { AgeingBand } from './libraryTones';

export * from './libraryTones';

/** Foreground for ageing text beside an AgeingPill ("6 days"): secondary ink, danger when overdue. */
export const ageingText: Record<AgeingBand, string> = {
  onTime: colors.textSecondary,
  ageing: colors.textSecondary,
  overdue: colors.danger,
};

/** Icon well colour for a product row (InFlightRow) and the Money in flight glyph. */
export const inFlightWell = colors.tileNavy;

/** Timeline dot / connector colours (same language as the Disbursal celebration timeline). */
export const timelineColors = {
  doneBg: colors.successSoft,
  doneFg: colors.success,
  currentBg: colors.primary,
  currentFg: colors.onPrimary,
  futureBg: colors.surfaceMuted,
  futureFg: colors.textMuted,
  connectorDone: colors.successBright,
  connector: colors.border,
  currentTime: colors.success,
} as const;

/** HomeSummaryCard sublines. */
export const summaryTone = {
  overdue: colors.danger,
  calm: colors.textSecondary,
  credited: colors.success,
  overline: colors.textSecondary,
  link: colors.primary,
} as const;

/** AlertCard tones reuse Banner's wash / ink pairs. */
export const alertTone = {
  info: { bg: colors.primaryTint, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
} as const;

/** v1.4.7 PreferenceSwitch (feature 2): track on / off / locked, from existing tokens only. */
export const preferenceTone = {
  on: colors.successBright,
  off: colors.borderStrong,
  locked: colors.disabledBg,
  thumb: colors.surface,
  title: colors.text,
  titleLocked: colors.textSecondary,
  caption: colors.textSecondary,
} as const;

/** v1.4.7 inbox: unread dot on the leading well (spec: colors.primary), row divider, white row surface. */
export const inboxTone = {
  unreadDot: colors.primary,
  divider: colors.border,
  rowBg: colors.surface,
  overline: colors.textSecondary,
  link: colors.primary,
  checkboxOn: colors.primary,
  checkboxOff: colors.primary,
} as const;

/** v1.4.8 payout statement (StatementSummaryCard / PayoutLineRow): hero + figure tones, from existing tokens only. */
export const statementTone = {
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
  info: colors.info,
  neutral: colors.text,
  caption: colors.textSecondary,
  label: colors.textSecondary,
  divider: colors.border,
  rowWell: colors.tileNavy,
} as const;
export type StatementToneName = keyof typeof statementTone;

/** v1.4.9 VoiceAnswerCard (feature 5): Banner-tone washes for a spoken status answer, from existing tokens only. */
export const answerTone = {
  info: { bg: colors.infoSoft, fg: colors.info },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  success: { bg: colors.successSoft, fg: colors.success },
  question: colors.textSecondary,
  answer: colors.text,
  well: colors.surface,
} as const;
export type AnswerToneName = 'info' | 'warning' | 'success';
