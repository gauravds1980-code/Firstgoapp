/**
 * Tester-only UI (demo legends, "Example data" chips, simulate buttons, the rollout-phase panel…).
 * ON in development builds (`__DEV__`), OFF in release builds unless the build sets
 * EXPO_PUBLIC_SHOW_DEV_UI=1 (e.g. an internal QA build). Release APK / IPA: dealers never see it.
 */
export const SHOW_DEV_UI: boolean = __DEV__ || process.env.EXPO_PUBLIC_SHOW_DEV_UI === '1';
