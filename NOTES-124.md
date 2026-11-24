# FIRSTgo v1.2.4 — notes

Version: `app.json` → `version` 1.2.4, `android.versionCode` 7. Application id `com.idfcfirst.boom.dealer` unchanged. (`app.config.js` only overrides the name; `eas.json` uses `appVersionSource: remote`; iOS `buildNumber` was not changed.)

## Files changed

- `src/components/BrandWordmark.tsx` (new): shared one-line "IDFC FIRST Bank" text lockup.
- `src/screens/HomeScreen.tsx`: header uses `BrandWordmark`; header row sizing; section link lane for Zippy.
- `src/components/assistant/ZippyBubble.tsx`: exports `ZIPPY_RIGHT_LANE`. No behaviour change.
- `src/components/assistant/HeaderDockSlot.tsx`: the slot is `flexShrink: 0`, so it never squeezes.
- `src/components/Screen.tsx` (BrandHeader): logo image, divider, help and home buttons are `flexShrink: 0`. The product overline can wrap to 2 lines at most, then ellipsizes, with font scale capped.
- `src/components/AuthScaffold.tsx`: logo image is `flexShrink: 0`. The right cluster is the part that shrinks.
- `app.json`: version bump.

## A) "IDFC FIRST Bank" on one line

`BrandWordmark` uses `bodyStrong` (15/22 SemiBold, maroon) with "FIRST" in `Inter_800ExtraBold`. It also sets:
- `numberOfLines={1}`
- `adjustsFontSizeToFit` with `minimumFontScale={0.85}`
- `maxFontSizeMultiplier={fontScaleCap.control}` (1.2)
- `accessibilityLabel="IDFC FIRST Bank"`

The wordmark shrinks to fit. It does not wrap.

Home header row: the 44dp mark, the 44dp dock slot, and the 48dp (`touch.min`) bell and avatar are all `flexShrink: 0`. Only the title column (`flex: 1, flexShrink: 1, minWidth: 0`) shrinks. The fixed parts used to be separated by a 12dp `gap`; that was replaced with 8dp after the mark and 4dp after the title, and no gap between the trailing controls (their 48dp boxes already pad the glyphs).

Width left for the title column (estimated, not measured on a device):
- 360dp: 360 − 20·2 − 44 − 8 − 4 − 44 − 48 − 48 ≈ **124dp**. Before this change it was about 88dp.
- 390dp: about **154dp**.

"IDFC FIRST Bank" is about 121dp at 1.0× (measured from the v1.2.3 screenshot), so at 1.0× it fits at both widths without shrinking. At the 1.2× cap it is about 145dp: at 390dp it fits, and at 360dp it shrinks to about 0.85, right at the limit. Only below 0.85 would RN ellipsize as a last resort.

The dealer subline is `numberOfLines={1}` with an ellipsis and `fontScaleCap.compact`.

BrandHeader and AuthScaffold use the `idfc-logo.png` image lockup (fixed width, `contain`), which cannot wrap. It is now explicitly non-shrinking. The splash is the app.json image and has no text label.

## B) Zippy clear of "View all"

The content scrolls, so a fixed rest position alone can't keep Zippy off every heading row. Instead, Home keeps a right-hand lane clear for Zippy.

`ZIPPY_RIGHT_LANE` = 8 margin + 60 body + 8 gap + 7.5 vehicle overhang + 26 ✕ + 8 breathing room, rounded up to **118dp** from the right edge. The inner-side ✕ ends about 110dp in.

`Section` rows that have a link (Loans, Payouts "View all") get `paddingRight = 118 − 20 gutter = 98dp`. That puts the link left of Zippy and its ✕ at any scroll position, on both 360 and 390.

At 360dp the row still has about 222dp for title + link. "Payouts" plus "View all ›" is about 214dp at the font caps: titles are capped at `compact` 1.3 and can ellipsize, and the link is capped at `control` 1.2 and doesn't shrink.

Unchanged: Zippy's rest position (BOTTOM_CLEAR, still above the Scan QR FAB), dock behaviour, the inward side ✕ and the artwork. Zippy can still pass over non-interactive content while scrolling, such as the Today figures and the loan row pills.

Checks: `npx tsc --noEmit` passes. Not run on a device. Lint was not run, as instructed.

