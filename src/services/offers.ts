/**
 * Pre-qualified offer lookup (IDFC FIRST internal LOS / offer engine).
 * MVP 1 serves ETB (existing-to-bank) pre-approved customers only.
 *
 * Mock rules for demos:
 *   mobile ending 0000 → no offer found
 *   mobile ending 9999 → network error (retry state)
 *   anything else       → offer
 *
 * ETB waiver test customers (customer mobile, search or QR payload containing it):
 *   ends 5555 → KYC on file (KYC step skipped)
 *   ends 6666 → mandate already registered (mandate step skipped)
 *   ends 7777 → both KYC and mandate on file
 */
import { Condition, PRODUCTS, ProductId } from '../config/products';
import { delay, rid } from './mock';
import type { ConsentOtpSession, PreQualifiedOffer, Result } from './types';

const OFFER_AMOUNT: Record<ProductId, Record<Condition, number>> = {
  twoWheeler: { new: 150000, used: 100000 },
  car: { new: 1000000, used: 600000 },
  cv: { new: 1200000, used: 700000 }, // example values
};

export const ETB_TEST_NUMBERS = { kycWaived: '9912345555', mandateWaived: '9912346666', both: '9912347777' } as const;

function waiversFor(mobile: string): PreQualifiedOffer['waivers'] {
  const kyc = mobile.endsWith('5555') || mobile.endsWith('7777');
  const mdt = mobile.endsWith('6666') || mobile.endsWith('7777');
  return {
    kycOnFile: kyc ? { verifiedOn: '12 Aug 2026', source: 'Bank KYC records (CKYC)' } : undefined,
    mandateOnFile: mdt ? { umn: 'UMN7741902285@idfcfirst', payerVpa: 'rahul.sharma@okidfc', maxAmount: 15000, registeredOn: '03 Mar 2026' } : undefined,
  };
}

export function mockOffer(product: ProductId, mobile = '9912345677', condition: Condition = 'new'): PreQualifiedOffer {
  return {
    offerId: rid('OFR', 8),
    customerName: 'Rahul Sharma',
    registeredMobile: mobile,
    loanApplicationNumber: '90039765432',
    product,
    amount: OFFER_AMOUNT[product][condition],
    validTill: new Date(Date.now() + 7 * 864e5).toISOString(),
    segment: 'ETB',
    condition,
    waivers: waiversFor(mobile),
  };
}

/** Step 1 of mobile search: send a consent OTP to the customer before revealing any offer. */
export async function sendConsentOtp(mobile: string): Promise<Result<ConsentOtpSession>> {
  await delay(700);
  if (mobile.endsWith('9999')) return { ok: false, code: 'NETWORK', message: "Couldn't reach the server. Check your connection and try again." };
  return { ok: true, data: { txnId: rid('CNS'), maskedMobile: `+91 XXXXXX${mobile.slice(-4)}`, expiresInSec: 30 } };
}

/** Step 2: verify consent OTP, then fetch the offer. */
export async function verifyConsentAndFetchOffer(
  mobile: string,
  otp: string,
  product: ProductId,
  condition: Condition = 'new',
): Promise<Result<PreQualifiedOffer | null>> {
  await delay(900);
  if (otp.length !== 6) return { ok: false, code: 'OTP_INVALID', message: 'Enter the 6-digit OTP.' };
  if (otp === '000000') return { ok: false, code: 'OTP_INVALID', message: 'Incorrect OTP. Ask the customer to read it again.' };
  if (mobile.endsWith('0000')) return { ok: true, data: null };
  return { ok: true, data: mockOffer(product, mobile, condition) };
}

/** QR path: the customer's app QR encodes a signed offer token. */
export async function resolveOfferFromQr(qrPayload: string, product: ProductId, condition: Condition = 'new'): Promise<Result<PreQualifiedOffer>> {
  await delay(800);
  if (!qrPayload || !qrPayload.trim()) return { ok: false, code: 'QR_INVALID', message: 'QR not recognised. Ask the customer to refresh the offer QR in their IDFC FIRST app.' };
  // Mock: any QR is accepted. If it contains a 10-digit mobile, use it (lets testers hit the ETB waiver numbers).
  const m = qrPayload.match(/[6-9]\d{9}/);
  return { ok: true, data: mockOffer(product, m ? m[0] : undefined, condition) };
}

export const productLabel = (p: ProductId) => PRODUCTS[p].label;
