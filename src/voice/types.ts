/** Contract of the STT proxy's POST /command response (see firstgo-stt-proxy/src/server.ts). */

export type VehicleCategory = 'TWO_WHEELER' | 'CAR' | 'CONSUMER_DURABLE' | string;

export interface VoiceSlots {
  customerName?: string;
  vehicle?: string;
  vehicleCategory?: VehicleCategory;
  downPayment?: number;
  tenureMonths?: number;
  mobileNumber?: string;
}

export type AssistantActionName = 'help' | 'list_commands' | 'explain_screen' | 'repeat' | 'open';

export type VoiceAction =
  | { type: 'navigate'; route: string; filter?: string }
  | { type: 'assistant'; action: AssistantActionName }
  | { type: 'none' };

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
}

export type VoiceErrorCode =
  | 'permission_denied'
  | 'not_configured'
  | 'provider_not_configured'
  | 'network'
  | 'timeout'
  | 'http'
  | 'no_speech'
  | 'recording';

export class VoiceError extends Error {
  constructor(public readonly code: VoiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VoiceError';
  }
}

/** Short, dealer-facing copy for each error (shown inside the assistant sheet). */
export function voiceErrorMessage(e: unknown): string {
  const code: VoiceErrorCode = e instanceof VoiceError ? e.code : 'network';
  switch (code) {
    case 'permission_denied': return 'Microphone permission is needed to talk to Zippy. Enable it in Settings.';
    case 'not_configured': return 'Voice is not configured on this build yet.';
    case 'provider_not_configured': return e instanceof VoiceError && e.message !== code ? e.message : 'This voice provider is not configured yet.';
    case 'no_speech': return 'I didn’t catch that. Try again.';
    case 'recording': return 'Couldn’t record just now. Try again.';
    case 'network':
    case 'timeout':
    case 'http':
    default: return 'Could not reach the voice service. Check your connection and try again.';
  }
}