## Face KYC

**Approach: front-camera preview with a simulated blink (fallback). It does not detect a real blink.**

Why not real blink detection: expo-camera 58 has no face-detection API. A real blink would need a second camera stack (react-native-vision-camera plus an ML Kit face-detector frame-processor plugin and its config plugin) next to the expo-camera QR / RC scanner. Adding that without being able to build and test the APK in this session risked breaking the existing scanner, the config plugins, or the `com.idfcfirst.boom.dealer` build. The capture UI is isolated in `FaceCapture`, so a real detector can be dropped in later: call `onBlink` when eye-open probability goes below about 0.3 and then back up.

What it does:
- "Start face capture" (consent is collected by this tap, as before) opens `src/components/FaceCapture.tsx`, full screen: expo-camera `CameraView` with `facing="front"`, `useCameraPermissions` like ScanQr.
- The oval face guide is drawn with react-native-svg, with a dimmed mask outside the oval and a gold breathing halo. The top bar reads "Face e-KYC · IDFC FIRST Bank · Aadhaar liveness check". The white status panel has a gold grabber, maroon status text, and a "Nothing is stored" line.
- Status: "Starting camera…" until `onCameraReady` fires, then **"Okay, blink"**. If the preview never reports ready (for example, a simulator with no camera), it goes ready after 4 s.
- Blink: simulated **3 s** after "Okay, blink" appears. There is also a hidden tap on the oval or the status line. Neither is labelled or announced as a button.
- After the blink: success haptic, green tick in the oval, "Liveness passed". e-KYC is fetched (`ekyc.performEkyc25`) in parallel with a **1 s** beat, then the app navigates to **Mandate on its own**. There is no Continue / Next button. The "Continue to mandate" footer is gone; on the done path the footer is empty.
- Permission: asks once automatically. If denied, a card explains why and offers **Open Settings** and **Try again**. A camera mount error switches to the placeholder (with a note) instead of crashing.
- Web: always uses the placeholder (face icon behind the oval), with the same oval, overlay, "Okay, blink", 3 s fallback, hidden tap, and auto-advance, so the screen can be screenshotted.
- Error (e-KYC call fails): the capture screen shows the error and a Retry button. ✕ goes back to the consent screen.
- Zippy: `thinking` during capture, `happy` on the success beat and when done.
- The ETB waiver path is unchanged.

Copy: camera permission strings in `app.json` (expo-camera plugin, expo-image-picker plugin, iOS `NSCameraUsageDescription`) now mention face e-KYC as well as QR and RC. The ScanQr permission card says the camera is also used for RC and face e-KYC. KYC tips and FAQs mention the oval and blink. `ios/` is gitignored CNG output, so its Info.plist picks up the new string on the next prebuild. I did not edit it by hand.

Known gap: when a dealer navigates back to a completed Face KYC screen, it shows the verified card with no footer button. That follows the "no Continue on the done path" rule.

## UPI AutoPay Scan & Setup

`src/screens/MandateScreen.tsx` (UPI mode, EMI within the cap):
1. **Summary card**: Lender IDFC FIRST Bank, EMI amount, Monthly, start / end dates, max debit, and a "UPI AUTOPAY" pill.
2. **Scan & Setup QR**: a real, scannable QR from `react-native-qrcode-svg` (added with `npx expo install`; it uses the existing react-native-svg). It has a maroon frame, a "DEMO QR" pill, and a caption saying it is a prototype, not a live collect. The payload comes from `mandate.buildUpiMandateUri` (`src/services/mandate.ts`):
   `upi://mandate?pa=idfcfirst.demo@idfcbank&pn=IDFC%20FIRST%20Bank&am=<emi>.00&mam=<max>.00&cu=INR&recur=MONTHLY&validitystart=YYYYMMDD&validityend=YYYYMMDD&tn=<product>%20loan%20EMI&tr=IDFCMDT<10 digits>`
   `tn` depends on the product: Two-wheeler / Car / Commercial vehicle loan EMI. The dates use the NPCI YYYYMMDD format (`npciDate`). Max is 1.5× the EMI rounded up to ₹100, as before. Validity runs from today to tenure + 3 months.
