/**
 * Dealer authentication (IDFC FIRST dealer portal / IAM). Mock implementation.
 *
 * Real flow: POST /dealer/auth/otp {mobile} -> txnId; POST /dealer/auth/verify {txnId, otp}
 * -> short-lived access token + refresh token, bound to device. Server enforces the
 * attempt limit; the client mirrors it for UX.
 *
 * Demo rules: OTP is always 123456; a mobile ending 9999 simulates a network error;
 * a mobile ending 0000 is "not a registered dealer". Dealer profiles by number: see
 * mockDealerProfile in ./dealer (default Hero dealer; ends 1111 multi-brand;
 * ends 2222 Maruti sub-dealer; ends 3333 Tata Motors commercial-vehicle dealer, new CV only).
 */
import { DealerProfile, mockDealerProfile } from './dealer';
import { delay, rid } from './mock';
import type { Result } from './types';
import { maskMobile } from '../utils/finance';

export interface DealerSession {
  dealerId: string;
  name: string;
  mobile: string; // dealer's registered mobile — never used as customer data
  token: string;
  issuedAt: string;
  /** Products enabled, dealer type and OEM — drives Home and the journey catalogue. */
  profile: DealerProfile;
}

export interface DealerOtpTxn { txnId: string; maskedMobile: string; resendInSec: number; maxAttempts: number }

export const MOCK_DEALER_OTP = '123456';
export const MAX_OTP_ATTEMPTS = 3;
export const OTP_COOLDOWN_SEC = 60;
export const DEALER_MOBILE_REGEX = /^[6-9]\d{9}$/;

export async function requestDealerOtp(mobile: string): Promise<Result<DealerOtpTxn>> {
  await delay(800);
  if (!DEALER_MOBILE_REGEX.test(mobile)) return { ok: false, code: 'MOBILE_INVALID', message: 'Enter a valid 10-digit mobile number.' };
  if (mobile.endsWith('9999')) return { ok: false, code: 'NETWORK', message: "Couldn't reach IDFC FIRST. Check your connection and try again." };
  if (mobile.endsWith('0000')) return { ok: false, code: 'NOT_DEALER', message: 'This number is not registered as an IDFC FIRST dealer. Contact your relationship manager.' };
  return { ok: true, data: { txnId: rid('DLR'), maskedMobile: maskMobile(mobile), resendInSec: 30, maxAttempts: MAX_OTP_ATTEMPTS } };
}

export async function verifyDealerOtp(txnId: string, mobile: string, otp: string): Promise<Result<DealerSession>> {
  await delay(900);
  if (otp.length !== 6) return { ok: false, code: 'OTP_INCOMPLETE', message: 'Enter all 6 digits.' };
  if (otp !== MOCK_DEALER_OTP) return { ok: false, code: 'OTP_INVALID', message: 'Incorrect OTP.' };
  const d = mockDealerProfile(mobile);
  return { ok: true, data: { dealerId: d.dealerId, name: d.name, profile: d.profile, mobile, token: `mock.${txnId}.${rid('', 16)}`, issuedAt: new Date().toISOString() } };
}

export async function logout(_session: DealerSession | null): Promise<Result<true>> {
  await delay(300); // real: revoke refresh token server-side
  return { ok: true, data: true };
}
