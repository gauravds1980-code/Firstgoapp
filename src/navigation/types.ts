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
  Asset: undefined;
  FaceKyc: undefined;
  Mandate: undefined;
  Kfs: undefined;
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

export type JourneyStep = 'offer' | 'asset' | 'kyc' | 'mandate' | 'kfs' | 'esign' | 'docs' | 'disbursal';
export type AssistantContext = JourneyStep | 'search' | 'scan' | 'home' | 'login' | 'payouts' | 'portfolio' | 'cases' | 'rc' | 'tainf' | 'profile';

export const JOURNEY_STEPS: { key: JourneyStep; label: string }[] = [
  // Offer is shown on the Vehicle & EMI screen since v1.2 (one screen less).
  { key: 'asset', label: 'Offer, vehicle & EMI' },
  { key: 'kyc', label: 'Face KYC' },
  { key: 'mandate', label: 'AutoPay mandate' },
  { key: 'kfs', label: 'KFS & charges' },
  { key: 'esign', label: 'E-sign' },
  { key: 'docs', label: 'Documents' },
  { key: 'disbursal', label: 'Disbursal' },
];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation { interface RootParamList extends RootStackParamList {} }
}
