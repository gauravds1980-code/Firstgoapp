# FIRSTgo v1.2.2 (versionCode 5)

Character: Gaurav picked Concept E (Soft Clay Hood) and asked for it furry. The app ships **E-furry** — a maroon plush hooded Zippy with short visible fur, a pale face in the hood opening, a glowing gold chest chevron, and a gold scarf only when riding the two-wheeler. Header dock, moods and the close-X that docks are unchanged. Board: `/workspace/firstgo-zippy-concepts/v2/E-furry.png`.

Built on 89a03ae. Not committed. `npx tsc --noEmit` passes. No APK, no prebuild, Metro not started.

## Behaviour changes

### 1. Commercial Vehicle product + Tata CV dealer (login ending **3333**)
- New `ProductId` `'cv'` ("Commercial Vehicle", header "COMMERCIAL VEHICLE LOAN", `truck` icon). The Tata Motors catalogue has Ace Gold, Intra V30, Yodha 2.0, 407 Gold SFC and Ultra T.7. Prices and terms are examples, not IDFC pricing: 85% LTV, 12–60 months (default 48), 11.5% p.a., min loan ₹1.5 L, ₹5k step, car-like charges. Offer amount ₹12 L.
- New dealer line `newCv` (new commercial vehicles only). There is no used-CV line; the `USED_TERMS.cv` row exists only so the types are complete. `dealerProductKey` now returns `undefined` for a line that doesn't exist, instead of crashing.
- A dealer mobile ending **3333** logs in as **Tata CV Hub** (Dealer · Tata Motors · Chakan, Pune · new CV only · has TA/INF). This is documented in `mockDealerProfile` and in the `auth.ts` header, and the login screen's demo line lists it.
- `enabledCategories` is derived from `PRODUCT_IDS`, so `'cv'` appears whenever the dealer has `newCv`. The 1111 multi-brand dealer stays TW + Car.
- AppState: sign-in and session restore start on the dealer's first enabled category, so a CV-only dealer starts on `cv`, never on twoWheeler. Logout resets to the neutral default, and the next sign-in picks that dealer's product.
- `casesFor` uses `enabledCategories(profile)` and no longer uses the `endsWith('Car'/'Tw')` filter. Tata CV models are added, CV cases have `CV-` LANs, and CV payouts are an example 0.6%.
- Home:
  - Recent loans, the payouts card and Today's numbers are filtered to the dealer's products. CV recent/payout rows were added to the mock.
  - The product Segmented control shows "Commercial Vehicle" next to the other products for any dealer with more than one product.
  - The CV-only 3333 dealer gets the existing single-product chip ("Commercial Vehicle only" with a truck icon, plus "Tata Motors"), the same way the 2222 car-only dealer is shown.
  - The dashboard copy "Two Wheeler / Car mix" is now "Product mix". QuickList Loans/Payouts rows are filtered by product. The Cases screen shows a per-product split.
- The CV journey reuses the car flow (Asset → KYC → mandate → e-sign → docs → disbursal) with the CV catalogue and terms.

### 2. KFS removed from the dealer journey
- The `Kfs` route, screen (`KfsScreen.tsx` deleted), deep link `boom://kfs` and the `'kfs'` step/assistant context are gone. The journey has 6 steps; the e-sign step is now "KFS consent & e-sign".
- After the Mandate step (success auto-advance, "Continue to e-sign", or the waived auto-advance) the app goes to **E-sign**. When both KYC and mandate are waived, FaceKyc goes straight to **E-sign**, still skipping the mandate.
- The E-sign screen shows a chip: **"KFS sent to customer on +91 XXXXX X7777 · awaiting consent"**. It reads "Sending KFS…" before the link goes out and "consent received" after signing.
- `maskMobile` now uses 5+5 grouping with the last 4 digits visible (`+91 XXXXX X7777`) everywhere, and the e-sign service mask matches.
- The net disbursal and the itemised charges, which were on the old KFS screen, are now a collapsible "Net disbursal to you" card on Asset.
- Zippy tips, Assistant FAQs and the mandate success card all say the KFS goes to the customer with the e-sign link.
- Tap counts are in `TAPCOUNTS-122.md`: normal path 8 → 7 and waived 7777 path 7 → 6, counted from the Search screen (−1 tap each).

### 3. Section-aware Zippy help
- New `zippySection.ts`, a small route-keyed store with no provider. It has:
  - `useSectionTracker(initial)` — `at(id[, group])` onLayout + `onScroll` works out which section is in view.
  - `useZippyPending(items)` — what still needs the dealer, with optional quick actions.
  - `reportFooterHeight` — used by item 4 below.
- Sections reported:
  - Home: start, today, loans, actions, payouts.
  - Search: mobile, otp.
  - Asset: vehicle, emi, charges.
  - KYC: method, capture.
  - Mandate: mode, details.
  - E-sign: kfs, otp.
  - Docs: invoice, insurance, deliveryPhoto.
  - Disbursal: receipt, timeline.
  - Payouts: summary, invoices.
  - RC: list.
- Pending nudges:
  - Asset: EMI over the UPI cap, with a "Set N months" action.
  - KYC: capture pending, with "Start capture".
  - Mandate: UPI ID / cap / not set up.
  - E-sign: awaiting customer consent, with "Resend" once the timer ends.
  - Docs: each missing document, with an "Upload …" action.
  - Search: mobile / OTP.
  - Payouts: unclaimed invoices.
  - RC: pending RCs, with "Share oldest RC".
