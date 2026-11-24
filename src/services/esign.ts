/**
 * Aadhaar/OTP e-sign of the loan agreement on the dealer's phone.
 * The agreement link — incl. Key Fact Statement (KFS) and all charges — is sent to the
 * customer's registered mobile BEFORE the OTP is shared (RBI digital lending directions).
 * v1.2.2: this is the only place the KFS is delivered — there is no dealer-side KFS screen.
 */
import { delay, rid } from './mock';
import type { EsignResult, EsignSession, Result } from './types';
import { maskMobile } from '../utils/finance';

export async function sendAgreementAndOtp(mobile: string, lan: string): Promise<Result<EsignSession>> {
  await delay(800);
  return { ok: true, data: { txnId: rid('ESG'), agreementUrl: `https://idfcfirst.bank.in/agreement/${lan}`, maskedMobile: maskMobile(mobile) } }; // same grouping as utils/finance maskMobile
}

export async function verifyEsignOtp(txnId: string, otp: string): Promise<Result<EsignResult>> {
  await delay(1000);
  if (otp.length !== 6 || otp === '000000') return { ok: false, code: 'OTP_INVALID', message: 'Incorrect OTP. Ask the customer to check the SMS again.' };
  return { ok: true, data: { signedDocId: rid('DOC'), signedAt: new Date().toISOString() } };
}
