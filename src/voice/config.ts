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

/** Google fallback + Piper synthesis + the Expo tunnel can together take well over 15 s. */
export const STT_TIMEOUT_MS = 45_000;
/** Presses shorter than this are treated as a tap and never sent (no silent uploads). */
export const PTT_MIN_HOLD_MS = 250;
/** Hard cap on a single push-to-talk recording. */
export const PTT_MAX_HOLD_MS = 15_000;

export const isVoiceConfigured = (): boolean => STT_BASE_URL.length > 0;
export const commandUrl = (): string => `${STT_BASE_URL}/command`;
export const ttsUrl = (): string => `${STT_BASE_URL}/tts`;
/** v1.4.2: typed / device-recognised text (alias of /command with a transcript; falls back to /command). */
export const textUrl = (): string => `${STT_BASE_URL}/text`;
/** v1.4.2: fire-and-forget backtest log for turns decided on the device (voiceTurnLog.ts). */
export const logUrl = (): string => `${STT_BASE_URL}/log`;
/** Tells the server the read-out finished (or was stopped) so it accepts the next /command. */
export const ttsDoneUrl = (): string => `${STT_BASE_URL}/tts/done`;

/**
 * EXPO_PUBLIC_VOICE_STREAMING — DEFAULT ON. Server path only: live PCM from the mic is POSTed to
 * /stream/{id}/start|chunk|end while the dealer speaks, and the server's partial text shows live
 * (serverStream.ts). '0' turns it off for the whole build (the Voice settings switch turns it off per
 * device). WebSockets are deliberately not used: the Expo tunnel / Metro proxy strips the Upgrade header.
 * Any streaming failure falls back to the whole-clip POST /command with the same audio as a WAV.
 */
export const VOICE_STREAMING: boolean = (process.env.EXPO_PUBLIC_VOICE_STREAMING ?? '1').trim() !== '0';
/** Server-path streaming keeps at most this much PCM in memory per turn (and never sends more). */
export const STREAM_MAX_MS = 30_000;
/**
 * STREAM_FAST_FINAL (EXPO_PUBLIC_VOICE_STREAM_FAST_FINAL, DEFAULT ON): /stream/{id}/end?fast=1 lets the voice
 * server return its last partial as the final when that partial already covers all the speech (no second
 * decode; never for OTP / digit turns, the server decides). '0' sends fast=0 (always a full final decode).
 * A server that does not know the parameter ignores it.
 */
export const STREAM_FAST_FINAL: boolean = (process.env.EXPO_PUBLIC_VOICE_STREAM_FAST_FINAL ?? '1').trim() !== '0';
/** Target audio per /chunk POST (one in flight at a time; queued audio is coalesced). */
export const STREAM_FLUSH_MS = 200;
