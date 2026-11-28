/**
 * v1.4.6 design library — semantic tone NAMES only (no colours, no React Native), so pure logic and node tests can
 * use the same thresholds as the components. `src/theme/library.ts` maps these names onto `tokens.ts` colours.
 * Spec: /workspace/dealer-research/designs/00-design-library.md §3.
 */

/** Money-in-flight stages, in order. A file is in exactly one stage at a time. */
export type MifStage = 'sanctioned' | 'docsPending' | 'disbursalInitiated' | 'credited';
export const MIF_STAGES: readonly MifStage[] = ['sanctioned', 'docsPending', 'disbursalInitiated', 'credited'];
export const STAGE_LABEL: Record<MifStage, string> = {
  sanctioned: 'Sanctioned', docsPending: 'Docs pending', disbursalInitiated: 'Disbursal initiated', credited: 'Credited',
};

/** StageChip tone (a `Pill` tone). */
export const stageTone = {
  sanctioned: 'info',
  docsPending: 'warning',
  disbursalInitiated: 'cta',
  credited: 'success',
} as const satisfies Record<MifStage, string>;

/** Ageing = calendar days in the current uncredited stage. Approved 28 Nov 2026: same rule for every product. */
export type AgeingBand = 'onTime' | 'ageing' | 'overdue';
export const ageingDays = { onTimeMax: 1, ageingMax: 3 } as const; // 4+ is overdue
export const ageingTone = { onTime: 'success', ageing: 'warning', overdue: 'danger' } as const satisfies Record<AgeingBand, string>;
export const AGEING_LABEL: Record<AgeingBand, string> = { onTime: 'On time', ageing: 'Ageing', overdue: 'Overdue' };

/** 0–1 day On time, 2–3 days Ageing, 4+ days Overdue. */
export function ageingBand(days: number): AgeingBand {
  if (days <= ageingDays.onTimeMax) return 'onTime';
  if (days <= ageingDays.ageingMax) return 'ageing';
  return 'overdue';
}

/** Who can clear a blocker. The case sheet offers a CTA only when it is the dealer's (or a customer reminder helps). */
export type BlockerOwner = 'dealer' | 'customer' | 'bank';

/** Banner tone for the case sheet's stage banner, from ageing (credited → success). */
export const ageingBannerTone = { onTime: 'info', ageing: 'warning', overdue: 'danger' } as const satisfies Record<AgeingBand, string>;
