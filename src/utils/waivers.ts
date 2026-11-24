import { termsFor, ProductId } from '../config/products';
import type { Journey } from '../state/AppState';
import { emi } from './finance';

/** Which journey steps are waived for this ETB customer (bank records). */
export function waiverPlan(journey: Journey, product: ProductId): { kyc: boolean; mandate: boolean } {
  const w = journey.offer.waivers;
  const monthly = Math.ceil(emi(journey.loan, termsFor(product, journey.condition).annualRate, journey.tenure));
  return { kyc: !!w.kycOnFile, mandate: !!w.mandateOnFile && monthly <= w.mandateOnFile.maxAmount };
}
