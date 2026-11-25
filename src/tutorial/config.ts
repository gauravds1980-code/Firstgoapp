/**
 * Where the tutorial videos stream from (v1.3.0). Nothing is bundled in the app.
 * Override with EXPO_PUBLIC_TUTORIAL_BASE_URL (inlined at build time, like EXPO_PUBLIC_STT_URL), no
 * trailing slash. Default: the public test tunnel, which serves /workspace/boom-rn/public/tutorial.
 */
const DEFAULT_TUTORIAL_BASE_URL = 'https://yl0nisu-anonymous-8081.exp.direct/tutorial';

export const TUTORIAL_BASE_URL: string = (
  process.env.EXPO_PUBLIC_TUTORIAL_BASE_URL !== undefined && process.env.EXPO_PUBLIC_TUTORIAL_BASE_URL.trim() !== ''
    ? process.env.EXPO_PUBLIC_TUTORIAL_BASE_URL
    : DEFAULT_TUTORIAL_BASE_URL
).trim().replace(/\/+$/, '');

/** manifest.json fetch timeout; the built-in list is used if it is slower than this. */
export const MANIFEST_TIMEOUT_MS = 4000;
/** Availability probe (small Range request) timeout. */
export const PROBE_TIMEOUT_MS = 6000;
/** expo-video disk cache for played videos (native). */
export const VIDEO_CACHE_BYTES = 100 * 1024 * 1024;
