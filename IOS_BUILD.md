# FIRSTgo on iOS (v1.4.9)

FIRSTgo (Expo SDK 58, React Native 0.88) runs on iPhone from the same code as the Android APK and the web build. This page covers the iOS settings, how voice (Zippy) works on a real iPhone, and the exact steps to test, build and ship.

**Status:** the iOS config builds cleanly with `expo prebuild` (checked on Linux, no Xcode). **No iOS binary has been built yet, and nothing has been uploaded to TestFlight or the App Store.** The project is not linked to an EAS project yet (there's no `extra.eas.projectId` in `app.json`), and this box has no Expo login or Apple credentials. See [What Gaurav needs to send](#7-what-gaurav-needs-to-send-us).

---

## 1. App identity

| | iOS | Android |
|---|---|---|
| App ID | `com.idfcfirst.firstgo.dealer` (bundle id) | `com.idfcfirst.boom.dealer` (package) |
| Marketing version | `1.4.9` (`expo.version`) | `1.4.9` |
| Build number | `ios.buildNumber` = `"26"` | `android.versionCode` = `26` |

**v1.4.0:** still `ios.buildNumber` "1" (new marketing version, no 1.4.0 iOS binary yet); adds `expo-speech-recognition` (its plugin sets `NSSpeechRecognitionUsageDescription`, needs a new dev build).

**v1.4.1:** still `ios.buildNumber` "1" (no 1.4.x iOS binary shipped yet); Android `versionCode` 18. Design-only: Phosphor tiles, Zippy dock defaults, contrast/FAB/OTP fixes. No new native iOS plugins.

**v1.4.2:** still `ios.buildNumber` "1" (no 1.4.x iOS binary shipped yet); Android `versionCode` 19. JS-only voice changes: live phone-recogniser words, Whisper confidence gate, non-verbal cues, optional spoken Piper replies. No new native iOS plugins.

**v1.4.3:** still `ios.buildNumber` "1" (no 1.4.x iOS binary shipped yet); Android `versionCode` 20. JS-only voice changes: faster streaming voice, bottom-right mic, and turn logging. No new native iOS plugins.

**v1.4.4:** still `ios.buildNumber` "1" (no 1.4.x iOS binary shipped yet); Android `versionCode` 21. JS-only voice changes: offline vehicle chip selection and clearer voice details. No new native iOS plugins.

**v1.4.5:** still `ios.buildNumber` "1" (no 1.4.x iOS binary shipped yet); Android `versionCode` 22. JS-only changes: hands-off voice, loan amount, TA repay, e-sign OTP, RC by name and voice, and a steadier voice connection. No new native iOS plugins.

**v1.4.6:** Money in flight (mock data), dealer-segment gating. Android `versionCode` 23. `ios.buildNumber` still "1". JS-only; no new native iOS plugins.

**v1.4.7:** Credit and payout alerts (in-app inbox, settings, quiet hours). Android `versionCode` 24. `ios.buildNumber` in `app.json` was set to "24" to match (no 1.4.x iOS binary shipped yet). JS-only; no new native iOS plugins.

**v1.4.8:** Payout statement with short-pay checks. Android `versionCode` 25, `ios.buildNumber` "25". JS-only; no new native iOS plugins.

**v1.4.9:** Hinglish voice status checks. Android `versionCode` 26, `ios.buildNumber` "26". JS-only; no new native iOS plugins. No iOS binary has been built for 1.4.x yet.

**Why the iOS build number is "1".** No iOS binary of v1.3.0 was ever shipped, so v1.3.1 is the first iOS binary, and Apple only requires the build number to be unique and increasing *within one marketing version*. So `1.3.1 (1)` is correct. It doesn't need to match Android's `versionCode` 16, because the two stores count separately. Android reached 16 through earlier APKs; iOS has no history yet.

**Who owns the number after the first build.** `eas.json` sets `"appVersionSource": "remote"`. That means EAS keeps the build number on its servers. The first EAS build reads it from `app.json` (iOS `1`, Android `15`). After that, the `production` profile (`autoIncrement: true`) adds 1 on every build, and the value in `app.json` is no longer used. This is needed because the config is dynamic (`app.config.js`), so EAS can't write the new number back to a file. To check or set it: `npx eas-cli@latest build:version:get -p ios` / `build:version:set -p ios`.

**Why the iOS and Android IDs differ (on purpose).** `com.idfcfirst.boom.dealer` is the ID the shipped Android APK was built with. Changing it would make every dealer uninstall and reinstall, and on Play it would be a new listing. iOS is a new app, so it uses the cleaner `com.idfcfirst.firstgo.dealer`. Keep both as they are.

## 2. iOS settings in `app.json`

| Key | Value |
|---|---|
| `ios.supportsTablet` | `false`: iPhone only (`TARGETED_DEVICE_FAMILY = 1`), portrait |
| `ios.icon` | `./assets/ios-icon.png`: 1024×1024, opaque RGB (no alpha). iOS adds the rounded corners itself. |
| `ios.infoPlist.NSCameraUsageDescription` | Offer QR scan, RC photos, face e-KYC (front-camera liveness check) |
| `ios.infoPlist.NSPhotoLibraryUsageDescription` | RC upload from photos |
| `ios.infoPlist.NSMicrophoneUsageDescription` | "FIRSTgo uses the microphone so you can talk to Zippy." |
| `ios.infoPlist.ITSAppUsesNonExemptEncryption` | `false`: standard HTTPS/OS crypto only, so App Store Connect doesn't ask the export-compliance question |
| `scheme` | `boom` (deep links; prebuild also adds the bundle id as a URL scheme) |
| `userInterfaceStyle` | `light` |

**The plugin strings match `infoPlist`.** `expo-camera`, `expo-image-picker` and `expo-audio` all carry the same camera and microphone text as `ios.infoPlist`, so whichever plugin runs last, the prompt reads the same.

**Privacy strings that are intentionally absent.** App Review rejects privacy strings for features an app doesn't use, so these are left out on purpose:
- **No `NSSpeechRecognitionUsageDescription`.** Zippy does not use Apple's on-device speech recognition. The app records a short clip with `expo-audio` and sends it to the voice server, which does the speech-to-text.
- **No location strings.** The app doesn't use location (no `expo-location`).
- **No `NSFaceIDUsageDescription`.** There's no biometric login. The `expo-secure-store` plugin would add a Face ID string by default, so it's set to `faceIDPermission: false`. Keep it that way. (Face e-KYC uses the camera, not Face ID.)

**Background modes are off.** `expo-audio` has `enableBackgroundRecording: false` and `enableBackgroundPlayback: false`, and `expo-video` has `supportsBackgroundPlayback: false` and `supportsPictureInPicture: false`. `UIBackgroundModes` comes out empty.

**App Transport Security (ATS) is the Expo default:** `NSAllowsArbitraryLoads = false`, `NSAllowsLocalNetworking = true`. No extra exceptions are added, and none should be. See section 3.

**Privacy manifest.** Expo and React Native pods ship their own `PrivacyInfo.xcprivacy` files. CocoaPods merges them into the app during `pod install` on EAS or a Mac (`privacy_file_aggregation_enabled` in the generated Podfile). Nothing is needed in `app.json` unless App Store Connect later emails an "ITMS-91053 Missing API declaration" warning. If it does, add the reported reasons under `ios.privacyManifests` in `app.json`.

### Native modules: all support iOS
| Module | Used for | iOS notes |
|---|---|---|
| `expo-camera` | QR scan, RC photo, face e-KYC | Needs a real device (no camera in the Simulator). Use "Simulate successful scan" there. |
| `expo-image-picker` | RC upload | Uses the iOS photo picker (PHPicker) |
| `expo-audio` | Zippy mic recording + Piper reply playback | Records AAC `.m4a`. Switches `allowsRecording` off before playback, so replies come out of the speaker, not the earpiece. Plays in silent mode. |
| `expo-video` | Tutorials (bundled MP4, HLS + MP4 fallback) | The 12 catalogue shorts are bundled and play offline. AVPlayer plays HLS natively for the HTTPS fallback (`EXPO_PUBLIC_TUTORIAL_BASE_URL`). |
| `expo-clipboard` | Copy UTRs | — |
| `expo-haptics` | Taps | Guarded for web |
| `expo-secure-store`, `expo-file-system`, `expo-font`, `expo-linear-gradient`, `expo-splash-screen`, `expo-status-bar`, `react-native-svg`, `-reanimated`, `-worklets`, `-screens`, `-safe-area-context` | UI and storage | — |

**iOS code fixes from v1.2 are still in place.** Shadows on clipped cards (`HomeScreen`, `DisbursalScreen`), the slider thumb shadow offset, Scan QR shown as a swipe-down `card` on iOS (so the Zippy bubble stays visible), swipe-back turned off during the KYC/mandate waiver animation (`useSwipeBack`), and an **Open Settings** prompt when camera access was denied. Keyboard handling, safe areas, OTP autofill (`oneTimeCode`), fonts and the status bar were checked then and still match Android.

**`expo-speech` was removed in v1.3.0.** Spoken replies always come from Piper over HTTP (`src/voice/piper.ts`), never from expo-speech and never from Google TTS. Nothing imported expo-speech, so it only added an unused native module to the binary.

## 3. Voice (Zippy) on a real iPhone

The app sends recordings to `${EXPO_PUBLIC_STT_URL}/command` and gets Piper replies from `/tts`. If the variable isn't set, the default is `http://127.0.0.1:8793` (the local Whisper + LaBSE + Piper pipeline). The default must stay the local pipeline: don't point the app at the billed Google proxy on 8792.

**Why the default doesn't work on an iPhone:**
1. **`127.0.0.1` means the phone itself**, not this server. It works for web and the iOS Simulator only when the voice server runs on the same machine.
2. **ATS blocks plain `http://` to a normal host.** A device build needs an `https://` voice URL. Don't turn on `NSAllowsArbitraryLoads`: App Review asks for a justification and it weakens security for the whole app.

**What to use instead:** the HTTPS Expo tunnel. `metro.config.js` proxies `/voice/*` on the Expo dev server to `127.0.0.1:8793`, so the public URL is:

```
EXPO_PUBLIC_STT_URL=https://yl0nisu-anonymous-8081.exp.direct/voice
```

- **Expo Go / local Metro:** put that line in `.env.local` (gitignored), then restart Metro with `npx expo start --tunnel -c`. `EXPO_PUBLIC_*` values are baked into the JS bundle when it's built.
- **EAS builds:** EAS doesn't upload `.env.local` (it's gitignored). That's why `eas.json` sets this URL under `ios.env` for the `development`, `development-simulator` and `preview` profiles. Android profiles are unchanged.
- **`production` (TestFlight/App Store) does *not* set a voice URL yet.** A store build would fall back to `127.0.0.1` and Zippy would show a network error. Before a TestFlight build that should have voice, add a **permanent HTTPS** voice endpoint to `build.production.env.EXPO_PUBLIC_STT_URL` in `eas.json`, or use an EAS environment variable. The `exp.direct` tunnel only works while `npx expo start --tunnel` and the 8793 pipeline are running on this box, so it isn't fit for a store build.
- The tutorial videos no longer depend on it: the 12 catalogue shorts are bundled (v1.3.2). `EXPO_PUBLIC_TUTORIAL_BASE_URL` (default: the same tunnel, `…/tutorial`) is only the fallback and the source of `manifest.json` / new remote-only shorts.
- In Expo Go, the microphone prompt shows Expo Go's text. In a real build, it shows FIRSTgo's string.