3. **Open UPI app**: `Linking.openURL` with the same URI. If no app handles it, a small in-screen toast (not an Alert) says to ask the customer to scan the QR. It auto-hides after 3.5 s, and the QR stays usable.
4. **Waiting**: starts from "Open UPI app" or the footer "Start Scan & Setup". The card reads "Waiting for approval in your UPI app" and shows an elapsed mm:ss timer plus a 5:00 "request valid" countdown. The NPCI create stub starts when waiting begins. In simulation the approval comes after **6 s**, or on a hidden tap on the waiting card. There is no visible Simulate / Continue / Next. The footer is empty while waiting.
5. **Success**: "Mandate created successfully" with the **UMRN** (still stored as `umn`) and the payer, plus a success haptic. The app moves to **e-sign on its own after 1 s**. The "Continue to e-sign" footer is gone.
6. A note under the flow says the customer approves with their UPI PIN and gets a pre-debit notification 24 hours before each EMI.

Secondary path: "Or send a request to a UPI ID" swaps the QR for the old VPA field. A demo ID starting with `fail` is still declined. This path uses the same waiting / success screens. A decline shows a danger banner, and the footer offers "Try Scan & Setup again" or "Send … again".

Unchanged: the ETB mandate waiver auto-advance, the UPI cap banner and "Change tenure / amount", the MVP 2 debit card / net banking rows (their footer still reads "Set up e-mandate" and they now auto-advance the same way), and the mandate service types. Mode rows are hidden while waiting and after success.

Zippy: the mandate tip, pending nudge, section help (the `details` section is now "Scan & Setup") and AssistantSheet FAQs now describe Scan & Setup, Open UPI app, no UPI app found, UMRN, and the 24 h pre-debit notice.

Checks: `npx tsc --noEmit` passes. Not run on a device or in Metro. Lint and APK build were not run, as instructed.

## Design-review top 10

Source: `/workspace/firstgo-122-screens/DESIGN-REVIEW.md`, "Prioritized top 10". Each item below says whether it is done and how. The earlier v1.2.4 work (one-line `BrandWordmark`, "View all" lane, Face KYC camera, UPI Scan & Setup) is kept. Version is still 1.2.4 / versionCode 7, and the app id is unchanged.

Checks: `npx tsc --noEmit` passes. Not run on a device or in Metro. Lint, prebuild and the APK build were not run, as instructed.

### 1. Zippy covers live content — **done**

- **Docked by default.** `zippyStore.hydrate()` now reads a new key, `firstgo.zippy.float`. Zippy starts docked in the header slot unless the dealer chose to float it, so every install starts docked whatever the old `firstgo.zippy.docked` flag said.
- **Docked face:**
  - Tap opens the help sheet (`zippyDock.requestSheet()`).
  - Long-press makes Zippy float. There is also an a11y action for this.
- **Tips:**
  - Shown once per screen per session, whether Zippy is docked or floating.
  - They no longer appear in a balloon beside the orb. Each tip is published to the store (`zippyTip.show/hide`) and drawn by the new `ZippyTipSlot` (`src/components/assistant/ZippyTipSlot.tsx`).
  - The slot is the bottom safe zone directly above the sticky footer: in `JourneyScreen` and `AuthScaffold` it sits between the ScrollView and the footer, and on Scan QR it sits above the bottom buttons. Because it takes its own row in the layout, the scroll area shrinks while the tip shows, so the tip can't cover form errors, links or amounts. On Home it is anchored just above the Scan QR FAB.
  - Tips auto-dismiss after 5.2 s.
- **One close control.**
  - The bubble's ✕ dismisses the tip only. Tapping the bubble opens the help sheet.
  - The red ✕ badge beside Zippy is removed.
  - To hide Zippy: long-press the floating orb (550 ms, no drag; there is also an a11y action), or use the new menu row in the help sheet ("Hide Zippy in the header" / "Show Zippy on screen").
- **Floating Zippy** is opt-in. It rests above the footer plus a 72dp tip zone. Not done: limiting floating to low-density screens only (the review says "if needed"). Floating has to be chosen explicitly and is easy to undo.

### 2. Prototype / dev text visible — **done**

