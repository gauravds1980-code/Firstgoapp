/**
 * NPCI UPI AutoPay e-mandate (MVP 1). EMI must be ≤ UPI_MANDATE_EMI_CAP (₹15,000).
 *
 * Real flow (via IDFC FIRST as PSP/sponsor bank):
 *  - ReqMandate (create) → NPCI → payer PSP collect/intent → customer approves with UPI PIN
 *  - RespMandate returns the UMN (Unique Mandate Number); ReqMandateConfirmation on timeout.
 *  - Pre-debit notification ≥24h before each execution; execution only in non-peak hours.
 *
 * Specs / rules:
 *  - NPCI UPI AutoPay: https://www.npci.org.in/product/autopay
 *  - (Switch-level XML specs are member-only — obtain via IDFC sponsor-bank UPI team.)
 */
import { UPI_MANDATE_EMI_CAP } from '../config/phases';
import { delay, rid } from './mock';
import type { MandateRequest, MandateResponse, Result } from './types';

export const VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/;

/** Stub for ReqMandate (CREATE). Resolves with the UMN once the customer approves. */
export async function createUpiMandate(req: MandateRequest, emi: number): Promise<Result<MandateResponse>> {
  await delay(2000);
  if (emi > UPI_MANDATE_EMI_CAP)
    return { ok: false, code: 'EMI_ABOVE_UPI_CAP', message: 'EMI is above the UPI AutoPay cap. Extend the tenure or lower the amount.' };
  if (!VPA_REGEX.test(req.payerVpa)) return { ok: false, code: 'VPA_INVALID', message: 'Invalid UPI ID.' };
  if (req.payerVpa.startsWith('fail')) return { ok: false, code: 'DECLINED', message: 'Customer declined the mandate request in their UPI app.' };
  return { ok: true, data: { umn: `${rid('UMN', 12)}@idfcfirst`, status: 'ACTIVE', payerVpa: req.payerVpa } };
}

/** MVP 2: debit-card / net-banking e-NACH via NPCI API e-mandate. */
export async function createEnachMandate(mode: 'debitCard' | 'netBanking'): Promise<Result<MandateResponse>> {
  await delay(1500);
  return { ok: true, data: { umn: rid('NACH', 14), status: 'ACTIVE', payerVpa: mode } };
}

/** Demo payee VPA used in the Scan & Setup QR / intent. */
export const DEMO_PAYEE_VPA = 'idfcfirst.demo@idfcbank';

/** NPCI date format for mandate validity (YYYYMMDD, local date). */
export function npciDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * UPI AutoPay "Scan & Setup" mandate intent. The same URI is rendered as the QR and fired
 * via Linking for "Open UPI app". DEMO payee only — this prototype never raises a live mandate.
 */
export function buildUpiMandateUri(p: { emi: number; maxAmount: number; start: Date; end: Date; note: string; ref: string }): string {
  const q = [
    ['pa', DEMO_PAYEE_VPA],
    ['pn', 'IDFC FIRST Bank'],
    ['am', p.emi.toFixed(2)],
    ['mam', p.maxAmount.toFixed(2)],
    ['cu', 'INR'],
    ['recur', 'MONTHLY'],
    ['validitystart', npciDate(p.start)],
    ['validityend', npciDate(p.end)],
    ['tn', p.note],
    ['tr', p.ref],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v!).replace(/%40/g, '@')}`).join('&');
  return `upi://mandate?${q}`;
}
