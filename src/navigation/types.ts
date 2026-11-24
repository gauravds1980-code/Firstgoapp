import type { ListKind } from '../services/dealer';

export type RootStackParamList = {
  // Auth stack (no session)
  DealerLogin: { mobile?: string } | undefined;
  DealerOtp: { mobile: string; txnId: string; resendInSec?: number };
  // Main stack (session)
  Home: undefined;
  Profile: undefined;
  QuickList: { kind: ListKind };
  ScanQr: undefined;
  SearchMobile: { stage?: 'enter' | 'otp' | 'none' } | undefined;
  Offer: undefined;
  /** v1.2.8: ~1.6 s pre-approved offer celebration; replaces itself with Asset. Not a journey step. */
  OfferReveal: undefined;
  Asset: undefined;
  FaceKyc: undefined;
  Mandate: undefined;
  Esign: undefined;
  Docs: undefined;
  Disbursal: undefined;
  // Home actions (example data)
  Payouts: undefined;
  Portfolio: undefined;
  Cases: undefined;
  RcPendency: undefined;
  TaInf: undefined;
};

export type JourneyStep = 'offer' | 'asset' | 'kyc' | 'mandate' | 'esign' | 'docs' | 'disbursal';
export type AssistantContext = JourneyStep | 'search' | 'scan' | 'home' | 'login' | 'payouts' | 'portfolio' | 'cases' | 'rc' | 'tainf' | 'profile';

/** Non-breaking hyphen (U+2011): "e‑sign" never splits across lines. */
export const NB_HYPHEN = '\u2011';

/**
 * `label` is the full name (a11y, help); `short` is what the one-line header shows
 * ("Step 3/5 · Mandate", "Next: e‑sign"), so the header never wraps or changes height.
 * v1.2.9: 5 steps. Disbursal is automatic (the final screen, not a tracker step); the last step's
 * "Next:" reads FINAL_STEP_NEXT instead.
 */
export const JOURNEY_STEPS: { key: JourneyStep; label: string; short: string }[] = [
  // Offer is shown on the Vehicle & EMI screen since v1.2 (one screen less).
  // v1.2.2: no dealer KFS step — the KFS goes to the customer with the e-sign link (consent on their phone).
  { key: 'asset', label: 'Offer, vehicle & EMI', short: 'Vehicle & EMI' },
  { key: 'kyc', label: 'Face KYC', short: 'Face KYC' },
  { key: 'mandate', label: 'AutoPay mandate', short: 'Mandate' },
  { key: 'esign', label: 'KFS consent & e-sign', short: `e${NB_HYPHEN}sign` },
  { key: 'docs', label: 'Documents', short: 'Documents' },
];

/** What follows the last tracker step (Documents): disbursal happens by itself. */
export const FINAL_STEP_NEXT = { label: 'Automatic disbursal', short: 'Auto-disbursal' };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation { interface RootParamList extends RootStackParamList {} }
}
