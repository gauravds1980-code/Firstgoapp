/**
 * Pure voice helpers (no React Native imports) so they can be unit-tested in plain Node.
 * applyCommand / useVoiceCommand / VoicePreviewSheet build on these.
 *
 * OTP SAFETY: `normalizedFields` holds the real OTP digits (needed to fill on Confirm). Nothing here
 * ever logs them, and every helper that produces display text masks OTP rows.
 */
import type { CommandResponse, IntentCandidate, NormalizedField, VoiceExpect, VoiceSlots } from './types';

/**
 * Client-side fallback when the server sends an intent but no usable `action` (older servers, or a
 * candidate the dealer picked from "Did you mean…?"). Mirrors firstgo-voice-local INTENT_ACTIONS.
 */
export const INTENT_ROUTE: Readonly<Record<string, { route: string; filter?: string }>> = {
  START_QR_JOURNEY: { route: 'ScanQr' },
  SCAN_QR: { route: 'ScanQr' },
  START_MOBILE_JOURNEY: { route: 'SearchMobile' },
  START_NEW_LOAN: { route: 'SearchMobile' },
  SEARCH_CUSTOMER: { route: 'SearchMobile' },
  SEARCH_MOBILE_NUMBER: { route: 'SearchMobile' },
  NEW_TWO_WHEELER_LOAN: { route: 'SearchMobile', filter: 'two_wheeler' },
  NEW_CAR_LOAN: { route: 'SearchMobile', filter: 'car' },
  NEW_CONSUMER_DURABLE_LOAN: { route: 'SearchMobile', filter: 'consumer_durable' },
  GO_HOME: { route: 'Home' },
  OPEN_PORTFOLIO: { route: 'Portfolio' },
  OPEN_PAYOUTS: { route: 'Payouts' },
  OPEN_PROFILE: { route: 'Profile' },
  OPEN_ACTIONS: { route: 'Cases', filter: 'actions' },
  SHOW_PENDING_DISBURSALS: { route: 'Cases', filter: 'pending_disbursal' },
  SHOW_OVERDUE_CASES: { route: 'Cases', filter: 'overdue' },
  SHOW_APPLICATION_STATUS: { route: 'Cases' },
  SHOW_REJECTED_CASES: { route: 'Cases', filter: 'rejected' },
  SHOW_TODAYS_COLLECTIONS: { route: 'Portfolio', filter: 'collections_today' },
  SHOW_INVOICES_TO_CLAIM: { route: 'TaInf' },
  SHOW_RC_PENDENCY: { route: 'RcPendency' },
  START_KYC: { route: 'FaceKyc' },
  START_FACE_KYC: { route: 'FaceKyc' },
  CONFIRM_OFFER: { route: 'Offer', filter: 'confirm' },
  CHANGE_TENURE: { route: 'Offer', filter: 'tenure' },
  CHANGE_DOWN_PAYMENT: { route: 'Offer', filter: 'down_payment' },
  SHOW_EMI: { route: 'Offer', filter: 'emi' },
  START_ESIGN: { route: 'Esign' },
  SETUP_UPI_MANDATE: { route: 'Mandate' },
  UPLOAD_RC: { route: 'Docs', filter: 'rc' },
  TAKE_DELIVERY_PHOTO: { route: 'Docs', filter: 'delivery_photo' },
};

/** Navigate target for a command: the server's action first, else the intent fallback map. */
export function resolveNavTarget(cmd: CommandResponse): { route: string; filter?: string } | null {
  if (cmd.action.type === 'navigate') return { route: cmd.action.route, ...(cmd.action.filter ? { filter: cmd.action.filter } : {}) };
  if (cmd.action.type === 'assistant') return null;
  return INTENT_ROUTE[cmd.intent] ?? null;
}

/** What Confirm should do, before route-availability checks (planCommand adds those). */
export type PlanTarget =
  | { kind: 'navigate'; route: string; filter?: string }
  | { kind: 'assistant' }
  | { kind: 'fill'; fields: NormalizedField[] }
  | { kind: 'none' };

