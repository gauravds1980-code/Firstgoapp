import { commandUrl, isVoiceConfigured, streamUrl, STT_PROVIDER, STT_TIMEOUT_MS, VOICE_STREAMING, type SttProviderName } from './config';
import {
  VoiceError, type CommandContext, type CommandResponse, type CommandStatus, type IntentCandidate, type NormalizedField,
  type VoiceAction, type VoiceReference,
} from './types';

export interface SttProvider {
  name: SttProviderName;
  /** Send one recorded command (base64 audio) and get transcript + matched intent back. */
  command(audioBase64: string, mimeType: string, ctx?: CommandContext): Promise<CommandResponse>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const STATUSES: readonly CommandStatus[] = ['ok', 'clarify', 'retry', 'reprompt'];

/** Numbers (tenure months, asset values) arrive as numbers or strings; keep them as strings. */
const strOrNum = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);

/** `{ id, kind, label, value? }` of an on-screen chip (candidate.option / action select). */
function parseOption(v: unknown): IntentCandidate['option'] | undefined {
  if (!isObj(v)) return undefined;
  const id = strOrNum(v.id);
  const label = str(v.label);
  if (!id || !label) return undefined;
  const value = strOrNum(v.value);
  return { id, kind: str(v.kind) ?? 'vehicle_model', label, ...(value !== undefined ? { value } : {}) };
}

function parseCandidates(v: unknown): IntentCandidate[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isObj).filter((c) => typeof c.intent === 'string').map((c): IntentCandidate => {
    const option = parseOption(c.option);
    return {
      intent: String(c.intent), phrase: str(c.phrase) ?? '', score: typeof c.score === 'number' ? c.score : 0,
      ...(option ? { option } : {}),
    };
  });
  return out.length ? out : undefined;
}

/** Values may arrive as numbers (amounts); keep everything as strings. OTP values are never logged. */
function parseFields(v: unknown): NormalizedField[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isObj).filter((f) => typeof f.type === 'string').map((f): NormalizedField => ({
    type: String(f.type),
    value: typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : '',
    valid: f.valid === true,
    display: typeof f.display === 'string' || typeof f.display === 'number' ? String(f.display) : '',
    ...(str(f.readBack) ? { readBack: str(f.readBack) } : {}),
    ...(str(f.raw) ? { raw: str(f.raw) } : {}),
    ...(str(f.error) ? { error: str(f.error) } : {}),
  }));
  return out.length ? out : undefined;
}

function parseReference(v: unknown): VoiceReference | undefined {
  if (!isObj(v)) return undefined;
  return {
    resolved: v.resolved === true,
    ...(str(v.type) ? { type: str(v.type) } : {}),
    ...(typeof v.value === 'string' || typeof v.value === 'number' ? { value: String(v.value) } : {}),
  };
}

function parseAction(v: unknown): VoiceAction {
  if (!isObj(v)) return { type: 'none' };
  if (v.type === 'navigate' && typeof v.route === 'string') {
    return { type: 'navigate', route: v.route, ...(typeof v.filter === 'string' ? { filter: v.filter } : {}) };
  }
  if (v.type === 'assistant' && typeof v.action === 'string') {
    const a = v.action;
    if (a === 'help' || a === 'list_commands' || a === 'explain_screen' || a === 'repeat' || a === 'open') return { type: 'assistant', action: a };
  }
  if (v.type === 'select') {
    const o = parseOption(v);
    if (o) return { type: 'select', ...o };
  }
  return { type: 'none' };
}

export function parseResponse(body: unknown): CommandResponse {
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
        ...(strOrNum(slots.assetId) ? { assetId: strOrNum(slots.assetId) } : {}),
        ...(typeof slots.brand === 'string' ? { brand: slots.brand } : {}),
        ...(typeof slots.model === 'string' ? { model: slots.model } : {}),
        // slots.otp is deliberately NOT read: OTP only reaches the draft through a confirmed field fill.
      },
    } : {}),
    ...(STATUSES.includes(b.status as CommandStatus) ? { status: b.status as CommandStatus } : {}),
    ...(parseCandidates(b.candidates) ? { candidates: parseCandidates(b.candidates) } : {}),
    ...(typeof b.normalizedTranscript === 'string' ? { normalizedTranscript: b.normalizedTranscript } : {}),
    ...(parseFields(b.normalizedFields) ? { normalizedFields: parseFields(b.normalizedFields) } : {}),
    ...(parseFields(b.normalizedFieldsDisplay) ? { normalizedFieldsDisplay: parseFields(b.normalizedFieldsDisplay) } : {}),
    ...(typeof b.readBack === 'string' ? { readBack: b.readBack } : {}),
    ...(parseReference(b.reference) ? { reference: parseReference(b.reference) } : {}),
    ...(typeof b.offerKeyboard === 'boolean' ? { offerKeyboard: b.offerKeyboard } : {}),
    ...(typeof b.repromptCount === 'number' ? { repromptCount: b.repromptCount } : {}),
    ...(b.hasOtpField === true ? { hasOtpField: true } : {}),
  };
}

