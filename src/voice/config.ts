/**
 * Voice config. Only PUBLIC values live here: the proxy URL and an optional provider name.
 * Models and credentials stay on the proxy — never put a Google key in the app bundle.
 *
 * Default backend is the LOCAL pipeline (Whisper + LaBSE + Piper) at port 8793.
 * That server may call Google Speech-to-Text itself as a last-resort fallback; the app
 * must not point at the Google proxy (8792) by default, because that costs money.
 * Spoken replies always use Piper on the local server, never Google TTS.
 */
export type SttProviderName = 'google' | 'sarvam';

/** Local Whisper + LaBSE + Piper stack (firstgo-voice-local). Same /command contract as the Google proxy. */
export const DEFAULT_STT_BASE_URL = 'http://127.0.0.1:8793';

/**
 * Base URL of the FIRSTgo voice proxy, no trailing path (we POST to `${STT_BASE_URL}/command`
 * and `/tts`). Override with EXPO_PUBLIC_STT_URL:
 *   - Local Whisper + LaBSE + Piper (default):  http://127.0.0.1:8793
 *   - Google STT proxy (do not use as the app default — costs money): http://127.0.0.1:8792
 * Empty only if EXPO_PUBLIC_STT_URL is explicitly set to "" (voice then shows "not configured").
 */
export const STT_BASE_URL: string = (
  process.env.EXPO_PUBLIC_STT_URL !== undefined
    ? process.env.EXPO_PUBLIC_STT_URL
    : DEFAULT_STT_BASE_URL
).trim().replace(/\/+$/, '');

const rawProvider = (process.env.EXPO_PUBLIC_STT_PROVIDER ?? 'google').trim().toLowerCase();
/**
 * Client implementation. `google` here just means "HTTP /command proxy" (including the 8793
 * local stack). `sarvam` is a stub. The URL, not this flag, chooses local vs Google-proxy.
 */
export const STT_PROVIDER: SttProviderName = rawProvider === 'sarvam' ? 'sarvam' : 'google';

export const STT_TIMEOUT_MS = 15_000;
/** Presses shorter than this are treated as a tap and never sent (no silent uploads). */
export const PTT_MIN_HOLD_MS = 250;
/** Hard cap on a single push-to-talk recording. */
export const PTT_MAX_HOLD_MS = 15_000;

export const isVoiceConfigured = (): boolean => STT_BASE_URL.length > 0;
export const commandUrl = (): string => `${STT_BASE_URL}/command`;
export const ttsUrl = (): string => `${STT_BASE_URL}/tts`;
