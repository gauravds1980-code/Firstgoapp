import type { Condition, ProductId } from '../config/products';

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface PreQualifiedOffer {
  offerId: string;
  customerName: string;
  registeredMobile: string; // 10 digits
  loanApplicationNumber: string;
  product: ProductId;
  amount: number;
  validTill: string; // ISO date
  segment: 'ETB';
  /** New or used vehicle — drives LTV, indicative rate and the catalogue. */
  condition: Condition;
  /**
   * ETB waivers from the bank's own records. When present the journey skips the step
   * and shows a short confirmation animation instead.
   */
  waivers: {
    kycOnFile?: { verifiedOn: string; source: string }; // e.g. CKYC / bank re-KYC within validity
    mandateOnFile?: { umn: string; payerVpa: string; maxAmount: number; registeredOn: string };
  };
}

export interface ConsentOtpSession { txnId: string; maskedMobile: string; expiresInSec: number }

/** UIDAI Face RD capture → PID block (encrypted, base64). */
export interface FaceCaptureResult {
  pidBlock: string; // <PidData> encrypted Pid, Skey, Hmac, DeviceInfo
  livenessScore: number;
  wadh: string; // hash enabling e-KYC on face auth
}

export interface EkycResponse {
  txn: string;
  uidToken: string; // never the raw Aadhaar number
  name: string;
  dob: string;
  gender: 'M' | 'F' | 'T';
  addressLine: string;
  photoBase64?: string;
}

export interface MandateRequest {
  payerVpa: string;
  amountMax: number; // per-debit maximum
  frequency: 'MONTHLY';
  startDate: string;
  endDate: string;
  purpose: string; // NPCI purpose code
  loanApplicationNumber: string;
}

export interface MandateResponse { umn: string; status: 'ACTIVE' | 'PENDING' | 'DECLINED'; payerVpa: string }

export interface EsignSession { txnId: string; agreementUrl: string; maskedMobile: string }
export interface EsignResult { signedDocId: string; signedAt: string }

export type DisbursalDocType = 'invoice' | 'insurance' | 'deliveryPhoto';

export interface DisbursalResult {
  utr: string;
  netAmount: number;
  creditedTo: string;
  elapsedSec: number;
  timeline: { label: string; detail: string; at: string }[];
}