/**
 * Empty transcript → no_speech, EXCEPT when the server found an OTP or any number: OTP transcripts
 * come back masked ("[otp utterance]") and the fields carry the result.
 */
export function checkSpeech(parsed: CommandResponse): CommandResponse {
  const hasFields = !!parsed.hasOtpField || !!parsed.normalizedFields?.length;
  if (!hasFields && (parsed.error === 'no_speech' || !parsed.transcript.trim())) throw new VoiceError('no_speech');
  return parsed;
}

async function postJson(url: string, payload: unknown, ctrl: AbortController): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
}

async function readCommand(res: Response): Promise<CommandResponse> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (res.status === 409) throw new VoiceError('busy');
  if (!res.ok) throw new VoiceError('http', `HTTP ${res.status}`);
  return checkSpeech(parseResponse(body));
}

/**
 * POST `${EXPO_PUBLIC_STT_URL}/command` with `{ audio, mimeType, sessionId, screen, context, expect?, options? }`.
 * STT_TIMEOUT_MS timeout. Network / timeout / non-2xx → VoiceError('network' | 'timeout' | 'http');
 * 409 → 'busy' (Zippy still speaking); empty transcript with no fields → 'no_speech'.
 */
export async function postToCommand(audioBase64: string, mimeType = 'audio/mp4', ctx?: CommandContext): Promise<CommandResponse> {
  if (!isVoiceConfigured()) throw new VoiceError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await postJson(commandUrl(), { audio: audioBase64, mimeType, ...ctx }, ctrl);
    } catch (e) {
      throw new VoiceError(ctrl.signal.aborted ? 'timeout' : 'network', e instanceof Error ? e.message : undefined);
    }
    return await readCommand(res);
  } finally {
    clearTimeout(timer);
  }
}

/** Raw PCM (s16le, 16 kHz, mono) is the only format /stream/{id}/chunk accepts. */
const isPcm = (mimeType: string) => /^audio\/(pcm|l16|x-pcm|s16le)\b/i.test(mimeType);
const STREAM_CHUNK_B64 = 16_000; // ~12 KB of PCM per chunk (a multiple of 4 keeps base64 slices valid)

/**
 * HTTP chunked streaming (EXPO_PUBLIC_VOICE_STREAMING=1 only): start → chunk… → end. PTT release is the
 * endpoint, so `end` is sent as soon as the last chunk is out — no silence wait. Returns the /command shape.
 */
export async function streamCommand(pcmBase64: string, ctx: CommandContext): Promise<CommandResponse> {
  if (!isVoiceConfigured()) throw new VoiceError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  const id = ctx.sessionId;
  try {
    const start = await postJson(streamUrl(id, 'start'), {
      sessionId: id, expect: ctx.expect, screen: ctx.screen, mode: 'ptt',
      ...(ctx.context ? { context: ctx.context } : {}), ...(ctx.options?.length ? { options: ctx.options } : {}),
    }, ctrl);
    if (start.status === 409) throw new VoiceError('busy');
    if (!start.ok) throw new VoiceError('http', `stream start HTTP ${start.status}`);
    for (let i = 0; i < pcmBase64.length; i += STREAM_CHUNK_B64) {
      const r = await postJson(streamUrl(id, 'chunk'), { audioBase64: pcmBase64.slice(i, i + STREAM_CHUNK_B64) }, ctrl);
      if (!r.ok) throw new VoiceError('http', `stream chunk HTTP ${r.status}`);
    }
    return await readCommand(await postJson(streamUrl(id, 'end'), { ...ctx }, ctrl));
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError(ctrl.signal.aborted ? 'timeout' : 'network', e instanceof Error ? e.message : undefined);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whole-clip /command, or streaming when the toggle is on AND the clip is raw PCM. expo-audio records
 * AAC (.m4a) today, so with the current recorder this always takes the whole-clip path; any streaming
 * failure other than 'busy' / 'no_speech' falls back to /command.
 */
async function command(audioBase64: string, mimeType: string, ctx?: CommandContext): Promise<CommandResponse> {
  if (VOICE_STREAMING && ctx && isPcm(mimeType)) {
    try {
      return await streamCommand(audioBase64, ctx);
    } catch (e) {
      if (e instanceof VoiceError && (e.code === 'busy' || e.code === 'no_speech' || e.code === 'not_configured')) throw e;
    }
  }
  return postToCommand(audioBase64, mimeType, ctx);
}

const google: SttProvider = { name: 'google', command };

/** Placeholder so the provider can be swapped later. Not wired to any Sarvam API yet. */
const sarvam: SttProvider = {
  name: 'sarvam',
  command: async () => { throw new VoiceError('provider_not_configured', 'Sarvam voice is not configured yet. Set EXPO_PUBLIC_STT_PROVIDER=google.'); },
};

export function getSttProvider(name: SttProviderName = STT_PROVIDER): SttProvider {
  return name === 'sarvam' ? sarvam : google;
}
