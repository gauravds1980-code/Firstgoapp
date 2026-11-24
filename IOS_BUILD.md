# FIRSTgo on iOS

FIRSTgo (Expo SDK 58 / React Native 0.88) is iOS-ready. The iOS app uses the same JS bundle, screens, flows and design as the Android APK and the web build. This document covers what changed for iOS and how to test, build and ship it.

---

## 1. What changed for iOS

### `app.json`
| Key | Value |
|---|---|
| `ios.bundleIdentifier` | `com.idfcfirst.firstgo.dealer` (Android stays `com.idfcfirst.boom.dealer`, see below) |
| `ios.buildNumber` | `"1"` (marketing version stays `1.2.0`) |
| `ios.supportsTablet` | `false` (iPhone only, portrait) |
| `ios.icon` | `./assets/ios-icon.png`: 1024×1024, opaque RGB (no alpha), rendered from `assets/brand/icon.svg`. iOS applies the rounded-corner mask itself. |
| `ios.infoPlist.NSCameraUsageDescription` | QR scan + RC photo |
| `ios.infoPlist.NSPhotoLibraryUsageDescription` | RC upload |
| `ios.infoPlist.ITSAppUsesNonExemptEncryption` | `false` (only standard HTTPS/OS crypto, so no export-compliance prompt in App Store Connect) |

- **No `NSFaceIDUsageDescription`.** The app doesn't use biometrics: there's no `expo-local-authentication` and no SecureStore `requireAuthentication`. By default the `expo-secure-store` plugin adds a Face ID string anyway. It's now configured with `faceIDPermission: false` so App Review doesn't see an unused privacy string.
- **No microphone permission.** Both the camera and image-picker plugins already set `microphonePermission: false`.
- **Matching permission strings.** The `expo-camera` and `expo-image-picker` plugins now use exactly the same camera string as `ios.infoPlist`. Before, they differed and whichever plugin ran last won.
- **Splash.** Unchanged. The existing `expo-splash-screen` plugin config (`assets/splash-icon.png`, which matches `assets/brand/splash.svg`, on `#9D1D27`) produces the iOS `SplashScreen.storyboard`, logo image set and background colour.
- **`android.package` is `com.idfcfirst.boom.dealer`.** That's the applicationId/namespace the shipped APK was built with (from the original `android/app/build.gradle`). Pinning it means EAS and prebuild Android builds keep updating installed copies; without it, prebuild would ask for or generate a different ID. **The iOS and Android IDs differ on purpose:** iOS is a new app, so it uses `com.idfcfirst.firstgo.dealer` with no conflict. The Android ID can't be changed without users uninstalling and reinstalling (and on Play it would be a new listing), so keep it as is.

### `eas.json` (new)
| Profile | iOS | Android |
|---|---|---|
| `development` | Debug build, internal distribution (ad hoc) | debug APK |
| `development-simulator` | same, but an iOS Simulator `.app` (no Apple signing needed) | — |
| `preview` | Release build, internal distribution = **ad hoc** (registered devices only) | release **APK** |
| `production` | App Store build, `autoIncrement` build number | Play AAB, `autoIncrement` versionCode |

`appVersionSource` is `remote`: EAS stores and increments `buildNumber`/`versionCode` on its servers. The first build seeds them from `app.json` (iOS `1`, Android `3`). This is needed because the config is dynamic (`app.config.js`), so EAS can't write the incremented numbers back to a file.

**`expo-dev-client` is not installed**, so `developmentClient` is deliberately **not** set. The `development` profile is a plain Debug build that loads JS from Metro. To get the Expo dev-client launcher UI, run `npx expo install expo-dev-client` and add `"developmentClient": true` to the `development` profile.