- `AssistantSheet` shows a "Still needed on this screen" card, then FAQs for the section in view (`sectionHelp.ts`), then the screen-wide FAQs. The greeting mentions the first pending item.

### 4. The 10 design practices
1. **Type hierarchy:**
   - Asset: EMI in the footer and an EMI/rate pair are h1, the offer amount is h2, net disbursal is h1.
   - Disbursal: the credited amount is larger.
   - Payouts: a "Ready to claim" figure at display size, invoice amounts h2, payout lines bold.
   - Home: credited today at display size.
2. **Verb-led labels:**
   - "Select vehicle", "Send consent OTP", "Verify OTP & check offer", "Confirm & start KYC", "Start face capture", "Continue to mandate", "Continue to e-sign", "Request disbursal", "Upload N more to disburse", "Go to Home", "Clear all", "Apply date range".
   - `ButtonLabel` keeps the 2-line / minHeight / font-padding work from v1.2.1 and adds `adjustsFontSizeToFit` (min 0.85) so a label never clips.
3. **Button states:**
   - Pressed: scale plus a darker fill.
   - Disabled.
   - Loading: spinner shown with the label kept.
   - New `success` state: green with a check.
   - Double-tap protection: taps are ignored while loading, while an async `onPress` is pending, and for 700 ms after a tap.
4. **Thumb zone / Zippy:**
   - Footer CTAs are unchanged and stay at the bottom.
   - `JourneyScreen` reports the height of its sticky footer, and `ZippyBubble` keeps the orb and its vehicle above it (and above the Home Scan QR zone).
5. **Bottom sheets** are still used only for secondary tasks (date range, RC entry, assistant). KYC, mandate and e-sign remain full screens.
6. **Empty states** (new `EmptyState`): Payouts (no invoices / filter empty), Portfolio (no loans / empty bucket), Cases, RC (all shared / none submitted), and Home Loans. Each has a title, the next step to take, and an action.
7. **Inline validation:**
   - Search mobile: wrong first digit flagged at once, a digit counter, short number flagged on blur.
   - OTP digit counters on search and e-sign.
   - Asset tenure/amount: the cap message under the tenure, the fixing tenure outlined, the amount card turns red.
   - Docs: "Required" pills and per-slot error/retry.
   - Date range: inline error.
8. **Reduced motion:** ZippyRide is static (no drive-in, spin or bounce). The existing Zippy and motion fallbacks are unchanged.
9. **Expressive Zippy:** the vehicle plumbing below. The rider keeps its mood, wink and speaking animations.
10. **Haptics:** `hapticMoment.{qrSuccess, rcCaptured, offerSent, disbursalComplete}` in `utils/haptics.ts` fire on a QR resolved, an RC read by OCR, the consent OTP sent and the KFS/e-sign link sent, and the disbursal hero. They do nothing on web.

### 5. Vehicle-riding plumbing (placeholder character)
- `Zippy.tsx` is renamed to **`ZippyCharacter.tsx`** (`ZippyCharacter`, `ZippyCharacterProps`). This is the only component that draws the character, and the orb face is unchanged. The dock slot, the bubble, the sheet and the ride all render through it.
- New **`ZippyRide.tsx`** wraps the character on a vehicle for the dealer's product:
  - Scooter for twoWheeler, car for car, mini truck for cv. Multi-brand dealers get the product selected on Home.
  - Native SVG + Reanimated: a drive-in on mount or product change, spinning wheels (also while dragged), and a suspension bounce.
  - Reduced motion → static.
- The ride appears in the floating bubble (signed in) and the assistant sheet header. The header dock and the auth screens show the bare character.
- No v2 pebble / hood / chevron art was added. A v2 design only needs to replace `ZippyCharacter.tsx`.

### Version
- `app.json`: `version` 1.2.2, `android.versionCode` 5. The package id `com.idfcfirst.boom.dealer` is unchanged.
- `eas.json` uses `appVersionSource: remote`, so there is no other version file.
- `ios/FIRSTgo/Info.plist`, which is generated and already stale at 1.2.0, was not edited.

## Files touched
- **New:**
  - `src/components/assistant/ZippyRide.tsx`
  - `src/components/assistant/zippySection.ts`
  - `src/components/assistant/sectionHelp.ts`
  - `TAPCOUNTS-122.md`
  - `CHANGELOG-122.md`
- **Renamed:** `src/components/assistant/Zippy.tsx` → `ZippyCharacter.tsx`
- **Deleted:** `src/screens/KfsScreen.tsx`
- **Modified:**
  - `app.json`
  - `src/config/products.ts`
  - `src/services/{dealer,auth,business,offers,esign}.ts`
  - `src/state/AppState.tsx`
  - `src/navigation/{types.ts,RootNavigator.tsx}`
  - `src/components/{ui,Screen,AssistantSheet,business}.tsx`
  - `src/components/assistant/{ZippyBubble,HeaderDockSlot}.tsx`
  - `src/components/assistant/tips.ts`
  - `src/components/motion/DisbursalMotion.tsx`
  - `src/utils/{finance,haptics}.ts`
  - `src/screens/{Home,Search,ScanQr,Offer,Asset,FaceKyc,Mandate,Esign,Docs,Disbursal,Payouts,Portfolio,Cases,RcPendency,QuickList,DealerLogin}Screen.tsx`

## Not verified
- Not run on a device or simulator, so the vehicle art proportions, the drive-in feel and the footer clearance need a visual check.
- Lint was not run: there is no ESLint config in the repo, and `npx expo lint` would scaffold one.