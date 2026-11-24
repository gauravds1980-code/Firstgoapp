# FIRSTgo v1.2.3 — notes

Version: `app.json` → `version` 1.2.3, `android.versionCode` 6 (`app.config.js` only overrides the name; application id unchanged).

## 1. Close ✕ placement (`src/components/assistant/ZippyBubble.tsx`)

- The badge now sits **beside** Zippy, not on the hood/face:
  - Inner side of the screen: left of Zippy when snapped right, right of Zippy when snapped left, so the screen edge never clips it (and it stays visible while Zippy peeks behind the edge).
  - Vertically centred on the body. With the vehicle mount it centres on the rider (`riderCenterY()` exported from `ZippyRide.tsx`), not the wheels.
  - 8dp gap from the figure, plus the vehicle overhang (`rideOverhang()`) when riding, so it is clear of the hood, the face and the vehicle.
- 26dp visual, `hitSlop` 10 → 46dp tap target. `accessibilityRole="button"`, `accessibilityLabel="Close Zippy"`, hint "Docks the assistant to the header. Tap it there to bring it back".
- Android hit testing: Android does not deliver touches to children outside their parent's bounds, so the overlay box is now widened symmetrically (`SIDE_EXT` each side, `V_EXT` top/bottom) with `pointerEvents="box-none"` and `overflow: 'visible'`. The character sits in an inner SIZE×SIZE stage at the same screen position as before. Because the widening is symmetric, the scale origin and all x/y/peek/dock maths are unchanged.
- Help/tip balloon: pushed out past the badge column (`tipInset`) so the Zippy ✕ never overlaps the tip or the face. The tip keeps its own "Dismiss tip" ✕.
- Docked states: the ✕ is rendered only while floating. The 36dp header head still has no ✕ (tap undocks), and the 52dp figure in the assistant sheet keeps the sheet's own separate Close button. Dock behaviour, storage key (`firstgo.zippy.docked`) and persisted state are unchanged.
- Known, not changed: the tip balloon itself (~236dp wide) still sits outside the overlay's bounds, as it did in v1.2.2, so tapping it on Android may not register. The ✕ and the character are inside the bounds.

## 2. Home hero title (`src/screens/HomeScreen.tsx`)

- Removed the "START A" overline and the "Pre-Qualified … Journey" split. The hero now has one `h1` (`accessibilityRole="header"`):
  - twoWheeler → "Start a pre-qualified two-wheeler loan"
  - car → "Start a pre-qualified car loan"
  - cv → "Start a pre-qualified commercial vehicle loan"
- "used" is added ("Start a pre-qualified used car loan") only when `USED_VEHICLES_ENABLED` is on and the condition is used. When the flag is off, new/used is never mentioned.

## 3. Home cross-sell placeholder

- Removed the dashed "Cross-sell shelf / coming in MVP 5" block from dealer Home. The unused `phase` was dropped from Home's `useApp()` destructure. The phase toggle is still in Profile → Developer.

## Android Zippy render check (quick, no artwork changes)

`ZippyCharacter.tsx` is RN-safe as is, so the artwork is untouched:
- No SVG filters (`fe*`) and no `<Mask>`.
- Gradient and clip ids come from `useId()` sanitised with `/[^a-zA-Z0-9_-]/g` (the `zg…` prefix), so there are no colon ids in `url(#…)`.
- Solid body and face paths with Radial/Linear gradients and one `ClipPath` (supported by react-native-svg 15). The animated eyes and mouth are plain Views.
- The `overflow: 'hidden'` is only on the talking-mouth View. Nothing clips the figure. The overlay is `overflow: 'visible'`.
- Conclusion: the "can't see Zippy" report matches old screenshots, not a render bug.

## Verify

- `npx tsc --noEmit` passes.
- `npx expo lint` couldn't run: the repo has no ESLint setup, and the command tried to install and configure one. That side effect was reverted (`package.json` and the lockfile restored, `eslint.config.js` removed, `npm ci` run), so no lint result.
- Not run on a device or simulator (Metro/build out of scope).