### Code (cross-platform fixes; Android and web behaviour unchanged)
| File | iOS issue | Fix |
|---|---|---|
| `src/screens/HomeScreen.tsx` | iOS doesn't draw `shadow*` on views with `overflow: 'hidden'`, so the hero card and action tiles lost their shadow | iOS only: the hero shadow moves to a wrapper `View` (the gradient still clips its decorative circles); action tiles don't need clipping, so they use `overflow: 'visible'` on iOS |
| `src/screens/DisbursalScreen.tsx` | Same clipping problem on the "Credited to dealer" card | iOS only: the gold-shimmer layer clips itself and the card keeps its shadow |
| `src/components/Slider.tsx` | Thumb had no `shadowOffset`. The iOS default is `(0, -3)`, so the shadow sat *above* the thumb | iOS only: `shadowOffset {0, 2}` |
| `src/navigation/RootNavigator.tsx` | `presentation: 'fullScreenModal'` is a real native modal on iOS. It covers the RN root, so the global **Zippy** bubble disappeared on Scan QR (on Android it shows). It also had no swipe-to-dismiss | iOS only: Scan QR is a `card` that slides up from the bottom and dismisses with a swipe down (`gestureDirection: 'vertical'`). Android keeps `fullScreenModal` |
| `src/navigation/useSwipeBack.ts` (new), `FaceKycScreen.tsx`, `MandateScreen.tsx` | The iOS edge swipe-back could pull the dealer off the auto-advancing "KYC / mandate already on file" waiver animation halfway through | `gestureEnabled: false` only while the waiver beat is showing. The normal KYC/mandate screens still swipe back. Disbursal already had `gestureEnabled: false`. Android hardware back is unaffected (`predictiveBackGestureEnabled: false`) |
| `src/screens/RcPendencyScreen.tsx` | iOS never shows the camera prompt again after a denial, so "Take photo" failed silently | iOS only: if the camera is denied and can't be asked again, an alert offers **Open Settings** (`Linking.openSettings()`) |

**Audited and already correct (no change needed):**
- **Haptics:** `src/utils/haptics.ts` uses `expo-haptics`, guarded for web.
- **Back handling:** no `BackHandler` usage.
- **Toasts:** no `ToastAndroid` usage.
- **Keyboard:** `KeyboardAvoidingView` uses `padding` on iOS and `undefined` on Android, in `Screen`, `AuthScaffold` and `Sheet`.
- **Safe areas:** every screen, sheet, sticky CTA bar, the Scan QR FAB and the Zippy bubble use `useSafeAreaInsets()`. Zippy's limits use `insets.top` (notch / Dynamic Island) and `insets.bottom` (home indicator).
- **Camera permission:** the QR scanner uses `useCameraPermissions`. Denied shows **Open Settings** (`Linking.openSettings`).
- **Image library:** uses PHPicker on iOS 14+, so no extra permission prompt.
- **Shadows:** the theme `elevation` tokens already pair `elevation` with full `shadowColor/Offset/Opacity/Radius`.
- **Date range:** the custom date range is a pure-JS stepper sheet, with no native date picker.
- **OTP:** has `textContentType="oneTimeCode"`, so iOS SMS-code autofill works.
- **Fonts:** Inter loads through `expo-font`, and the weight is carried by `fontFamily` (no `fontWeight` anywhere), so it renders the same on iOS.
- **StatusBar:** `expo-status-bar` uses `style="dark"` on every screen, the same as Android, which is also edge-to-edge (SDK 58). The scanner (black) and login hero (maroon) show dark status-bar icons on both platforms. That's an existing design choice, kept for parity.

### Native project (`ios/`)
`npx expo prebuild -p ios --no-install` generated `ios/` (`FIRSTgo.xcodeproj`, `Podfile`, `Info.plist`, `AppIcon`, splash storyboard). It targets iPhone only (`TARGETED_DEVICE_FAMILY = 1`) with deployment target iOS 16.4.

**`/ios` stays in `.gitignore` (Continuous Native Generation).** `app.json` plus the config plugins are the source of truth. EAS Build and `npx expo prebuild` regenerate `ios/` from them every time, so a committed `ios/` would only go stale and conflict. Never hand-edit `ios/`; put any native change in `app.json` or a config plugin. The same applies to `/android`. Its only config change is pinning `android.package` to the existing ID.

**`public/` build artifacts were removed.** `public/FIRSTgo.apk` (22 MB) and `public/firstgo-source.zip` were left over from a temporary download server. Expo copies everything in `public/` into every `expo export` output, including the iOS export, so they were deleted and `public/*.apk` / `public/*.zip` are now in `.gitignore`. Prebuild also rewrote the `ios`/`android` npm scripts to `expo run:*`. That was reverted so `npm run ios` keeps opening Expo Go as before.

---

