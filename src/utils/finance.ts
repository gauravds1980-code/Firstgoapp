import { Condition, PRODUCTS, ProductId, termsFor } from '../config/products';

/** Standard reducing-balance EMI. */
export function emi(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Max loan = min(pre-qualified offer, LTV × on-road price), floored to step. */
export function maxLoan(product: ProductId, offer: number, onRoad: number, condition: Condition = 'new'): number {
  const p = PRODUCTS[product];
  const cap = Math.min(offer, termsFor(product, condition).ltv * onRoad);
  return Math.floor(cap / p.loanStep) * p.loanStep;
}

export interface ChargeLine { label: string; amount: number }

export function charges(product: ProductId, loan: number): { lines: ChargeLine[]; total: number; net: number } {
  const c = PRODUCTS[product].charges;
  const pf = Math.round(loan * c.processingFeePct);
  const lines: ChargeLine[] = [
    { label: `Processing fee (${(c.processingFeePct * 100).toFixed(1)}%)`, amount: pf },
    { label: 'GST on processing fee (18%)', amount: Math.round(pf * c.gstPct) },
    { label: 'Stamp duty (e-stamp)', amount: c.stampDuty },
    { label: 'Documentation charges', amount: c.documentation },
    { label: 'Credit-life insurance (optional)', amount: Math.round(loan * c.insurancePct) },
  ];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, net: loan - total };
}

/** Indian digit grouping: 150000 -> ₹1,50,000 */
export function inr(n: number, decimals = 0): string {
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(decimals).split('.');
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const s = (rest ? rest + ',' : '') + last3;
  return `${neg ? '-' : ''}₹${s}${d ? '.' + d : ''}`;
}

/** Customer mobile for display, Indian 5+5 grouping with the last 4 visible: 9912347777 -> "+91 XXXXX X7777". */
export function maskMobile(m: string): string {
  return m.length === 10 ? `+91 XXXXX X${m.slice(-4)}` : m;
}

export const PRODUCTS_DEFAULT_TENURE = (product: ProductId) => PRODUCTS[product].defaultTenure;

/** "3m 42s" / "48s" */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
