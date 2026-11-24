/** Disbursal-document upload and payout to the dealer's account (IDFC LMS / payments). */
import { delay, nowTime, rid } from './mock';
import type { DisbursalDocType, DisbursalResult, Result } from './types';

export async function uploadDisbursalDoc(type: DisbursalDocType): Promise<Result<{ docId: string; type: DisbursalDocType }>> {
  await delay(900);
  return { ok: true, data: { docId: rid('UPL'), type } };
}

export async function requestDisbursal(lan: string, netAmount: number, creditedTo = 'ABC Motors · IDFC FIRST ••4321', elapsedSec = 108): Promise<Result<DisbursalResult>> {
  await delay(1600);
  const t = nowTime();
  return {
    ok: true,
    data: {
      utr: rid('IDFBR', 15),
      netAmount,
      creditedTo,
      elapsedSec,
      timeline: [
        { label: 'Application submitted', detail: 'Application and documents received', at: t },
        { label: 'Approved', detail: 'All checks completed', at: t },
        { label: 'Amount disbursed', detail: "Credited to dealer's account", at: t },
      ],
    },
  };
}