## 4. `eas.json` build profiles

| Profile | iOS | Android |
|---|---|---|
| `development` | Debug, internal distribution (ad hoc, registered devices), voice URL = tunnel | debug APK |
| `development-simulator` | Same, but an iOS Simulator `.app` (no Apple signing) | — |
| `preview` | Release, internal distribution = **ad hoc** (registered devices), voice URL = tunnel | release APK |
| `production` | App Store build, `autoIncrement` build number | Play AAB, `autoIncrement` versionCode |

`expo-dev-client` isn't installed, so `developmentClient` isn't set. The `development` build is a plain Debug build that loads JS from Metro. If you want the dev-client launcher, run `npx expo install expo-dev-client` and add `"developmentClient": true` to `development`.

`submit.production.ios` is empty on purpose (no account details in the repo).

---

## 5. How to test and build

All `eas` commands run as `npx eas-cli@latest …`. None of them needs a Mac.

### 5a. Expo Go on an iPhone (fastest, no Apple account)
Needs: an iPhone with Expo Go from the App Store, and Expo Go must support SDK 58.
```bash
npm install
# for voice on the phone: add EXPO_PUBLIC_STT_URL=https://yl0nisu-anonymous-8081.exp.direct/voice to .env.local
npx expo start --tunnel -c       # scan the QR with the iPhone Camera app → opens in Expo Go
```
- All of the app's native modules (camera, audio, video, clipboard, haptics, image-picker, secure-store, svg, reanimated…) are included in Expo Go, so the whole app runs there.
- Expo Go shows **its own** permission text, icon and splash. Check FIRSTgo's in a real build.
- If the App Store Expo Go has moved to a newer SDK, use the simulator or ad hoc build below.