/**
 * clarify / retry / reprompt never get a Confirm until the dealer picks a candidate or types a value
 * (both of which re-stage the command as status 'ok'). Navigation wins over a fill; a navigate that
 * also carried numbers stores them in the draft too.
 */
export function planTarget(cmd: CommandResponse): PlanTarget {
  const status = cmd.status ?? 'ok';
  if (status !== 'ok') return { kind: 'none' };
  if (cmd.action.type === 'assistant' && cmd.intent !== 'UNKNOWN') return { kind: 'assistant' };
  const nav = cmd.intent === 'UNKNOWN' ? null : resolveNavTarget(cmd);
  if (nav) return { kind: 'navigate', ...nav };
  const fields = validFields(cmd);
  if (fields.length) return { kind: 'fill', fields };
  return { kind: 'none' };
}

export const validFields = (cmd: CommandResponse): NormalizedField[] => (cmd.normalizedFields ?? []).filter((f) => f.valid && !!f.value);

export const isOtpCommand = (cmd: CommandResponse): boolean =>
  !!cmd.hasOtpField || (cmd.normalizedFields ?? []).some((f) => f.type === 'OTP') || (cmd.normalizedFieldsDisplay ?? []).some((f) => f.type === 'OTP');

/** "••••" / "••••••". */
export const maskOtp = (len: number): string => '•'.repeat(Math.max(4, Math.min(8, len || 6)));

/** Make one OTP row display-safe no matter which copy it came from. */
function safeRow(f: NormalizedField, digits?: number): NormalizedField {
  if (f.type !== 'OTP') return f;
  const n = digits ?? (/^\d+$/.test(f.value) ? f.value.length : (f.value.match(/•/g)?.length ?? 6));
  const mask = maskOtp(n);
  return { ...f, value: f.value ? mask : '', display: f.value ? mask : (f.display && !/\d/.test(f.display) ? f.display : ''), raw: '[otp]' };
}

/**
 * Rows for the UI: prefer the server's masked `normalizedFieldsDisplay`; fall back to
 * `normalizedFields` with OTP masked here. OTP rows are re-masked either way (belt and braces).
 */
export function displayFields(cmd: CommandResponse): NormalizedField[] {
  const real = cmd.normalizedFields ?? [];
  const src = cmd.normalizedFieldsDisplay?.length ? cmd.normalizedFieldsDisplay : real;
  return src.map((f, i) => safeRow(f, real[i]?.type === 'OTP' && /^\d+$/.test(real[i].value) ? real[i].value.length : undefined));
}

/** Transcript text that is safe to show: never OTP digits. */
export function safeTranscript(cmd: CommandResponse): string {
  if (isOtpCommand(cmd)) return /\d/.test(cmd.transcript) || !cmd.transcript.trim() ? '[otp utterance]' : cmd.transcript;
  return cmd.transcript;
}

const PHONE_RE = /^[6-9]\d{9}$/;
const OTP_RE = /^\d{4,6}$/;

/** Draft slots from the VALID fields of a confirmed command. PHONE → mobileNumber, AMOUNT → downPayment, OTP → otp. */
export function slotsFromFields(fields: NormalizedField[]): VoiceSlots {
  const out: VoiceSlots = {};
  for (const f of fields) {
    if (!f.valid) continue;
    const digits = f.value.replace(/\D/g, '');
    if (f.type === 'PHONE') {
      const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
      if (PHONE_RE.test(ten)) out.mobileNumber = ten;
    } else if (f.type === 'AMOUNT') {
      const n = Number(f.value.replace(/[^\d.]/g, ''));
      if (Number.isFinite(n) && n > 0) out.downPayment = Math.round(n);
    } else if (f.type === 'OTP') {
      if (OTP_RE.test(digits)) out.otp = digits;
    }
  }
  return out;
}

