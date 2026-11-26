/**
 * Tutorial shorts: ids, copy, lengths and the screen → short map (v1.3.0). PURE (no React Native) so the
 * map is unit-testable in Node. The 12 videos and posters are bundled in the app (bundledAssets.ts) and
 * served same-origin from /tutorial on web; the remote URL (catalog.ts / manifest.ts) is the fallback.
 */

export const SHORT_IDS = [
  'full', 'login', 'scan-offer', 'vehicle-emi', 'ekyc', 'mandate', 'esign', 'docs-disbursal',
  'payouts-utr', 'portfolio-cases-rc', 'tainf', 'zippy-voice',
] as const;
export type ShortId = (typeof SHORT_IDS)[number];

/** Non-breaking hyphen (U+2011): "e‑sign" / "e‑KYC" never split across lines. */
const NBH = '\u2011';

export type ShortInfo = {
  id: ShortId;
  title: string;
  subtitle: string;
  /**
   * Length of the rendered video in seconds (shown as "0:18" and in "Watch an 18s how-to"), as listed in
   * the server's manifest.json; a newer manifest still overrides it at launch.
   */
  durationSec: number;
};

export const SHORT_INFO: Readonly<Record<ShortId, ShortInfo>> = {
  full: { id: 'full', title: 'FIRSTgo full tutorial', subtitle: 'A whole loan, from QR scan to disbursal', durationSec: 148.77 },
  login: { id: 'login', title: 'Sign in', subtitle: 'Dealer mobile and OTP', durationSec: 20 },
  'scan-offer': { id: 'scan-offer', title: 'Scan QR & get the offer', subtitle: 'QR or mobile search, consent OTP, pre-approved offer', durationSec: 20 },
  'vehicle-emi': { id: 'vehicle-emi', title: 'Vehicle & EMI', subtitle: 'Pick the model, slide the amount, stay under the UPI cap', durationSec: 20 },
  ekyc: { id: 'ekyc', title: `Face e${NBH}KYC`, subtitle: 'Face in the oval, one blink', durationSec: 19 },
  mandate: { id: 'mandate', title: 'AutoPay mandate', subtitle: 'Customer scans the UPI QR and approves', durationSec: 19 },
  esign: { id: 'esign', title: 'E-sign', subtitle: 'Link to the customer, six-digit OTP', durationSec: 19 },
  'docs-disbursal': { id: 'docs-disbursal', title: 'Documents & disbursal', subtitle: 'Invoice, insurance, delivery photo', durationSec: 19 },
  'payouts-utr': { id: 'payouts-utr', title: 'Payouts & UTR', subtitle: 'Claim invoices, copy the UTR', durationSec: 18 },
  'portfolio-cases-rc': { id: 'portfolio-cases-rc', title: 'Portfolio, cases & RC', subtitle: 'DPD buckets, cases done, RC pendency', durationSec: 20 },
  tainf: { id: 'tainf', title: 'TA / INF limits', subtitle: 'Read the limit bar and dues', durationSec: 15 },
  'zippy-voice': { id: 'zippy-voice', title: 'Zippy & voice', subtitle: 'Ask Zippy, hold the mic to talk', durationSec: 20 },
};

/**
 * Every route in RootStackParamList → its short (null = no short on that screen). manifest.ts checks at
 * compile time that this covers exactly the navigator's routes.
 */
export const SCREEN_SHORT = {
  DealerLogin: 'login',
  DealerOtp: 'login',
  Home: 'zippy-voice',
  Profile: 'zippy-voice',
  QuickList: 'portfolio-cases-rc',
  ScanQr: 'scan-offer',
  SearchMobile: 'scan-offer',
  Offer: 'scan-offer',
  OfferReveal: 'scan-offer',
  Asset: 'vehicle-emi',
  FaceKyc: 'ekyc',
  Mandate: 'mandate',
  Esign: 'esign',
  Docs: 'docs-disbursal',
  Disbursal: 'docs-disbursal',
  Payouts: 'payouts-utr',
  Portfolio: 'portfolio-cases-rc',
  Cases: 'portfolio-cases-rc',
  RcPendency: 'portfolio-cases-rc',
  TaInf: 'tainf',
  // The tutorials screen and the shorts feed themselves have nothing to offer.
  Help: null,
  ShortsFeed: null,
  // Profile's FAQs, privacy and coming-soon screens: static pages, no how-to.
  HelpSupport: null,
  PrivacyTerms: null,
  ComingSoon: null,
} as const satisfies Record<string, ShortId | null>;

export type ScreenName = keyof typeof SCREEN_SHORT;

/** The short for a route name, or null (unknown route, or a screen without one). */
export function screenToShort(screen: string | null | undefined): ShortId | null {
  if (!screen) return null;
  return (SCREEN_SHORT as Record<string, ShortId | null>)[screen] ?? null;
}