### 5b. EAS Simulator build
Needs: an **Expo account** (free), or an `EXPO_TOKEN`. No Apple account needed. To run it you need a Mac with Xcode's Simulator.
```bash
npx eas-cli@latest login                     # or: export EXPO_TOKEN=<token>  (never commit it)
npx eas-cli@latest init                      # one time: creates/links the EAS project
#   app.config.js is dynamic, so add the printed id to app.json as
#   "extra": { "eas": { "projectId": "<id>" } }  and commit it
npx eas-cli@latest build -p ios --profile development-simulator
```
When it finishes, EAS prints a build page URL. Download the `.tar.gz` and drag the `.app` onto a running Simulator, or run `npx eas-cli@latest build:run -p ios --latest` on a Mac.

### 5c. Ad hoc build for test iPhones (no App Store)
Needs: Expo account, **Apple Developer Program** membership (paid, $99/yr, the bank's organisation account), the **Apple ID** email of someone on that team (Admin or App Manager), the **Team ID**, and each tester's iPhone registered by **UDID**.
```bash
npx eas-cli@latest device:create             # makes a link; open it on each tester's iPhone to register its UDID
npx eas-cli@latest build -p ios --profile preview
#   first time: answer "Log in to your Apple account? yes". EAS creates the distribution
#   certificate and the ad hoc provisioning profile and stores them on EAS.
```
Install it from the QR code or link EAS prints. If you add a new iPhone, run `device:create` again and rebuild. The profile has to include the new UDID.

After the first interactive run, credentials live on EAS. Later builds can run with `--non-interactive` (with `EXPO_TOKEN` set).

### 5d. TestFlight / App Store
Needs everything in 5c (except UDIDs), plus **App Store Connect** access and an app record for `com.idfcfirst.firstgo.dealer`. EAS can create the record on the first submit. Once it exists, its numeric **Apple ID** is the `ascAppId`.

Before you build: set a permanent HTTPS voice URL for `production` (section 3).
```bash
npx eas-cli@latest build  -p ios --profile production
npx eas-cli@latest submit -p ios --profile production --latest   # uploads to App Store Connect → TestFlight
```
On the first submit, either answer the prompts or fill in `submit.production.ios` locally (don't commit real values):
```jsonc
"submit": { "production": { "ios": {
  "appleId": "you@example.com",   // Apple ID email (placeholder)
  "ascAppId": "1234567890",       // App Store Connect → App Information → Apple ID (placeholder)
  "appleTeamId": "ABCDE12345"     // developer.apple.com → Membership → Team ID (placeholder)
} } }
```
To build and submit without anyone at the keyboard (CI), create an **App Store Connect API key** (`.p8`, Key ID, Issuer ID) and add it with `npx eas-cli@latest credentials -p ios`. Don't use an Apple ID password for that. Never commit `.p8` / `.p12` files (they're in `.gitignore`).

After Apple processes the upload (usually 10–30 minutes), add internal testers in App Store Connect → TestFlight. External testers need a short Beta App Review first.

### 5e. Local Xcode build (on a Mac)
Needs: Xcode 16+, CocoaPods, Node, and an Apple team (a free personal team is enough to run it on your own phone for 7 days).
```bash
npm install
npx expo prebuild -p ios --clean   # regenerates ios/ from app.json and the plugins
cd ios && pod install && cd ..
open ios/FIRSTgo.xcworkspace       # the .xcworkspace, not the .xcodeproj
```
In Xcode, open the **FIRSTgo** target → *Signing & Capabilities*, pick your **Team**, and keep the bundle id `com.idfcfirst.firstgo.dealer`. Pick a device or Simulator and press Run. For Debug, start Metro first (`npx expo start`). Or run `npx expo run:ios --device` to do it all in one step.

**`ios/` and `android/` are generated and gitignored** (Continuous Native Generation). Never edit them by hand or commit them. Put native changes in `app.json` or a config plugin.

---

## 6. Test logins (mock backend)
The full tables are in [README.md → Test credentials](README.md#test-credentials). The short version:
- **Dealer:** any 10-digit mobile starting with 6–9. **OTP `123456`.** Ends `1111` = multi-brand (TA), `2222` = Maruti sub-dealer (no TA/INF), `3333` = Tata CV (Inventory Funding), `0000` = not registered, `9999` = network error. Any other number = Hero two-wheeler dealer (TA).
- **Customer:** ends `5555` = KYC on file, `6666` = mandate on file, `7777` = both, `0000` = no offer, `9999` = network error. Consent OTP: any 6 digits except `000000`.
- A UPI ID starting with `fail` declines the mandate. Home → avatar → Developer toggles the rollout phase.

## 7. What Gaurav needs to send us

| To get… | Send |
|---|---|
| A **Simulator** build | An **Expo account** login (or invite our account to the Expo organisation), **or** an `EXPO_TOKEN` (expo.dev → Account settings → Access tokens). Share the token privately, never in chat logs or the repo. |
| An **installable iPhone build** (ad hoc) | The above, plus: an active **Apple Developer Program** membership ($99/yr, ideally the bank's organisation account), the **Apple ID email** of a team member with Admin or App Manager role (they'll need to approve a 2FA code during the first build), the **Team ID**, and the **UDID** of each test iPhone (or testers open the `device:create` link themselves) |
| A **TestFlight** build | All of the above, plus **App Store Connect** access (App Manager role) or an App Store Connect **API key** (.p8 + Key ID + Issuer ID), and the **ascAppId** if the app record already exists. Also a **permanent HTTPS voice server URL** if Zippy should work in that build. |

## 8. Verification (Linux, no Xcode)
```bash
npx tsc --noEmit                                               # pass
npm run test:voice                                             # 81/81 pass
npx expo export -p ios --output-dir /tmp/firstgo-export-ios    # pass (Hermes bundle)
# Prebuild check in a throwaway copy (never in the working tree):
git archive HEAD | tar -x -C /tmp/firstgo-ios-prebuild
ln -s "$PWD/node_modules" /tmp/firstgo-ios-prebuild/node_modules
(cd /tmp/firstgo-ios-prebuild && npx expo prebuild -p ios --no-install)
# Expected Info.plist: CFBundleShortVersionString 1.4.2, CFBundleVersion 1, camera / microphone / photo strings,
# no speech-recognition / location / Face ID strings, empty UIBackgroundModes, ATS default.
# project.pbxproj: PRODUCT_BUNDLE_IDENTIFIER com.idfcfirst.firstgo.dealer, TARGETED_DEVICE_FAMILY 1,
# IPHONEOS_DEPLOYMENT_TARGET 16.4. AppIcon: one 1024×1024 image.
rm -rf /tmp/firstgo-ios-prebuild
```
The `.ipa` itself has to come from EAS or a Mac.
