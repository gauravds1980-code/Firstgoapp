import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DealerSession } from '../services/auth';
import { secureStorage } from '../utils/secureStorage';
import { hydrateDealerStores } from './stores';
import { DEFAULT_PHASE, FeatureFlags, Phase, featuresFor, USED_VEHICLES_ENABLED } from '../config/phases';
import { Asset, catalogueFor, Condition, PRODUCT_IDS, ProductId } from '../config/products';
import { DealerProfile, enabledCategories, enabledConditions, mockDealerProfile } from '../services/dealer';
import { mockOffer } from '../services/offers';
import type { DisbursalDocType, DisbursalResult, EkycResponse, MandateResponse, PreQualifiedOffer } from '../services/types';
import { maxLoan, PRODUCTS_DEFAULT_TENURE } from '../utils/finance';

const SESSION_KEY = 'boom.dealerSession';

export type MandateMode = 'upi' | 'debitCard' | 'netBanking';

/** Milestones (epoch ms) used for the "approved & disbursed in…" timeline. */
export type Milestone = 'offer' | 'kyc' | 'mandate' | 'esign' | 'disbursed';

export interface Journey {
  offer: PreQualifiedOffer;
  condition: Condition;
  asset: Asset;
  tenure: number;
  loan: number;
  ekyc?: EkycResponse & { fromBankRecords?: boolean };
  mandate?: MandateResponse & { mode: MandateMode; existing?: boolean };
  esignDone: boolean;
  docs: Record<DisbursalDocType, boolean>;
  disbursal?: DisbursalResult;
  /** Real journey start (offer found), epoch ms. */
  startedAt: number;
  marks: Partial<Record<Milestone, number>>;
}

function freshJourney(product: ProductId, condition: Condition, oem: string | undefined, offer?: PreQualifiedOffer): Journey {
  const o = offer ?? mockOffer(product, undefined, condition);
  const asset = catalogueFor(product, condition, oem)[0]!;
  const now = Date.now();
  return {
    offer: o,
    condition,
    asset,
    tenure: PRODUCTS_DEFAULT_TENURE(product),
    loan: maxLoan(product, o.amount, asset.onRoadPrice, condition),
    esignDone: false,
    docs: { invoice: false, insurance: false, deliveryPhoto: false },
    startedAt: now,
    marks: { offer: now },
  };
}

/** First category the dealer can originate (a CV-only dealer starts on 'cv', never on twoWheeler). */
function defaultProduct(p: DealerProfile | null | undefined): ProductId {
  return (p ? enabledCategories(p)[0] : undefined) ?? 'twoWheeler';
}
const oemOf = (p: DealerProfile | null | undefined) => (p && p.type !== 'multiBrand' ? p.oem : undefined);

/**
 * Sessions saved before v1.1 have no profile — derive it from the mock dealer master. Sessions saved
 * before v1.3.0 have no `facilityType` — backfill it (and keep `hasTaInf` in sync with it).
 */
function withProfile(s: DealerSession): DealerSession {
  if (!s.profile || !('hasTaInf' in s.profile)) return { ...s, profile: mockDealerProfile(s.mobile).profile };
  let profile: DealerProfile = s.profile;
  // v1.4.6: sessions saved before Money in flight have no dealer segments.
  if (!profile.segments) profile = { ...profile, segments: mockDealerProfile(s.mobile).profile.segments };
  if (profile.facilityType !== undefined) return profile === s.profile ? s : { ...s, profile };
  const facilityType = mockDealerProfile(s.mobile).profile.facilityType;
  return { ...s, profile: { ...profile, facilityType, hasTaInf: facilityType != null } };
}

interface Ctx {
  /** Dealer auth — deliberately separate from `journey` (customer data). */
  session: DealerSession | null;
  sessionRestored: boolean;
  signIn: (s: DealerSession) => Promise<void>;
  signOut: () => Promise<void>;
  /** Dealer profile (type, OEM, enabled products). Null when signed out. */
  profile: DealerProfile | null;
  /** Categories / conditions this dealer can originate. */
  categories: ProductId[];
  conditions: Condition[];
  phase: Phase;
  setPhase: (p: Phase) => void;
  features: FeatureFlags;
  product: ProductId;
  setProduct: (p: ProductId) => void;
  condition: Condition;
  setCondition: (c: Condition) => void;
  /** Catalogue for the current product/condition, filtered to the dealer's OEM. */
  catalogue: Asset[];
  journey: Journey;
  startJourney: (offer: PreQualifiedOffer) => void;
  update: (patch: Partial<Journey>) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>(DEFAULT_PHASE);
  const [product, setProductRaw] = useState<ProductId>('twoWheeler');
  const [condition, setConditionRaw] = useState<Condition>('new');
  const [session, setSession] = useState<DealerSession | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const profile = session?.profile ?? null;
  const oem = profile && profile.type !== 'multiBrand' ? profile.oem : undefined;
  const [journey, setJourney] = useState<Journey>(() => freshJourney('twoWheeler', 'new', undefined));

