import type { ListKind } from '../services/dealer';
import type { MifRouteParams } from '../voice/moneyVoice';
import type { AlertFilter } from '../services/alerts';
import type { StatementFilter } from '../services/payoutStatement';

export type RootStackParamList = {
  // Auth stack (no session)
  DealerLogin: { mobile?: string } | undefined;
  DealerOtp: { mobile: string; txnId: string; resendInSec?: number };
  // Main stack (session)
  Home: undefined;
  Profile: undefined;
  /** v1.3.0: Profile rows — Help & support (FAQs), Privacy & terms, and honest coming-soon screens. */
  HelpSupport: undefined;
  PrivacyTerms: undefined;
  ComingSoon: { kind: 'staff' | 'notifications' };
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
  /** v1.4.7: `invoice` expands that invoice (alert / push tap); `lan` highlights a short-paid line; `at` = a fresh request. */
  /**
   * v1.4.7 alert deep links (`invoice`, `lan`); v1.4.8 statement: `invoice` + `lan` opens that line sheet on the period
   * holding it; `period` (preset, or `month` 0-11 for "October ka statement"), `filter` chip, `query` = open QuerySheet.
   */
  Payouts: { invoice?: string; lan?: string; period?: 'thisMonth' | 'lastMonth' | 'last3Months'; month?: number; filter?: StatementFilter; query?: boolean; at?: number } | undefined;
  Portfolio: undefined;
  Cases: undefined;
  RcPendency: undefined;
  TaInf: undefined;
  /** v1.4.6 Money in flight (boom://money). `filter` chip, `lan` opens that file's sheet, `q` search, `query` opens QuerySheet; `at` = a fresh voice / alert request. */
  MoneyInFlight: MifRouteParams | undefined;
  /** v1.4.7 Credit and payout alerts inbox (boom://alerts). `filter` chip; `at` = fresh request. */
  Alerts: { filter?: AlertFilter; at?: number } | undefined;
  /** v1.4.7 Notification settings (boom://alerts/settings). `focus` = scroll hint from "alerts band karo". */
  AlertSettings: { focus?: 'push'; at?: number } | undefined;
  /** v1.3.0: Help & tutorials. `focus` = a short id to open straight away (e.g. /help?focus=mandate). */
  Help: { focus?: string } | undefined;
  /** v1.3.0: Reels-style vertical shorts feed (full-screen), opened at `startId` (deep link /shorts/:startId). */
  ShortsFeed: { startId?: string } | undefined;
};

export type JourneyStep = 'offer' | 'asset' | 'kyc' | 'mandate' | 'esign' | 'docs' | 'disbursal';
export type AssistantContext = JourneyStep | 'search' | 'scan' | 'home' | 'login' | 'payouts' | 'portfolio' | 'cases' | 'rc' | 'tainf' | 'profile' | 'help' | 'money' | 'alerts';

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
