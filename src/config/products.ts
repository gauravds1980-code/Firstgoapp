/**
 * Shared journey config per product. Every journey screen reads from here, so
 * Two Wheeler and Car run the same steps with different catalogue / limits.
 */
export type ProductId = 'twoWheeler' | 'car';

export interface Asset {
  id: string;
  brand: string;
  model: string;
  variant: string;
  onRoadPrice: number;
}

export interface ProductConfig {
  id: ProductId;
  label: string;
  headerSubtitle: string; // "TWO WHEELER LOAN"
  icon: 'motorbike' | 'car-side';
  onRoadPriceRange: [number, number];
  ltv: number; // max loan as fraction of on-road price
  tenureOptions: number[]; // months
  defaultTenure: number;
  annualRate: number; // indicative, for EMI preview only
  minLoan: number;
  loanStep: number;
  catalogue: Asset[];
  /** Customer charges deducted from the loan to get net disbursal. */
  charges: { processingFeePct: number; gstPct: number; stampDuty: number; documentation: number; insurancePct: number };
}

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  twoWheeler: {
    id: 'twoWheeler',
    label: 'Two Wheeler',
    headerSubtitle: 'TWO WHEELER LOAN',
    icon: 'motorbike',
    onRoadPriceRange: [60000, 450000],
    ltv: 0.9,
    tenureOptions: [12, 18, 24, 30, 36],
    defaultTenure: 24,
    annualRate: 0.165,
    minLoan: 25000,
    loanStep: 1000,
    catalogue: [
      { id: 'hero-splendor', brand: 'Hero MotoCorp', model: 'Splendor+', variant: 'XTEC 2.0', onRoadPrice: 92000 },
      { id: 'hero-xtreme', brand: 'Hero MotoCorp', model: 'Xtreme 125R', variant: 'ABS', onRoadPrice: 118000 },
      { id: 'hero-vida', brand: 'Hero MotoCorp', model: 'Vida V2', variant: 'Pro', onRoadPrice: 135000 },
      { id: 're-bullet', brand: 'Royal Enfield', model: 'Bullet 350', variant: 'Battalion Black', onRoadPrice: 225000 },
      { id: 'honda-activa', brand: 'Honda', model: 'Activa 6G', variant: 'DLX', onRoadPrice: 98000 },
      { id: 'tvs-apache', brand: 'TVS', model: 'Apache RTR 160 4V', variant: 'Dual Disc', onRoadPrice: 152000 },
      { id: 'bajaj-pulsar', brand: 'Bajaj', model: 'Pulsar N250', variant: 'Dual Channel ABS', onRoadPrice: 176000 },
      { id: 'ather-450x', brand: 'Ather', model: '450X', variant: '3.7 kWh', onRoadPrice: 165000 },
    ],
    charges: { processingFeePct: 0.02, gstPct: 0.18, stampDuty: 500, documentation: 1000, insurancePct: 0.06 },
  },
  car: {
    id: 'car',
    label: 'Car',
    headerSubtitle: 'CAR LOAN',
    icon: 'car-side',
    onRoadPriceRange: [450000, 3500000],
    ltv: 0.85,
    tenureOptions: [12, 24, 36, 48, 60, 72, 84],
    defaultTenure: 60,
    annualRate: 0.095,
    minLoan: 100000,
    loanStep: 5000,
    catalogue: [
      { id: 'maruti-swift', brand: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', onRoadPrice: 780000 },
      { id: 'maruti-baleno', brand: 'Maruti Suzuki', model: 'Baleno', variant: 'Zeta', onRoadPrice: 890000 },
      { id: 'maruti-brezza', brand: 'Maruti Suzuki', model: 'Brezza', variant: 'ZXi', onRoadPrice: 1240000 },
      { id: 'tata-nexon', brand: 'Tata Motors', model: 'Nexon', variant: 'Creative+ S', onRoadPrice: 1150000 },
      { id: 'hyundai-creta', brand: 'Hyundai', model: 'Creta', variant: 'SX 1.5', onRoadPrice: 1620000 },
      { id: 'mahindra-xuv700', brand: 'Mahindra', model: 'XUV700', variant: 'AX5', onRoadPrice: 2050000 },
    ],
    charges: { processingFeePct: 0.01, gstPct: 0.18, stampDuty: 1000, documentation: 2500, insurancePct: 0.025 },
  },
};

export const PRODUCT_IDS: ProductId[] = ['twoWheeler', 'car'];

/* ---------------- New vs used ---------------- */
export type Condition = 'new' | 'used';
export const CONDITION_LABEL: Record<Condition, string> = { new: 'New', used: 'Used' };

/** The four dealer-enabled product lines. */
export type DealerProduct = 'newCar' | 'usedCar' | 'newTw' | 'usedTw';
export const DEALER_PRODUCTS: { key: DealerProduct; product: ProductId; condition: Condition; label: string }[] = [
  { key: 'newTw', product: 'twoWheeler', condition: 'new', label: 'New Two-Wheeler loans' },
  { key: 'usedTw', product: 'twoWheeler', condition: 'used', label: 'Used Two-Wheeler loans' },
  { key: 'newCar', product: 'car', condition: 'new', label: 'New Car loans' },
  { key: 'usedCar', product: 'car', condition: 'used', label: 'Used Car loans' },
];
export const dealerProductKey = (product: ProductId, condition: Condition): DealerProduct =>
  DEALER_PRODUCTS.find((d) => d.product === product && d.condition === condition)!.key;

/**
 * Used-vehicle terms. EXAMPLE VALUES for the prototype only (not IDFC FIRST pricing):
 * lower LTV and a slightly higher rate than new.
 */
export const USED_TERMS: Record<ProductId, { ltv: number; rateAdd: number; priceFactor: number; year: number }> = {
  twoWheeler: { ltv: 0.75, rateAdd: 0.02, priceFactor: 0.62, year: 2023 },
  car: { ltv: 0.75, rateAdd: 0.015, priceFactor: 0.68, year: 2022 },
};

/** Effective LTV and indicative rate for a product + condition. */
export function termsFor(product: ProductId, condition: Condition = 'new'): { ltv: number; annualRate: number } {
  const p = PRODUCTS[product];
  if (condition === 'new') return { ltv: p.ltv, annualRate: p.annualRate };
  const u = USED_TERMS[product];
  return { ltv: u.ltv, annualRate: p.annualRate + u.rateAdd };
}

/**
 * Asset catalogue for the journey: filtered to the dealer's OEM (OEM dealers / sub-dealers),
 * all brands for multi-brand dealers. Used vehicles are the same models at a used valuation.
 */
export function catalogueFor(product: ProductId, condition: Condition, oem?: string): Asset[] {
  const base = PRODUCTS[product].catalogue.filter((a) => !oem || a.brand === oem);
  const list = base.length ? base : PRODUCTS[product].catalogue;
  if (condition === 'new') return list;
  const u = USED_TERMS[product];
  const step = product === 'car' ? 10000 : 1000;
  return list.map((a) => ({ ...a, id: `${a.id}-used`, variant: `${u.year} · ${a.variant}`, onRoadPrice: Math.round((a.onRoadPrice * u.priceFactor) / step) * step }));
}

/** OEM brands per category (for profile display / validation). */
export const OEM_BRANDS: Record<ProductId, string[]> = {
  twoWheeler: ['Hero MotoCorp', 'Honda', 'TVS', 'Bajaj', 'Royal Enfield', 'Ather'],
  car: ['Maruti Suzuki', 'Hyundai', 'Tata Motors', 'Mahindra'],
};
