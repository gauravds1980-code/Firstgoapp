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
  /** v1.4.5: Esign hands-off — verify the drafted `otp` at once (set only for exactly 6 digits on the Esign OTP step). */
  otpSubmit?: boolean;
  /** v1.4.5: Asset loan-amount slider value set by voice (SET_LOAN_AMOUNT). */
  loanAmount?: number;
  /** v1.4.5: TA repay amount / "repay the full outstanding" (TA_REPAY; the TaInf repay sheet reads them). */
  repayAmount?: number;
  repayAll?: boolean;
  /** v1.4.5: a customer row picked by name (RcPendency: the loan number of the row to open). */
  customerLan?: string;
  /** v1.4.5 S2: enhance sheet new limit / reason chip id (+ go on to the reason step at once). */
  enhanceAmount?: number;
  enhanceReasonId?: string;
  enhanceAdvance?: boolean;
  /** v1.4.5 S2: TA drawdown amount (+ go on to the confirm step at once). */
  drawdownAmount?: number;
  drawdownAdvance?: boolean;
  /** v1.4.5 S2: RC number for the open RC entry sheet (storage form, MH12BC1260). */
  rcNumber?: string;
  /** v1.4.5 S2: mobile number filled by voice: send the OTP after the debounce. */
  sendOtp?: boolean;
}

/** Push-to-talk UI phase shared by the header mic and the voice overlay. */
export type VoiceUiPhase = 'idle' | 'listening' | 'thinking';

/** v1.4.0: what the dealer said, live. `final` once the turn ended; `checking` while Whisper re-checks it. Never OTP digits. */
export type VoiceLive = {
  text: string; final: boolean; checking: boolean;
  /** v1.4.2: who produced the words (live transcript chips): the phone recognizer, the server (Whisper / text), or typed. */
  source?: 'device' | 'server' | 'typed';
  /** v1.4.2: the turn these words belong to (the live transcript keeps one dealer line per turn). */
  turn?: number;
};

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
  /** v1.4.5 customer rows (kind 'customer', CONTRACT.md 2.2): name, loan number, vehicle, RC status / reg no. */
  name?: string;
  loanNo?: string;
  lan?: string;
  vehicle?: string;
  status?: string;
  regNo?: string;
}

/** Server-picked chip for SELECT_VEHICLE_MODEL / SELECT_OPTION. */
export interface SelectAction {
  type: 'select'; kind: VoiceOptionKind; id: string; label: string; value?: string;
  /** v1.4.5 S2: field Undo value, "go on to the next step now", the reason chip said with an enhance amount. */
  previous?: string; advance?: boolean; reason?: ReasonRef;
}

/** v1.4.5 S2.0: the button voice ADVANCE presses on the current step (sent as `context.cta`). */
export interface StepCta { id: string; label: string; destructive?: boolean; enabled?: boolean; hint?: string }

/** v1.4.5 S2: an enhance-sheet reason chip carried by ENHANCE_TA_LIMIT ({id, kind:'reason', label, value}). */
export interface ReasonRef { id: string; kind: string; label: string; value?: string }

export type VoiceAction =
  | { type: 'navigate'; route: string; filter?: string; sheet?: string; amount?: number; full?: boolean; reason?: ReasonRef; customerName?: string }
  /** v1.4.5 S2.2 ADVANCE: press the current step's CTA (`confirmed` = the spoken yes already happened). */
  | { type: 'advance'; route?: string; sheet?: string; step?: string; cta?: string; destructive?: boolean; confirmed?: boolean; reg?: string; customerLan?: string }
  /** v1.4.5 S2.4 / S2.6: fill a field on this screen (RC number, mobile + sendOtp, Esign OTP submit). */
  | { type: 'fill'; field: string; value?: string; display?: string; customerLan?: string; sendOtp?: boolean; submit?: boolean }
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
  /** v1.4.5: the candidate's own action / slots (TA "Repay the full ₹4,50,000" = the full repay sheet). */
  action?: VoiceAction;
  slots?: VoiceSlots;
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

/**
 * v1.4.5: a numeric FIELD the focused screen registers (setVoiceFields), sent with /command as `fields`
 * (CONTRACT.md 2.1). Never a tappable chip. Asset: `loan-amount` (min / max / step / value); TaInf: `ta-repay` (utilised).
 */
export interface VoiceField {
  id: string;
  /** 'reg' = the RC entry sheet's registration number (`value` = what is typed). */
  kind: 'amount' | 'reg';
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Current value (Undo restores it); the typed plate for kind 'reg'. */
  value?: number | string;
  /** Enhance: the current sanctioned limit (min = current + step). */
  current?: number;
  /** TA utilised / outstanding (the most a repay can be). */
  utilised?: number;
  /** Optional EMI read-out ("The EMI is ₹6,471 a month for 24 months."). */
  emi?: number;
  tenure?: number;
}

/** What the current screen expects the dealer to say (sent with /command as `expect`). */
export type VoiceExpect = 'otp' | 'phone' | 'digits' | 'amount' | 'reg';

/** Extra request fields for POST /command (and the streaming start call). */
export interface CommandContext {
  sessionId: string;
  screen?: string;
  expect?: VoiceExpect;
  /** v1.4.5 S2.0: also the open sheet / step / CTA and screen extras (customer, tab, dealerState, …). */
  context?: { route?: string; sheet?: string; step?: string; cta?: StepCta; [k: string]: unknown };
  /** Chips the dealer can tap on the focused screen (vehicle models, tenures, …). */
  options?: VoiceOption[];
  /** v1.4.5: numeric fields on the focused screen (loan amount, TA repay). */
  fields?: VoiceField[];
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
  /** v1.4.5: TA "How much?": send the NEXT turn with this `expect`. */
  expectNext?: VoiceExpect;
  /** v1.4.5: an OTP turn (mask everything). */
  otp?: boolean;
  /** v1.4.5 S2: a destructive step asks a spoken yes; the mobile fill should send the OTP. */
  voiceConfirm?: boolean;
  sendOtp?: boolean;
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
