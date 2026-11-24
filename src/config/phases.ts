/**
 * Phased-rollout feature flags. Single source of truth.
 *
 *  MVP 1 — ETB (existing-to-bank) pre-approved customers, UIDAI face e-KYC,
 *          NPCI UPI AutoPay mandate (EMI capped at ₹15,000 for UPI).
 *  MVP 2 — adds biometric fingerprint e-KYC + debit card / net banking
 *          e-mandate (needed for EMIs above the UPI cap, e.g. most car loans).
 *  MVP 3 — target 30–40% of cases with no dealer manpower: self-serve link
 *          sent to the customer.
 *  MVP 5 — dealer cross-sell shelf (business loan, credit card).
 *          Placeholder slot on Home ONLY — intentionally not built.
 *
 * `DEFAULT_PHASE` is the build-time default; the dev toggle in More → Developer
 * overrides it at runtime (see src/state/AppState.tsx).
 */
export type Phase = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_PHASE: Phase = 1;

/** MVP 1 cap on EMI for a UPI AutoPay mandate (₹ / month). */
export const UPI_MANDATE_EMI_CAP = 15000;

/** Gaurav, 24 Nov 2026: NEW vehicles only (cars + two-wheelers) through MVP 5. Flip to re-enable used. */
export const USED_VEHICLES_ENABLED = false;

export interface FeatureFlags {
  etbPreApprovedOnly: boolean;
  faceKyc: boolean;
  upiMandate: boolean;
  fingerprintKyc: boolean;
  debitCardMandate: boolean;
  netBankingMandate: boolean;
  selfServeLink: boolean;
  crossSellShelf: boolean;
  /** Used-vehicle loans. OFF for MVP 1–5 (new vehicles only); logic kept behind this flag. */
  usedVehicles: boolean;
}

export function featuresFor(phase: Phase): FeatureFlags {
  return {
    etbPreApprovedOnly: true,
    faceKyc: true,
    upiMandate: true,
    fingerprintKyc: phase >= 2,
    debitCardMandate: phase >= 2,
    netBankingMandate: phase >= 2,
    selfServeLink: phase >= 3,
    crossSellShelf: false, // MVP 5 — never rendered beyond the placeholder slot in this prototype
    usedVehicles: USED_VEHICLES_ENABLED,
  };
}

/** Phase in which a feature becomes available (for "Coming in MVP n" labels). */
export const AVAILABLE_FROM: Record<keyof FeatureFlags, Phase> = {
  etbPreApprovedOnly: 1,
  faceKyc: 1,
  upiMandate: 1,
  fingerprintKyc: 2,
  debitCardMandate: 2,
  netBankingMandate: 2,
  selfServeLink: 3,
  crossSellShelf: 5,
  usedVehicles: 5, // not scheduled — new vehicles only in MVP 1–5
};

export const PHASE_LABELS: Record<Phase, string> = {
  1: 'MVP 1 · ETB pre-approved, face KYC, UPI mandate',
  2: 'MVP 2 · + fingerprint KYC, debit card / net banking mandate',
  3: 'MVP 3 · + self-serve link (no-manpower cases)',
  4: 'MVP 4 · (reserved)',
  5: 'MVP 5 · cross-sell shelf (placeholder only)',
};
