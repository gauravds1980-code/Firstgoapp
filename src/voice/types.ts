/** Contract of the STT proxy's POST /command response (see firstgo-stt-proxy/src/server.ts). */

export type VehicleCategory = 'TWO_WHEELER' | 'CAR' | 'CONSUMER_DURABLE' | string;

export interface VoiceSlots {
  customerName?: string;
  vehicle?: string;
  vehicleCategory?: VehicleCategory;
  downPayment?: number;
  tenureMonths?: number;
  mobileNumber?: string;
  /** Catalogue row id picked by voice ("hero-xtreme"); the Asset screen selects that chip. */
  assetId?: string;
  /** Full brand from a voice select ("Hero MotoCorp"); informational. */
  brand?: string;
  /** Model from a voice select ("Xtreme 125R"); used as a fallback match when assetId is missing. */
  model?: string;
  /**
   * Spoken OTP digits, written ONLY by a confirmed voice fill (never parsed from server `slots`).
   * Never display it unmasked and never log it; the OTP screens take it out of the draft on use.
   */
  otp?: string;
}

/** Push-to-talk UI phase shared by the header mic and the voice overlay. */
export type VoiceUiPhase = 'idle' | 'listening' | 'thinking';

/** v1.4.0: what the dealer said, live. `final` once the turn ended; `checking` while Whisper re-checks it. Never OTP digits. */
export type VoiceLive = { text: string; final: boolean; checking: boolean };

export type AssistantActionName = 'help' | 'list_commands' | 'explain_screen' | 'repeat' | 'open';

/** Kind of an on-screen pickable chip. Kept open for forward compatibility. */
export type VoiceOptionKind = 'vehicle_model' | 'variant' | 'colour' | 'tenure' | 'emi' | (string & {});

/** One chip the dealer can tap on the focused screen, sent with POST /command as `options`. */
export interface VoiceOption {
  id: string;
  kind: VoiceOptionKind;
  /** "Hero Xtreme 125R", "24 months", … */
  label: string;
  brand?: string;
  model?: string;
  variant?: string;
  /** Asset id, tenure months, etc. */
  value?: string;
}

/** Server-picked chip for SELECT_VEHICLE_MODEL / SELECT_OPTION. */
export interface SelectAction { type: 'select'; kind: VoiceOptionKind; id: string; label: string; value?: string }

export type VoiceAction =
  | { type: 'navigate'; route: string; filter?: string }
  | { type: 'assistant'; action: AssistantActionName }
  | SelectAction
  | { type: 'none' };

/** How sure the server is about this utterance (local pipeline 8793). Absent on older servers = 'ok'. */
export type CommandStatus = 'ok' | 'clarify' | 'retry' | 'reprompt';

/** One of the top intents when the server wants the dealer to pick ("Did you mean…?"). */
export interface IntentCandidate {
  intent: string;
  phrase: string;
  score: number;
  /** Present when the candidate is an on-screen chip ("Did you mean Xtreme 125R or Xtreme 160R?"). */
  option?: { id: string; kind: VoiceOptionKind; label: string; value?: string };
}

/** PHONE / AMOUNT / OTP / DIGITS from the server; kept open for forward compatibility. */
export type NormalizedFieldType = 'PHONE' | 'AMOUNT' | 'OTP' | 'DIGITS' | (string & {});

/**
 * A spoken number the server normalized. In `normalizedFields` an OTP `value` is the REAL digits
 * (used only to fill on Confirm — never shown, never logged). `normalizedFieldsDisplay` carries the
 * same rows with OTP already masked; the UI always renders that copy.
 */
export interface NormalizedField {
  type: NormalizedFieldType;
  value: string;
  valid: boolean;
  display: string;
  readBack?: string;
  raw?: string;
  error?: string;
}

/** "That one" / "the same number" style reference the server resolved against the screen. */
export interface VoiceReference { resolved: boolean; type?: string; value?: string }

/** What the current screen expects the dealer to say (sent with /command as `expect`). */
export type VoiceExpect = 'otp' | 'phone' | 'digits' | 'amount';

/** Extra request fields for POST /command (and the streaming start call). */
export interface CommandContext {
  sessionId: string;
  screen?: string;
  expect?: VoiceExpect;
  context?: { route?: string };
  /** Chips the dealer can tap on the focused screen (vehicle models, tenures, …). */
  options?: VoiceOption[];
}

export interface CommandResponse {
  transcript: string;
  confidence: number;
  languageCode?: string;
  error?: string;
  intent: string;
  score: number;
  matchedPhrase: string | null;
  action: VoiceAction;
  slots?: VoiceSlots;
  /** Local pipeline (8793) extras. Piper WAV is already synthesized for the spoken reply. */
  engine?: string;
  method?: string;
  responseText?: string;
  audioUrl?: string;
  audioBase64?: string;
  audioDurationSec?: number;
  /** v1.2.6 contract (all optional, backward compatible). */
  status?: CommandStatus;
  candidates?: IntentCandidate[];
  normalizedTranscript?: string;
  normalizedFields?: NormalizedField[];
  normalizedFieldsDisplay?: NormalizedField[];
  /** Already OTP-safe ("OTP captured, six digits"). */
  readBack?: string;
  reference?: VoiceReference;
  offerKeyboard?: boolean;
  repromptCount?: number;
  hasOtpField?: boolean;
  /** Older servers name the match method `matchMethod`; parseResponse copies it into `method` too. */
  matchMethod?: string;
  /** v1.2.7 auto-act contract (all optional). true = the server is sure enough to act without Confirm. */
  autoExecute?: boolean;
  confidenceBand?: ConfidenceBand;
  /** 'option' | 'semantic' | 'keyword_exact' | 'field:PHONE' | 'destructive' | … */
  autoReason?: string;
  /** v1.4.0: which matcher decided — 'keyword' | 'fuzzy' (device) | 'labse' | 'keyword_timeout' (server). */
  matcher?: string;
}

/** How the server banded this command's confidence (v1.2.7). */
export type ConfidenceBand = 'auto' | 'confirm' | 'clarify' | 'retry' | 'reprompt';

export type VoiceErrorCode =
  | 'permission_denied'
  | 'not_configured'
  | 'provider_not_configured'
  | 'network'
  | 'timeout'
  | 'http'
  | 'no_speech'
  | 'recording'
  /** HTTP 409: the server is still reading out the previous reply. */
  | 'busy';

export class VoiceError extends Error {
  constructor(public readonly code: VoiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VoiceError';
  }
}

/** Short, dealer-facing copy for each error (shown as a VoiceHost banner). */
export function voiceErrorMessage(e: unknown): string {
  const code: VoiceErrorCode = e instanceof VoiceError ? e.code : 'network';
  switch (code) {
    case 'permission_denied': return 'Microphone permission is needed for voice commands. Enable it in Settings.';
    case 'not_configured': return 'Voice is not configured on this build yet.';
    case 'provider_not_configured': return e instanceof VoiceError && e.message !== code ? e.message : 'This voice provider is not configured yet.';
    case 'no_speech': return 'I didn’t catch that. Try again.';
    case 'recording': return 'Couldn’t record just now. Try again.';
    case 'busy': return 'Still speaking. Wait until the read-out finishes, then hold the mic.';
    case 'network':
    case 'timeout':
    case 'http':
    default: return 'Could not reach the voice service. Check your connection and try again.';
  }
}
