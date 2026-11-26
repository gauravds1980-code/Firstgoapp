import { Platform } from 'react-native';

/**
 * Where tutorial videos come from (v1.3.2). The 12 catalogue shorts are bundled in the native app
 * (bundledVideos.native.ts, bundledPosters.ts) and play from there first; TUTORIAL_BASE_URL is the
 * fallback, the source of manifest.json, and the only source for new remote-only shorts.
 *  - EXPO_PUBLIC_TUTORIAL_BASE_URL (inlined at build time, like EXPO_PUBLIC_STT_URL, no trailing slash)
 *    overrides it everywhere.
 *  - Web default: same-origin `/tutorial` (public/tutorial), so the web preview never depends on the
 *    Expo tunnel and can read manifest.json without CORS.
 *  - Native default: the public test tunnel (serves /workspace/boom-rn/public/tutorial), fallback only.
 */
const NATIVE_DEFAULT_TUTORIAL_BASE_URL = 'https://yl0nisu-anonymous-8081.exp.direct/tutorial';

function webDefaultBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin && /^https?:\/\//i.test(origin) ? `${origin}/tutorial` : '/tutorial';
}

const ENV_BASE = process.env.EXPO_PUBLIC_TUTORIAL_BASE_URL;

export const TUTORIAL_BASE_URL: string = (
  ENV_BASE !== undefined && ENV_BASE.trim() !== ''
    ? ENV_BASE
    : Platform.OS === 'web' ? webDefaultBase() : NATIVE_DEFAULT_TUTORIAL_BASE_URL
).trim().replace(/\/+$/, '');

/** manifest.json fetch timeout; the built-in list is used if it is slower than this. */
export const MANIFEST_TIMEOUT_MS = 4000;
/** Availability probe (small Range request) timeout. */
export const PROBE_TIMEOUT_MS = 6000;
/** expo-video disk cache for streamed (non-bundled) videos (native). */
export const VIDEO_CACHE_BYTES = 100 * 1024 * 1024;