## 2. Quick test on an iPhone: Expo Go (no Apple account needed)
```bash
npm install
npx expo start --tunnel      # scan the QR with the iPhone Camera app → opens in Expo Go
```
Caveats:
- Expo Go must support **SDK 58**. The App Store Expo Go only runs the latest SDK. If it doesn't match, use a development build (below).
- Every native module in this app (camera, haptics, image-picker, secure-store, linear-gradient, reanimated/worklets, screens, svg, safe-area) is bundled in Expo Go, so the full app works there.
- In Expo Go, **permission prompts show Expo Go's own strings, not ours**, and the app icon and splash aren't FIRSTgo's. Check those in a real build.
- The QR scanner needs a real device. "Simulate successful scan (testing)" works everywhere, including the Simulator.

## 3. Build with EAS (cloud; no Mac needed)
Prerequisites: a free **Expo account**, and for device and App Store builds, an **Apple Developer Program** membership ($99/yr). EAS creates and manages certificates and provisioning profiles when you log in with your Apple ID during the build.

```bash
npx eas-cli@latest login
npx eas-cli@latest init                       # links the project; app.config.js is dynamic, so paste the printed
                                              # extra.eas.projectId into app.json if EAS asks you to

# Simulator build (no Apple account needed):
npx eas-cli@latest build -p ios --profile development-simulator

# Ad hoc build for test iPhones:
npx eas-cli@latest device:create              # register each tester's iPhone UDID (open the link on the phone)
npx eas-cli@latest build -p ios --profile preview
# → install via the QR/link EAS prints. Re-run the build after adding new devices.

# App Store / TestFlight:
npx eas-cli@latest build  -p ios --profile production
npx eas-cli@latest submit -p ios --profile production   # uploads to App Store Connect → TestFlight
```

`submit.production.ios` in `eas.json` is left empty on purpose (no secrets in the repo). Either answer the prompts on the first `eas submit`, or fill it in locally:
```jsonc
"submit": {
  "production": {
    "ios": {
      "appleId": "you@example.com",        // Apple ID email (placeholder)
      "ascAppId": "1234567890",            // App Store Connect → App Information → Apple ID (placeholder)
      "appleTeamId": "ABCDE12345"          // Developer portal → Membership (placeholder)
    }
  }
}
```
For CI, prefer an App Store Connect API key (`eas credentials`) over an Apple ID password.

Android is unchanged: `npx eas-cli@latest build -p android --profile preview` produces an APK.

## 4. Local Xcode build (on a Mac)
Requires Xcode 16+, CocoaPods, and Node.
```bash
npm install
npx expo prebuild -p ios          # (re)generates ios/ from app.json; add --clean after config changes
cd ios && pod install && cd ..
open ios/FIRSTgo.xcworkspace      # the .xcworkspace, not the .xcodeproj
```
In Xcode, open the **FIRSTgo** target → *Signing & Capabilities*, pick your **Team**, and keep the bundle ID `com.idfcfirst.firstgo.dealer`. Choose a device or Simulator and press Run. For a Debug build, start Metro first (`npx expo start`). Alternatively, `npx expo run:ios [--device]` does prebuild, pods and build in one step.

---

## 5. Test logins (mock backend)
The README has no separate credentials section. These rules come from the README and `src/services/auth.ts` / `dealer.ts`:

**Dealer sign-in:** any valid 10-digit mobile starting with 6–9. **OTP is always `123456`.**

| Mobile ending | Result |
|---|---|
| any other, e.g. `9876543210` | Hero two-wheeler dealer (default) |
| `…1111` | Shree Auto Mall: multi-brand, 2W + Car, TA/INF |
| `…2222` | Sai Motors: Maruti sub-dealer, Car only |
| `…0000` | "Not a registered dealer" |
| `…9999` | Network error + retry |

**Customer journey (README demo rules):**
- Customer mobile ending `0000` → no offer; ending `9999` → network error + retry.
- Customer consent OTP: any 6 digits works; `000000` is wrong.
- UPI ID starting with `fail` → mandate declined.
- Rollout phase toggle: Home → avatar (Profile) → *Developer · rollout phase*.

## 6. Verification run (Linux, no Xcode)
```bash
npx tsc --noEmit                                                     # pass
npx expo export -p ios     --output-dir /tmp/firstgo-export-ios      # pass (Hermes bundle)
npx expo export -p android --output-dir /tmp/firstgo-export-android  # pass
npx expo-doctor                                                      # 20/20 checks passed
```
The `.ipa` itself has to be built on EAS or on a Mac.
