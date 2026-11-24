import { useEffect } from 'react';
import { useRoute } from '@react-navigation/native';
import type { AssistantContext } from '../../navigation/types';

/** Route name → assistant context (drives Zippy's tip and the sheet's suggestions). */
export const ROUTE_CONTEXT: Record<string, AssistantContext> = {
  DealerLogin: 'login', DealerOtp: 'login', Home: 'home', Profile: 'profile', QuickList: 'home', ScanQr: 'scan', SearchMobile: 'search',
  Offer: 'offer', Asset: 'asset', FaceKyc: 'kyc', Mandate: 'mandate', Esign: 'esign', Docs: 'docs', Disbursal: 'disbursal',
  Payouts: 'payouts', Portfolio: 'portfolio', Cases: 'cases', RcPendency: 'rc', TaInf: 'tainf',
};

/** One short tip per screen — upbeat and confident, still dealer-floor professional. */
export const TIPS: Record<AssistantContext, string> = {
  login: "Your registered dealer mobile is the key. I'll hold the door.",
  home: 'Ready when you are. Scan QR below is the express lane to a new loan.',
  profile: 'Your dealership, at a glance. Changes go through your RM.',
  scan: '15–20 cm away, screen brightness up. QR codes love a well-lit stage.',
  search: "Customer reads out the OTP; six digits in and I'll verify it on the spot.",
  offer: "Pre-approved and ready. That's the ceiling — no haggling with this number.",
  asset: 'Slide the amount and the EMI follows. Under ₹15,000 keeps UPI AutoPay happy. Charges sit at the bottom.',
  kyc: 'Glasses and cap off, good light, eye level. Face in the oval, one blink — the camera does the rest.',
  mandate: 'Customer scans the AutoPay QR and enters their UPI PIN. That one approval and we roll on to e-sign.',
  esign: 'The KFS is on their phone with the agreement. Once they consent, six digits and it signs itself.',
  docs: 'Three uploads stand between you and disbursal. Invoice first?',
  disbursal: "Money's on its way. Share the RC once registration's done — I'll remind you.",
  payouts: "Tap an invoice to see each case. Unclaimed? One tap and it's in the queue.",
  portfolio: 'Green is good. Tap a DPD bucket to see who needs a friendly nudge.',
  cases: 'Flip the date range up top to compare months side by side.',
  rc: "Snap the RC and I'll read the number. Tick a few to share them in one go.",
  tainf: 'Keep an eye on the bar: past 80% utilised, it turns red.',
};

/**
 * Screen-level override for Zippy's tip, keyed by route (e.g. a waived step shouldn't say "remove glasses").
 * `''` = stay quiet on this screen (auto-advancing animations); `null` = use the default tip.
 */
const overrides = new Map<string, string | null>();
export function getTipOverride(route: string) { return overrides.get(route) ?? null; }

/** Call at the top of a screen; cleared on unmount. */
export function useZippyTip(text: string | null) {
  const route = useRoute().name;
  overrides.set(route, text); // synchronous so the bubble's route-change timer sees it
  useEffect(() => () => { overrides.delete(route); }, [route]);
}
