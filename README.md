# Firstgoapp

Dealer first go app.

FIRSTgo v1.2.4 is the IDFC FIRST Bank dealer-side two-wheeler and car loan origination prototype. Dealers log in, pull a pre-qualified offer (scan the customer’s QR or search by mobile), and walk a new-vehicle journey through KYC, mandate, agreement, and disbursal. All data is mock. There are no real bank APIs — the integrations in `src/services/` are typed stubs.

## Download the Android APK

[FIRSTgo-v1.2.4-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.4-arm64.apk) (arm64, v1.2.4).

Direct link: https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.4-arm64.apk

What's new in v1.2.4:

- Face KYC with front camera, oval guide and "Okay, blink" that auto-advances (blink simulated in this demo)
- UPI AutoPay Scan & Setup mandate with QR, Open UPI app, and UMRN success
- v1.2.3 Zippy close control moved to the side
- 10 design-review fixes: header-docked Zippy, one-line IDFC FIRST Bank lockup, dev text hidden in release, cleaner status pills, tenure grid, consistent masking, compact amounts, FAB clearance

Previous builds: [FIRSTgo-v1.2.2-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.2-arm64.apk), [FIRSTgo-v1.2.1-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.1-arm64.apk), and [FIRSTgo-v1.2.0-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.0-arm64.apk).

## Features in v1.2

- Dealer login and OTP
- Dealer profile with type, OEM, and enabled products
- Single-scroll home with a floating Scan QR button
- New-vehicle journeys (two-wheeler and car, depending on the dealer)
- ETB KYC and mandate waivers, with animations when a step is already on file
- Face KYC, UPI AutoPay mandate, and e-sign mocks
- Payouts and invoices
- Portfolio
- Cases done
- RC pendency
- TA / INF (Trade Advance and Inventory Funding)
- Zippy assistant

## Test credentials

OTP is **123456** (dealer login). Customer consent OTP accepts any 6-digit code except `000000`, which is treated as incorrect.

Dealer mobile (10 digits, starting 6–9):

| Number | Result |
| --- | --- |
| Any other number | Hero MotoCorp dealer (ABC Motors) — new two-wheeler, TA/INF |
| Ends in `1111` | Multi-brand dealer — new two-wheeler and new car, TA/INF |
| Ends in `2222` | Maruti Suzuki sub-dealer — new car only, no TA/INF |
| Ends in `3333` | Tata Motors dealer (Tata CV Hub) — new commercial vehicle, TA/INF |
| Ends in `0000` | Not a registered dealer |
| Ends in `9999` | Network error |

Customer mobile (search, or a QR payload that contains the number):

| Number | Result |
| --- | --- |
| Ends in `5555` | KYC on file (KYC step waived) |
| Ends in `6666` | Mandate on file (mandate step waived) |
| Ends in `7777` | Both KYC and mandate on file |
| Ends in `0000` | No offer |
| Ends in `9999` | Network error on the consent OTP |

Other demo hooks: a UPI ID starting with `fail` declines the mandate. Home → avatar (Profile) → Developer toggles the rollout phase.

## Run

```bash
npm install
npx expo start
```

Scan the QR with Expo Go (Android or iOS), or press `w` for web. `npx tsc --noEmit` typechecks the project.

Web deep links (handy for demos): `/`, `/search/enter|otp|none`, `/scan`, `/offer`, `/asset`, `/kyc`, `/mandate`, `/kfs`, `/esign`, `/docs`, `/disbursal`, `/profile`, `/list/{reports|dashboard|rc|tainf|loans|payouts}`.

## Build the APK

Generate the native Android project, then assemble a release APK:

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
```

The published arm64 build for this version is checked in at `releases/FIRSTgo-v1.2.4-arm64.apk`. `android/` and `ios/` are generated and gitignored.

## iOS

The iOS app uses bundle id `com.idfcfirst.firstgo.dealer`. Producing an installable build needs EAS Build and an Apple Developer account, or a Mac with Xcode. Setup, permissions, and the build profiles are in [IOS_BUILD.md](IOS_BUILD.md).

The iOS changes were produced with Claude Code.

## Structure

- `src/theme/tokens.ts` — design tokens
- `src/config/phases.ts` — MVP feature flags and the ₹15,000 UPI EMI cap
- `src/config/products.ts` — journey config per product (catalogue, price range, LTV, tenures, rate, charges)
- `src/services/` — dealer auth, offers, e-KYC, mandate, e-sign, disbursal, payouts, portfolio (all mocks)
- `src/screens/` — login, home, profile, scan, search, offer, asset, face KYC, mandate, KFS, e-sign, docs, disbursal, payouts, portfolio, cases, RC pendency, TA/INF
- `src/components/` — UI kit, journey scaffold, waiver and disbursal motion, Zippy assistant
