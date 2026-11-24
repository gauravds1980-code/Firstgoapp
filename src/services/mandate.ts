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

// ---- v1.2.9: Scan & Setup request + status polling ----------------------------------------------
// The QR is raised as soon as the Mandate screen opens; the app then polls for the customer's
// approval (RespMandate). Mock: a request only turns ACTIVE after simulateUpiMandateApproval()
// (the dealer's "Simulate successful mandate" control). It never approves on its own.

/** How long a Scan & Setup request (QR) stays valid. */
export const UPI_REQUEST_VALID_MS = 5 * 60 * 1000;

export type UpiMandateRequest = { requestId: string; createdAt: number; expiresAt: number };
export type UpiMandateStatus =
  | { status: 'PENDING' }
  | { status: 'ACTIVE'; mandate: MandateResponse }
  | { status: 'DECLINED' | 'EXPIRED'; message: string };

type MockRequest = UpiMandateRequest & { req: MandateRequest; approvedVpa?: string };
const mockRequests = new Map<string, MockRequest>();

/** Stub for ReqMandate (CREATE) in Scan & Setup mode: registers the request behind the QR. */
export async function requestUpiMandate(req: MandateRequest, emi: number): Promise<Result<UpiMandateRequest>> {
  await delay(800);
  if (emi > UPI_MANDATE_EMI_CAP)
    return { ok: false, code: 'EMI_ABOVE_UPI_CAP', message: 'EMI is above the UPI AutoPay cap. Extend the tenure or lower the amount.' };
  if (!VPA_REGEX.test(req.payerVpa)) return { ok: false, code: 'VPA_INVALID', message: 'Invalid UPI ID.' };
  const now = Date.now();
  const r: MockRequest = { requestId: rid('MREQ', 12), createdAt: now, expiresAt: now + UPI_REQUEST_VALID_MS, req };
  mockRequests.set(r.requestId, r);
  return { ok: true, data: { requestId: r.requestId, createdAt: r.createdAt, expiresAt: r.expiresAt } };
}

/** Stub for the mandate status check (RespMandate / ReqMandateConfirmation). */
export async function pollUpiMandate(requestId: string): Promise<Result<UpiMandateStatus>> {
  await delay(250);
  const r = mockRequests.get(requestId);
  if (!r) return { ok: false, code: 'NOT_FOUND', message: 'Mandate request not found. Refresh the QR.' };
  if (r.req.payerVpa.startsWith('fail')) return { ok: true, data: { status: 'DECLINED', message: 'Customer declined the mandate request in their UPI app.' } };
  if (r.approvedVpa) return { ok: true, data: { status: 'ACTIVE', mandate: { umn: `${rid('UMN', 12)}@idfcfirst`, status: 'ACTIVE', payerVpa: r.approvedVpa } } };
  if (Date.now() > r.expiresAt) return { ok: true, data: { status: 'EXPIRED', message: 'The QR expired before the customer approved. Refresh the QR and ask them to scan again.' } };
  return { ok: true, data: { status: 'PENDING' } };
}

/** Demo only: mark a request as approved by the customer (the next poll returns ACTIVE). */
export function simulateUpiMandateApproval(requestId: string, payerVpa: string): boolean {
  const r = mockRequests.get(requestId);
  if (!r || Date.now() > r.expiresAt) return false;
  r.approvedVpa = payerVpa;
  return true;
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