- New flag `src/config/devFlags.ts`: `SHOW_DEV_UI = __DEV__ || EXPO_PUBLIC_SHOW_DEV_UI === '1'`. It is false in a release APK unless that env var is set.
- **Hidden behind the flag:**
  - The login demo legend.
  - Every "Example data" chip (`ExampleTag` returns null) and the Home "Example data in Actions screens" line.
  - "Simulate successful scan".
  - The Profile "Developer · rollout phase" panel.
  - The Search demo / ETB 5555/6666/7777 legend (the digit counter stays).
  - On the mandate screen: the "fail" UPI ID hint, the "Demo QR" pill and its caption.
  - In the assistant sheet: the disabled "Typing coming soon (placeholder)" input and the "Prototype: canned answers" note.
  - QuickList's "Prototype: mock data".
- **"Mock OCR on the RC photo"** now reads "From the RC photo. Takes a second."
- **"Coming in MVP n" → "Coming soon"** for fingerprint KYC, the debit card / net banking mandates, and the self-serve link.
- **Other "MVP n" copy** reworded in the banners, the Asset footer warning, the mandate banner, FAQs / section help, and the service error messages.
- **No-offer banner** now reads: "Right now, instant offers are only for existing IDFC FIRST customers. …"

### 3. Status pills truncated — **done**

- **`Pill` (ui.tsx):**
  - Uses the `label` style (13/18 SemiBold) with no letter-spacing and no `numberOfLines`.
  - `flexShrink: 0` and `minWidth: 56`, with no maxWidth, so it sizes to its content and the text beside it gives way instead.
- **Every caller now passes sentence case:** Disbursed / Approved / Pending, Credited, Not claimed / Claimed / Paid, Current, Overdue / Due soon / On time, Submitted, Required, KYC on file, UPI AutoPay, Pre-approved, Valid till 24 Nov, and the dealer type.
- **Pill under the amount:** on Payouts, Cases and RC the pill sits on its own line under the amount, in a non-shrinking column.
- **Catalogue chip** is now "Hero models" / "Maruti models" / "Tata models" / "All brands".

### 4. Brand lockup — **done**

- **New `src/components/BrandMarks.tsx`:**
  - `IdfcMark`: the official F mark, with paths taken from `assets/idfc-logo.svg`, in white on a maroon rounded tile. On the maroon login hero it gets a white keyline.
  - `FirstGoChevron`: the » mark from `assets/brand/mark.svg`.
  - `FirstGoTag`: "FIRST" in ExtraBold plus "go" in Regular. It is never upper-cased.
  - `BrandLockup`: the mark, the one-line `BrandWordmark`, and "» FIRSTgo" under the wordmark.
- **Login (`AuthScaffold`):** shows the lockup with "» FIRSTgo · Dealer app" in mixed case. The uppercase "FIRSTGO · DEALER APP" overline and the 2-line PNG lockup are gone.
- **Home header:** the same lockup, with "» FIRSTgo".
- **Journey / screen header (`BrandHeader`):** the same mark tile plus the one-line wordmark. The PNG `Logo` is removed, because that asset is itself a 2-line lockup.
- **Result:** one mark treatment on all three surfaces.

### 5. Scan QR FAB covers rows — **done**

- Home scroll bottom padding = FAB bottom offset + FAB height (72 disc + 4 + 22 label) + 24 (`FAB_CLEARANCE`). The last loan, payout and tile rows can now scroll clear of the FAB.
- The fade gradient now matches the FAB zone.

### 6. Overflow: date sheet, tenure, page shift — **done (not device-verified)**

- **Tenure:** an equal-width wrapping grid, 3 per row (`width: '31%'`, 8dp gaps). It replaces the horizontal ScrollView, so "72" / "84" are always visible.
- **Date-range sheet:**
  - The From / To cards stack the month and day steppers vertically, each full width, with `minWidth: 0` and one-line values.
  - The `Sheet` itself is now `width: '100%'` with `overflow: 'hidden'`. Its body is a shrinkable ScrollView, and the footer (Apply) sits outside the scroll with a top border, so Apply stays visible.
- **Page shift:**
  - I couldn't reproduce it here. The likely cause was long unbreakable strings (UTR numbers) in flex rows without `minWidth: 0`.
  - Fix: text columns on Payouts, Portfolio, Cases, RC, QuickList and Home now have `minWidth: 0`, and UTRs sit on their own line with middle ellipsis. The `JourneyScreen` ScrollView is pinned to `width: '100%'`.

