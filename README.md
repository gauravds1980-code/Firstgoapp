# Firstgoapp

Dealer first go app.

**Current version: v1.4.2** (versionCode 19). [Release](https://github.com/gauravds1980-code/Firstgoapp/releases/tag/v1.4.2) · [APK](https://github.com/gauravds1980-code/Firstgoapp/releases/download/v1.4.2/FIRSTgo-v1.4.2.apk).

FIRSTgo v1.4.2 is the IDFC FIRST Bank dealer-side vehicle loan origination prototype for the bank's wheels business (two-wheeler, car and commercial vehicle). Dealers log in, pull a pre-qualified offer (scan the customer’s QR or search by mobile), and walk a new-vehicle journey through KYC, mandate, agreement, and disbursal. All data is mock. There are no real bank APIs — the integrations in `src/services/` are typed stubs.

## Download the Android APK

[FIRSTgo v1.4.2 release](https://github.com/gauravds1980-code/Firstgoapp/releases/tag/v1.4.2) · [FIRSTgo-v1.4.2.apk](https://github.com/gauravds1980-code/Firstgoapp/releases/download/v1.4.2/FIRSTgo-v1.4.2.apk) (arm64, v1.4.2, versionCode 19).

Direct link: https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.4.2.apk

What's new in v1.4.2:

Zippy voice: live words, a confidence gate, and short sound cues

- Live words while you speak. The phone recogniser now shows words as they come in. If the default recogniser is weak, Zippy can fall back to another speech service on the phone. On-device recognition stays the preference, and auto-off of the live preview is remembered.
- A confidence gate for shaky results. If the phone recogniser is unsure (confidence below 0.6), Zippy waits up to 600 ms for Whisper and uses that transcript when it is at least 0.65 confident. If there is no audio, or Whisper does not arrive in time, Zippy asks "Did you mean…?" instead of acting automatically.
- Short non-verbal cues instead of spoken Piper replies. Accepted, confirm, and not-understood sounds play by default. Spoken Piper replies are behind `voice.spokenReplies` in voice settings and are off by default.

ios.buildNumber stays "1" (no 1.4.x iOS binary has shipped yet). No new native iOS plugins.

Previous builds: [FIRSTgo-v1.4.1.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.4.1.apk), [FIRSTgo-v1.4.0.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.4.0.apk), [FIRSTgo-v1.3.1-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.3.1-arm64.apk), [FIRSTgo-v1.3.0-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.3.0-arm64.apk), [FIRSTgo-v1.2.9-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.9-arm64.apk), [FIRSTgo-v1.2.8-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.8-arm64.apk), [FIRSTgo-v1.2.7-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.7-arm64.apk), [FIRSTgo-v1.2.6-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.6-arm64.apk), [FIRSTgo-v1.2.5-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.5-arm64.apk), [FIRSTgo-v1.2.4-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.4-arm64.apk), [FIRSTgo-v1.2.2-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.2-arm64.apk), [FIRSTgo-v1.2.1-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.1-arm64.apk), and [FIRSTgo-v1.2.0-arm64.apk](https://github.com/gauravds1980-code/Firstgoapp/raw/main/releases/FIRSTgo-v1.2.0-arm64.apk).

## Features in v1.2

- Dealer login and OTP
- Dealer profile with type, OEM, and enabled products
- Single-scroll home with a floating Scan QR button
- New-vehicle journeys (two-wheeler, car or commercial vehicle, depending on the dealer)
- ETB KYC and mandate waivers, with animations when a step is already on file
- Face KYC, UPI AutoPay mandate, and e-sign mocks
- Payouts and invoices
- Advance payout (Payouts screen): up to 3× the average monthly payout of the last 3 months, from a ₹30,000 minimum, with a slider and Transfer funds
- Portfolio
- Cases done
- RC pendency
- TA / INF (Trade Advance and Inventory Funding)
- Zippy assistant (floats on screen by default, always fully in view; drag it into the header to dock, drag the docked face down to float; tap for the help sheet)
- Voice commands: a standalone hold-to-talk mic in the top header, separate from Zippy (see [VOICE.md](VOICE.md))

## Test credentials

OTP is **123456** (dealer login). Customer consent OTP accepts any 6-digit code except `000000`, which is treated as incorrect.

Dealer mobile (10 digits, starting 6–9):

| Number | Result |
| --- | --- |
| Any other number (e.g. `9820012345`) | Hero MotoCorp dealer (ABC Motors) — new two-wheeler, **Trade Advance** (disburse + repay) |
| Ends in `1111` (e.g. `9820011111`) | Multi-brand dealer (Shree Auto Mall) — new two-wheeler and new car, **Trade Advance** (larger limit) |
| Ends in `2222` (e.g. `9820012222`) | Maruti Suzuki sub-dealer (Sai Motors) — new car only, no TA / INF: Home shows **Get working capital** (compare TA vs INF, apply) |
| Ends in `3333` (e.g. `9820013333`) | Tata Motors CV dealer (Tata CV Hub) — new commercial vehicle only, **Inventory Funding** (OEM-drawn, repay only) |
| Ends in `0000` | Not a registered dealer |
| Ends in `9999` | Network error |

A dealer has either Trade Advance or Inventory Funding, never both. TA / INF balances and tranches (drawdowns, repayments), a pending "Enhance my limit" request, and a no-facility dealer's working-capital application all persist per dealer on the device (example data; one pending request or application at a time).

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

Web deep links (handy for demos): `/`, `/search/enter|otp|none`, `/scan`, `/offer`, `/offer-reveal`, `/asset`, `/kyc`, `/mandate`, `/kfs`, `/esign`, `/docs`, `/disbursal`, `/profile`, `/list/{reports|dashboard|rc|tainf|loans|payouts}`.

v1.2.8 journey notes: a pre-approved offer found by QR scan (including "Simulate successful scan") or by mobile search plays a ~1.6 s automatic celebration (`OfferReveal`, tap to skip) and then replaces itself with Vehicle & EMI, so back never replays it. Face KYC opens the front camera on arrival. The UPI Scan & Setup QR has a "Simulate successful mandate" button in every build. UTRs on Home, Payouts and Disbursal copy on tap ("UTR copied").

## Build the APK

Generate the native Android project, then assemble a release APK:

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
```

The published arm64 build for this version is checked in at `releases/FIRSTgo-v1.4.2.apk`. `android/` and `ios/` are generated and gitignored.

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