  useEffect(() => {
    secureStorage.get(SESSION_KEY)
      .then(async (raw) => {
        if (!raw) return;
        const s = withProfile(JSON.parse(raw) as DealerSession);
        // Saved payout claims / RC submissions load before the first signed-in paint (no stale tile counts).
        await hydrateDealerStores(s.dealerId);
        const p = defaultProduct(s.profile);
        setProductRaw(p); setConditionRaw('new'); setJourney(freshJourney(p, 'new', oemOf(s.profile)));
        setSession(s);
      })
      .catch(() => {})
      .finally(() => setSessionRestored(true));
  }, []);

  // Keep product/condition inside what the dealer is enabled for.
  const categories = useMemo(() => (profile ? enabledCategories(profile) : PRODUCT_IDS), [profile]);
  const effProduct: ProductId = categories.includes(product) ? product : categories[0] ?? defaultProduct(profile);
  const conditions = useMemo(() => (!USED_VEHICLES_ENABLED ? (['new'] as Condition[]) : profile ? enabledConditions(profile, effProduct) : (['new', 'used'] as Condition[])), [profile, effProduct]);
  const effCondition: Condition = conditions.includes(condition) ? condition : conditions[0] ?? 'new';
  useEffect(() => {
    if (effProduct !== product) setProductRaw(effProduct);
    if (effCondition !== condition) setConditionRaw(effCondition);
    if (effProduct !== journey.offer.product || effCondition !== journey.condition || (oem && journey.asset.brand !== oem))
      setJourney(freshJourney(effProduct, effCondition, oem));
  }, [effProduct, effCondition, product, condition, oem]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (s: DealerSession) => {
    const full = withProfile(s);
    await secureStorage.set(SESSION_KEY, JSON.stringify(full));
    await hydrateDealerStores(full.dealerId);
    // Start on a product this dealer can originate (CV-only dealer → 'cv').
    const p = defaultProduct(full.profile);
    setProductRaw(p); setConditionRaw('new'); setJourney(freshJourney(p, 'new', oemOf(full.profile)));
    setSession(full);
  }, []);
  const signOut = useCallback(async () => {
    await secureStorage.remove(SESSION_KEY);
    // Signed out there is no dealer profile; the next signIn picks that dealer's first category.
    const p = defaultProduct(null);
    setSession(null);
    setProductRaw(p);
    setConditionRaw('new');
    setJourney(freshJourney(p, 'new', undefined)); // drop any in-flight customer data on logout
  }, []);

  const setProduct = useCallback((p: ProductId) => {
    setProductRaw(p);
    const conds = !USED_VEHICLES_ENABLED ? (['new'] as Condition[]) : profile ? enabledConditions(profile, p) : (['new', 'used'] as Condition[]);
    const c = conds.includes(condition) ? condition : conds[0] ?? 'new';
    setConditionRaw(c);
    setJourney(freshJourney(p, c, oem));
  }, [profile, condition, oem]);
  const setCondition = useCallback((c: Condition) => {
    setConditionRaw(c);
    setJourney(freshJourney(effProduct, c, oem));
  }, [effProduct, oem]);
  const startJourney = useCallback((offer: PreQualifiedOffer) => {
    setProductRaw(offer.product);
    setConditionRaw(offer.condition);
    setJourney(freshJourney(offer.product, offer.condition, oem, offer)); // stopwatch starts here
  }, [oem]);
  /** Patches the journey and stamps milestones the first time each step completes. */
  const update = useCallback((patch: Partial<Journey>) => setJourney((j) => {
    const now = Date.now();
    const marks = { ...j.marks };
    if (patch.ekyc && !marks.kyc) marks.kyc = now;
    if (patch.mandate && !marks.mandate) marks.mandate = now;
    if (patch.esignDone && !marks.esign) marks.esign = now;
    if (patch.disbursal && !marks.disbursed) marks.disbursed = now;
    return { ...j, ...patch, marks };
  }), []);

  const catalogue = useMemo(() => catalogueFor(effProduct, effCondition, oem), [effProduct, effCondition, oem]);

  const value = useMemo(
    () => ({
      session, sessionRestored, signIn, signOut, profile, categories, conditions, phase, setPhase, features: featuresFor(phase),
      product: effProduct, setProduct, condition: effCondition, setCondition, catalogue, journey, startJourney, update,
    }),
    [session, sessionRestored, signIn, signOut, profile, categories, conditions, phase, effProduct, setProduct, effCondition, setCondition, catalogue, journey, startJourney, update],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

