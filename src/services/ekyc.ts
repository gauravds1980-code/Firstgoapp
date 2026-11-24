/**
 * UIDAI face-authentication e-KYC (MVP 1).
 *
 * Real flow:
 *  1. App fires the UIDAI Face RD capture intent (`in.gov.uidai.rdservice.face.CAPTURE`)
 *     with a PidOptions XML incl. `wadh` (so the face auth is e-KYC-enabled) and a txn id.
 *  2. Face RD app performs liveness + capture and returns an encrypted PID block
 *     (<PidData> with Skey, Hmac, Data, DeviceInfo).
 *  3. Backend (KUA) wraps the PID in Auth XML 2.5, signs it, wraps in <Kyc ra="P" rc="Y" ...>
 *     and POSTs via the bank's ASA to
 *     https://<host>/kyc/2.5/<KUA code>/<uid[0]>/<uid[1]>/<ASA licence key>
 *  4. Response is encrypted, signed KYC XML (Poi, Poa, Pht). Store UID token, not Aadhaar.
 *
 * NOTE: the mobile app NEVER talks to UIDAI/ASA directly — only to the IDFC KUA backend.
 *
 * Specs:
 *  - UIDAI app-to-app / Face RD specs: https://docs.uidai.gov.in/readme/app-to-app-credential-flows/uidai-specifications
 *  - Aadhaar e-KYC API 2.5:            https://uidai.gov.in/images/resource/aadhaar_ekyc_api_2_5.pdf
 *  - Aadhaar Auth API 2.5 (PID block): https://www.uidai.gov.in/images/resource/Aadhaar_Authentication_API-2.5_Revision-1_of_January_2022.pdf
 */
import { delay, rid } from './mock';
import type { EkycResponse, FaceCaptureResult, Result } from './types';

/** Stub for Face RD capture intent. */
export async function captureFaceViaRdIntent(txnId: string): Promise<Result<FaceCaptureResult>> {
  await delay(1800);
  return { ok: true, data: { pidBlock: `MOCK_PID_${txnId}`, livenessScore: 0.97, wadh: 'MOCK_WADH_HASH=' } };
}

/** Stub for e-KYC 2.5 via the bank's ASA (called by IDFC KUA backend). */
export async function performEkyc25(pid: FaceCaptureResult, consent: boolean): Promise<Result<EkycResponse>> {
  await delay(1200);
  if (!consent) return { ok: false, code: 'NO_CONSENT', message: 'Customer consent is required for Aadhaar e-KYC.' };
  return {
    ok: true,
    data: { txn: rid('UKC'), uidToken: rid('UIDT', 16), name: 'Rahul Sharma', dob: '14-08-1991', gender: 'M', addressLine: 'Andheri East, Mumbai 400069' },
  };
}

/** MVP 2: fingerprint RD device (same PID → e-KYC path, `bt=FMR`). Not active in MVP 1. */
export async function captureFingerprintViaRd(): Promise<Result<FaceCaptureResult>> {
  return { ok: false, code: 'NOT_IN_PHASE', message: 'Fingerprint e-KYC arrives in MVP 2.' };
}
