import { commandUrl, isVoiceConfigured, STT_PROVIDER, STT_TIMEOUT_MS, type SttProviderName } from './config';
import { VoiceError, type CommandResponse, type VoiceAction } from './types';

export interface SttProvider {
  name: SttProviderName;
  /** Send one recorded command (base64 audio) and get transcript + matched intent back. */
  command(audioBase64: string, mimeType: string): Promise<CommandResponse>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseAction(v: unknown): VoiceAction {
  if (!isObj(v)) return { type: 'none' };
  if (v.type === 'navigate' && typeof v.route === 'string') {
    return { type: 'navigate', route: v.route, ...(typeof v.filter === 'string' ? { filter: v.filter } : {}) };
  }
  if (v.type === 'assistant' && typeof v.action === 'string') {
    const a = v.action;
    if (a === 'help' || a === 'list_commands' || a === 'explain_screen' || a === 'repeat' || a === 'open') return { type: 'assistant', action: a };
  }
  return { type: 'none' };
}

function parseResponse(body: unknown): CommandResponse {
  const b = isObj(body) ? body : {};
  const slots = isObj(b.slots) ? b.slots : undefined;
  return {
    transcript: typeof b.transcript === 'string' ? b.transcript : '',
    confidence: typeof b.confidence === 'number' ? b.confidence : 0,
    ...(typeof b.languageCode === 'string' ? { languageCode: b.languageCode } : {}),
    ...(typeof b.error === 'string' ? { error: b.error } : {}),
    intent: typeof b.intent === 'string' ? b.intent : 'UNKNOWN',
    score: typeof b.score === 'number' ? b.score : 0,
    matchedPhrase: typeof b.matchedPhrase === 'string' ? b.matchedPhrase : null,
    action: parseAction(b.action),
    ...(typeof b.engine === 'string' ? { engine: b.engine } : {}),
    ...(typeof b.method === 'string' ? { method: b.method } : {}),
    ...(typeof (b.responseText ?? b.response) === 'string' ? { responseText: String(b.responseText ?? b.response) } : {}),
    ...(typeof b.audioUrl === 'string' ? { audioUrl: b.audioUrl } : {}),
    ...(typeof b.audioBase64 === 'string' ? { audioBase64: b.audioBase64 } : {}),
    ...(typeof b.audioDurationSec === 'number' ? { audioDurationSec: b.audioDurationSec } : {}),
    ...(slots ? {
      slots: {
        ...(typeof slots.customerName === 'string' ? { customerName: slots.customerName } : {}),
        ...(typeof slots.vehicle === 'string' ? { vehicle: slots.vehicle } : {}),
        ...(typeof slots.vehicleCategory === 'string' ? { vehicleCategory: slots.vehicleCategory } : {}),
        ...(typeof slots.downPayment === 'number' ? { downPayment: slots.downPayment } : {}),
        ...(typeof slots.tenureMonths === 'number' ? { tenureMonths: slots.tenureMonths } : {}),
        ...(typeof slots.mobileNumber === 'string' ? { mobileNumber: slots.mobileNumber } : {}),
      },
    } : {}),
  };
}

/**
 * POST `${EXPO_PUBLIC_STT_URL}/command` with `{ audio, mimeType }`. 15 s timeout.
 * Network / timeout / non-2xx → VoiceError('network' | 'timeout' | 'http'); empty transcript → 'no_speech'.
 */
export async function postToCommand(audioBase64: string, mimeType = 'audio/mp4'): Promise<CommandResponse> {
  if (!isVoiceConfigured()) throw new VoiceError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(commandUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ audio: audioBase64, mimeType }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new VoiceError(ctrl.signal.aborted ? 'timeout' : 'network', e instanceof Error ? e.message : undefined);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new VoiceError('http', `HTTP ${res.status}`);
  const parsed = parseResponse(body);
  if (parsed.error === 'no_speech' || !parsed.transcript.trim()) throw new VoiceError('no_speech');
  return parsed;
}

const google: SttProvider = { name: 'google', command: postToCommand };

/** Placeholder so the provider can be swapped later. Not wired to any Sarvam API yet. */
const sarvam: SttProvider = {
  name: 'sarvam',
  command: async () => { throw new VoiceError('provider_not_configured', 'Sarvam voice is not configured yet. Set EXPO_PUBLIC_STT_PROVIDER=google.'); },
};

export function getSttProvider(name: SttProviderName = STT_PROVIDER): SttProvider {
  return name === 'sarvam' ? sarvam : google;
}