### 7. Skip path vs. step chrome — **done**

- **Asset CTA** follows `waiverPlan`:
  - "Confirm & start KYC" when KYC is not on file.
  - "Confirm & set up mandate" when only KYC is on file.
  - "Confirm & go to e‑sign" when both are on file.
- **Offer card line** reads "On file: KYC + AutoPay mandate · both steps skipped". If the mandate on file doesn't cover the EMI, it says so instead.
- **Interstitials:** the FaceKyc and Mandate waiver screens pass `interstitial="Checking bank records"`. `StepProgress` then shows that title with no step number and no "Next".
- **Skipped segments** get a "✓ On file" label under the gold bar.
- Not changed: the shield mid-draw animation (part of #7's "why", not its suggested fix).

### 8. Header context and wrapping — **done**

- **`JourneyScreen` props:**
  - New `title`: Payouts, Portfolio, Cases done, RC pendency, TA / INF limits, Profile, and the QuickList title.
  - A screen with no `step` gets a back chevron (it goes back, or to Home when there is nothing to go back to) instead of the Home button.
- **Header heading:**
  - Journey screens show the product in sentence case ("Commercial vehicle loan"), on one line with ellipsis.
  - Non-journey screens show their own title, also on one line.
- **Step row:**
  - Reads "Step 3/6 · Mandate" and "Next: e‑sign", both `numberOfLines={1}`.
  - Uses new `short` labels in `JOURNEY_STEPS`. "e‑sign" uses U+2011 (`NB_HYPHEN`).
  - The header height no longer changes between steps.

### 9. Home header and hero — **done**

- **Header:** extra `space.xs` top padding on top of the safe-area inset.
- **Dealer block** at the top of the scroll:
  - Line 1: the name, as h3 on one line.
  - Line 2: "Dealer · Hero MotoCorp · Andheri East", one line with ellipsis. No line starts with an orphan "·".
- **Hero:**
  - Title is "New loan" (h2, one line).
  - Product / OEM chips sit on one non-wrapping row; the chips ellipsize.
  - Below that: the Search CTA and a one-line Scan QR hint. Padding is reduced.
- **Compact amounts:** `inrShort` now gives ₹12.6L / ₹1.25Cr, with no space before the unit and trailing zeros trimmed. Today figures are one line with shrink-to-fit.
- **Times:** they use a non-breaking space before AM/PM in the mock data (`t()` helper and the QuickList metas). Loan rows put the time on its own line.

### 10. Data, masking, feedback — **done**

- **Masking:** `maskMobile` is the one format, `+91 ••••• •2345`, with non-breaking spaces. It is used by auth, e-sign, Search, OTP, Profile, Offer and Asset. The dealer OTP screen no longer prints the full number.
- **Home tiles:**
  - They use the shared date filter (`useDateRange` + `inRange`) and the same `casesFor` / `invoicesFor` source as Payouts, Portfolio and Cases. The tile and the screen behind it now show the same count. The sub-line names the range ("21 disbursed · this month").
  - Today's figures (applications / approved / disbursed) all come from today's application list.
  - The mock list now has every loan credited today as DISBURSED, so "0 Approved" next to a non-zero "Disbursed" can't happen.
- **Payouts chart:** a bar is highlighted when its month overlaps the selected range: Last month → Oct, This month → Nov, and a custom range highlights every month it touches.
- **RC OCR:**
  - It returns the number on the photo: either a valid registration number found in the picked file's name, or the sample RC's printed number `MH 02 EK 4821` (`SAMPLE_RC_REG`, from `boom-rn-tools/mock-rc.png`). It no longer makes up a number per case.
  - It is still a stand-in until a real OCR API is wired. A random photo would also get MH 02 EK 4821; the dealer checks the prefilled field.
- **RC submit:**
  - The case moves to Submitted, with a "Submitted" pill and the registration number.
  - A toast confirms it, e.g. "RC MH 02 EK 4821 submitted · moved to Submitted". This uses the new `toast` prop on `JourneyScreen`, shown above the footer for 3.5 s.