/** Confirm label for a fill. */
export function fillLabel(fields: NormalizedField[]): string {
  const t = fields[0]?.type;
  return t === 'OTP' ? 'Use this OTP' : t === 'AMOUNT' ? 'Use this amount' : 'Use this number';
}

/** Field type for a typed value when the server sent no row to edit. */
export const FIELD_TYPE_FOR_EXPECT: Record<VoiceExpect, NormalizedField['type']> = { otp: 'OTP', phone: 'PHONE', amount: 'AMOUNT', digits: 'DIGITS' };

/** Validate a value the dealer typed instead of saying. Returns a field (valid or with an error). */
export function typedField(type: NormalizedField['type'], text: string): NormalizedField {
  const digits = text.replace(/\D/g, '');
  if (type === 'OTP') {
    const ok = OTP_RE.test(digits);
    return { type, value: digits, valid: ok, display: maskOtp(digits.length), raw: '[otp]', ...(ok ? {} : { error: 'Enter the 4 or 6 digit OTP.' }) };
  }
  if (type === 'PHONE') {
    const ok = PHONE_RE.test(digits);
    return { type, value: digits, valid: ok, display: digits, ...(ok ? {} : { error: 'Enter a 10-digit mobile number starting 6, 7, 8 or 9.' }) };
  }
  if (type === 'AMOUNT') {
    const n = Number(digits);
    const ok = digits.length > 0 && n > 0;
    return { type, value: digits, valid: ok, display: ok ? `₹${n.toLocaleString('en-IN')}` : digits, ...(ok ? {} : { error: 'Enter an amount in rupees.' }) };
  }
  return { type, value: digits, valid: digits.length > 0, display: digits, ...(digits.length ? {} : { error: 'Enter the number.' }) };
}

/**
 * Put a typed value into the command (both the fill copy and the display copy) and re-stage it as
 * status 'ok' when valid. `index` -1 (or past the end) appends a new row of `type`.
 */
export function withTypedValue(cmd: CommandResponse, index: number, type: NormalizedField['type'], text: string): CommandResponse {
  const f = typedField(type, text);
  const real = [...(cmd.normalizedFields ?? [])];
  const shown = [...displayFields(cmd)];
  const i = index >= 0 && index < real.length ? index : real.length;
  real[i] = f;
  shown[i] = safeRow(f);
  return {
    ...cmd,
    normalizedFields: real,
    normalizedFieldsDisplay: shown,
    ...(f.valid ? { status: 'ok' as const } : {}),
    ...(type === 'OTP' ? { hasOtpField: true } : {}),
  };
}

/** Re-stage a clarify command with the candidate the dealer picked (Confirm still required). */
export function withCandidate(cmd: CommandResponse, c: IntentCandidate): CommandResponse {
  const nav = INTENT_ROUTE[c.intent];
  return {
    ...cmd,
    status: 'ok',
    intent: c.intent,
    score: c.score,
    matchedPhrase: c.phrase,
    candidates: undefined,
    action: nav ? { type: 'navigate', route: nav.route, ...(nav.filter ? { filter: nav.filter } : {}) } : { type: 'none' },
  };
}

/** Short button label for a candidate. */
export function candidateLabel(c: IntentCandidate): string {
  if (c.phrase.trim()) return c.phrase.trim().replace(/^./, (ch) => ch.toUpperCase());
  return c.intent.toLowerCase().replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * What the current screen expects the dealer to say, from the route name + params.
 * SearchMobile mirrors its stage into route params so this stays cheap.
 */
export function expectFor(route: string | undefined, params?: unknown): VoiceExpect | undefined {
  if (route === 'DealerOtp') return 'otp';
  if (route === 'SearchMobile') {
    const stage = typeof params === 'object' && params !== null ? (params as { stage?: unknown }).stage : undefined;
    if (stage === 'otp') return 'otp';
    if (stage === undefined || stage === 'enter' || stage === 'mobile') return 'phone';
  }
  return undefined;
}
