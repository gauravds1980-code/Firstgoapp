import { useEffect } from 'react';
import { useRoute } from '@react-navigation/native';
import type { AssistantContext } from '../../navigation/types';

/** Route name → assistant context (drives Zippy's tip and the sheet's suggestions). */
export const ROUTE_CONTEXT: Record<string, AssistantContext> = {
  DealerLogin: 'login', DealerOtp: 'login', Home: 'home', Profile: 'profile', QuickList: 'home', ScanQr: 'scan', SearchMobile: 'search',
  Offer: 'offer', Asset: 'asset', FaceKyc: 'kyc', Mandate: 'mandate', Kfs: 'kfs', Esign: 'esign', Docs: 'docs', Disbursal: 'disbursal',
  Payouts: 'payouts', Portfolio: 'portfolio', Cases: 'cases', RcPendency: 'rc', TaInf: 'tainf',
};

/** One short, light-hearted tip per screen. */
export const TIPS: Record<AssistantContext, string> = {
  login: "Hi, I'm Zippy! Use your registered dealer mobile and I'll get you in quick.",
  home: 'Good to see you! Tap Scan QR at the bottom to start a loan in seconds.',
  profile: 'Your dealership details live here. Looking sharp!',
  scan: 'Hold the phone 15–20 cm from the QR. Brighter screen, faster scan.',
  search: "The customer gets the OTP. Once all 6 digits are in, I'll verify it for you.",
  offer: 'This is the pre-approved ceiling. Good news travels fast!',
  asset: 'Slide the amount and the EMI updates live. Keep it under ₹15,000 for UPI AutoPay.',
  kyc: 'Ask the customer to remove glasses and cap. Good light, eye level. Smile optional!',
  mandate: 'Ask the customer to open their UPI app and approve the AutoPay request.',
  kfs: 'Walk the customer through the charges. Clear now, happy later.',
  esign: 'Customer reads the OTP out. All 6 digits in and it signs by itself.',
  docs: "Three uploads and you're done. Disbursal kicks off on its own.",
  disbursal: "Woohoo, money's on its way! Remember to share the RC once it's out.",
  payouts: 'Tap an invoice to see each case. Not claimed yet? One tap on Claim.',
  portfolio: 'Green is good. Tap a DPD bucket to see who needs a gentle nudge.',
  cases: 'Switch the date range at the top to compare months.',
  rc: "Snap the RC and I'll read the number. Tick a few to share them in one go.",
  tainf: 'Watch the bar: above 80% utilised it turns red.',
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
