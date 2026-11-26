/**
 * Pure voice helpers (no React Native imports) so they can be unit-tested in plain Node.
 * applyCommand / useVoiceCommand / VoicePreviewSheet build on these.
 *
 * OTP SAFETY: `normalizedFields` holds the real OTP digits (needed to fill on Confirm). Nothing here
 * ever logs them, and every helper that produces display text masks OTP rows.
 */
import type { CommandResponse, IntentCandidate, NormalizedField, VoiceExpect, VoiceSlots } from './types';

/** Server intents that pick a chip on the current screen (never a navigation). */
export const SELECT_INTENTS: ReadonlySet<string> = new Set(['SELECT_VEHICLE_MODEL', 'SELECT_OPTION']);

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
  // v1.4.0
  OPEN_CASES: { route: 'Cases' },
  OPEN_TA_INF: { route: 'TaInf' },
  OPEN_OFFER: { route: 'Offer' },
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
  // v1.3.0: Help & tutorials (videos).
  OPEN_HELP: { route: 'Help' },
  OPEN_TUTORIALS: { route: 'Help' },
  SHOW_TUTORIALS: { route: 'Help' },
  HOW_TO: { route: 'Help' },
};

/** v1.3.0: "help", "tutorial(s)", "how to" / "how-to" in what the dealer said. */
const TUTORIAL_RE = /\b(help|tutorials?|how[\s-]?tos?)\b/i;

/**
 * Spoken "help" / "tutorial" / "how to" opens Help & tutorials. Only overrides the server's generic
 * HELP read-out or an UNKNOWN intent; any specific intent ("go home", "scan QR"…) keeps its own target.
 */
export function isTutorialRequest(cmd: CommandResponse): boolean {
  if (cmd.intent !== 'UNKNOWN' && cmd.intent !== 'HELP') return false;
  // A spoken number (mobile, OTP, amount) with no intent is a fill, never a trip to Help.
  if (cmd.intent === 'UNKNOWN' && validFields(cmd).length) return false;
  return TUTORIAL_RE.test(cmd.transcript ?? '');
}

/** Navigate target for a command: the server's action first, else the intent fallback map. */
export function resolveNavTarget(cmd: CommandResponse): { route: string; filter?: string } | null {
  if (cmd.action.type === 'navigate') return { route: cmd.action.route, ...(cmd.action.filter ? { filter: cmd.action.filter } : {}) };
  if (cmd.action.type === 'assistant' || cmd.action.type === 'select') return null;
  return INTENT_ROUTE[cmd.intent] ?? null;
}

/** What Confirm should do, before route-availability checks (planCommand adds those). */
export type PlanTarget =
  | { kind: 'navigate'; route: string; filter?: string }
  | { kind: 'assistant' }
  | { kind: 'fill'; fields: NormalizedField[] }
  /** Pick a chip on the CURRENT screen (vehicle model, tenure, …). Never navigates or presses Continue. */
  | { kind: 'select'; optionKind: string; id: string; label: string; value?: string }
  | { kind: 'none' };

/** Is this a "select an on-screen option" command (by action or intent)? */
export const isSelectCommand = (cmd: CommandResponse): boolean => cmd.action.type === 'select' || SELECT_INTENTS.has(cmd.intent);

/**
 * The select target of a command: the server's `action` first, else rebuilt from slots
 * (assetId / vehicle → vehicle_model, tenureMonths → tenure). Null when nothing usable.
 */
export function selectTarget(cmd: CommandResponse): Extract<PlanTarget, { kind: 'select' }> | null {
  const a = cmd.action;
  if (a.type === 'select') return { kind: 'select', optionKind: a.kind, id: a.id, label: a.label, ...(a.value !== undefined ? { value: a.value } : {}) };
  if (!SELECT_INTENTS.has(cmd.intent)) return null;
  const s = cmd.slots ?? {};
  if (s.assetId || s.vehicle) {
    const id = s.assetId ?? s.vehicle!;
    return { kind: 'select', optionKind: 'vehicle_model', id, label: s.vehicle ?? id, value: id };
  }
  if (s.tenureMonths) {
    return { kind: 'select', optionKind: 'tenure', id: `tenure-${s.tenureMonths}`, label: `${s.tenureMonths} months`, value: String(s.tenureMonths) };
  }
  return null;
}

/** Draft slots written when a select is confirmed. The screen that owns the chips applies them. */
export function slotsForSelect(t: Extract<PlanTarget, { kind: 'select' }>, slots?: VoiceSlots): VoiceSlots {
  if (t.optionKind === 'vehicle_model') {
    return {
      assetId: t.value || t.id,
      vehicle: t.label || slots?.vehicle,
      ...(slots?.brand ? { brand: slots.brand } : {}),
      ...(slots?.model ? { model: slots.model } : {}),
    };
  }
  if (t.optionKind === 'tenure') {
    const n = Number(t.value ?? (t.label.match(/\d+/)?.[0] ?? slots?.tenureMonths));
    return Number.isFinite(n) && n > 0 ? { tenureMonths: Math.round(n) } : {};
  }
  return {};
}

/** Model numbers ("Xtreme 125R", "Bullet 350") must never show up as an Amount on a select. */
export const hideFieldForSelect = (cmd: CommandResponse, f: NormalizedField): boolean => isSelectCommand(cmd) && f.type === 'AMOUNT';

/**
 * clarify / retry / reprompt never get a Confirm until the dealer picks a candidate or types a value
 * (both of which re-stage the command as status 'ok'). Navigation wins over a fill; a navigate that
 * also carried numbers stores them in the draft too.
 */
export function planTarget(cmd: CommandResponse): PlanTarget {
  const status = cmd.status ?? 'ok';
  if (status !== 'ok') return { kind: 'none' };
  // A select stays on this screen; it wins over any navigation (these intents are not in INTENT_ROUTE).
  if (isSelectCommand(cmd)) return selectTarget(cmd) ?? { kind: 'none' };
  if (isTutorialRequest(cmd)) return { kind: 'navigate', route: 'Help' };
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

/** A picked candidate is a new decision: the server's auto flags for the clarify reply no longer apply. */
const CLEAR_AUTO = { autoExecute: undefined, confidenceBand: undefined, autoReason: undefined } as const;

/** Re-stage a clarify command with the candidate the dealer picked (Confirm still required). */
export function withCandidate(cmd: CommandResponse, c: IntentCandidate): CommandResponse {
  if (c.option) {
    const o = c.option;
    const intent = SELECT_INTENTS.has(c.intent) ? c.intent : o.kind === 'vehicle_model' ? 'SELECT_VEHICLE_MODEL' : 'SELECT_OPTION';
    const target = { kind: 'select' as const, optionKind: o.kind, id: o.id, label: o.label, ...(o.value !== undefined ? { value: o.value } : {}) };
    return {
      ...cmd,
      status: 'ok',
      intent,
      score: c.score,
      matchedPhrase: c.phrase,
      candidates: undefined,
      ...CLEAR_AUTO,
      action: { type: 'select', kind: o.kind, id: o.id, label: o.label, ...(o.value !== undefined ? { value: o.value } : {}) },
      slots: slotsForSelect(target),
    };
  }
  const nav = INTENT_ROUTE[c.intent];
  return {
    ...cmd,
    status: 'ok',
    intent: c.intent,
    score: c.score,
    matchedPhrase: c.phrase,
    candidates: undefined,
    ...CLEAR_AUTO,
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

// ---------------------------------------------------------------------------------------------
// v1.2.7 auto-act: high-confidence commands act at once (toast + Undo) instead of opening Confirm.
// ---------------------------------------------------------------------------------------------

// Unified bands for options AND navigation / journeys (QR, loan, mobile, portfolio, ...):
//   >= 0.65 unique, or a unique exact keyword / alias -> act at once (toast + Undo)
//   0.50 to < 0.65 unique                            -> Confirm
//   near tie of two different actions                -> clarify (server sends status 'clarify')
//   < 0.50                                           -> say again

/** Option (vehicle / tenure chip) score at or above which a unique match acts without Confirm. */
export const OPTION_AUTO_THRESHOLD = 0.65;
/** Option scores in [OPTION_CONFIRM_THRESHOLD, OPTION_AUTO_THRESHOLD) open Confirm; below is "say again". */
export const OPTION_CONFIRM_THRESHOLD = 0.5;
/** Navigation / journey semantic score at or above which a unique match acts without Confirm (same as options). */
export const COMMAND_AUTO_THRESHOLD = 0.65;
/** Command scores in [COMMAND_CONFIRM_THRESHOLD, COMMAND_AUTO_THRESHOLD) open Confirm; below is "say again". */
export const COMMAND_CONFIRM_THRESHOLD = 0.5;
/**
 * Clarify is no longer a score band: the server decides it on a near tie of two different actions
 * (status === 'clarify'). Kept equal to the Confirm floor for callers that still read it.
 */
export const COMMAND_CLARIFY_THRESHOLD = COMMAND_CONFIRM_THRESHOLD;
/** A keyword match at or above this score is a unique exact keyword / alias and may act without autoExecute. */
export const KEYWORD_EXACT_THRESHOLD = 0.95;

/**
 * Intents that submit, verify, sign, pay or upload: NEVER auto-executed, whatever the server says.
 * (An OTP may be auto-FILLED into the boxes; Verify is always the dealer's tap.)
 */
export const DESTRUCTIVE_INTENTS: ReadonlySet<string> = new Set([
  'CONFIRM_OFFER', 'START_ESIGN', 'SETUP_UPI_MANDATE', 'OPEN_UPI_APP', 'UPLOAD_RC', 'TAKE_DELIVERY_PHOTO',
  'VERIFY_OTP', 'SUBMIT_OTP', 'SUBMIT', 'SUBMIT_APPLICATION', 'CONFIRM', 'CONFIRM_DISBURSAL', 'ESIGN', 'PRESS_CONTINUE',
]);
/** Any other intent whose name says it verifies / submits / confirms / signs / pays. */
const DESTRUCTIVE_INTENT_RE = /(^|_)(VERIFY|SUBMIT|CONFIRM|ESIGN|SIGN|PAY|PAYMENT|DISBURSE|DISBURSAL|MANDATE|UPLOAD|APPROVE|DELETE|CANCEL|REJECT)(_|$)/;
/** Screens that start an irreversible step on open, and navigate filters that mean "press the CTA". */
const DESTRUCTIVE_ROUTES: ReadonlySet<string> = new Set(['Esign', 'Mandate', 'Disbursal']);
const DESTRUCTIVE_FILTERS: ReadonlySet<string> = new Set(['confirm', 'submit', 'verify', 'esign', 'rc', 'delivery_photo']);

/** Field types a validated spoken value may auto-fill. */
const AUTO_FIELD_TYPES: ReadonlySet<string> = new Set(['PHONE', 'OTP', 'AMOUNT', 'PIN', 'PINCODE']);

/** Would this command verify / submit / confirm / sign / pay / upload (directly or via its target)? */
export function isDestructiveCommand(cmd: CommandResponse): boolean {
  if (cmd.autoReason === 'destructive') return true;
  if (DESTRUCTIVE_INTENTS.has(cmd.intent) || (!SELECT_INTENTS.has(cmd.intent) && DESTRUCTIVE_INTENT_RE.test(cmd.intent))) return true;
  const nav = cmd.action.type === 'navigate' ? cmd.action : cmd.action.type === 'none' ? INTENT_ROUTE[cmd.intent] : undefined;
  if (nav && (DESTRUCTIVE_ROUTES.has(nav.route) || (nav.filter !== undefined && DESTRUCTIVE_FILTERS.has(nav.filter)))) return true;
  return false;
}

/**
 * Act on this command right away (toast + Undo) instead of opening Confirm?
 * 1. "Ask before acting" on → never.  2. Not status ok / nothing to do → never.
 * 3. Destructive (submit / verify / sign / pay / upload) → never.  4. Server autoExecute decides when sent.
 * 5. Older server (no autoExecute), same 0.65 band for options and navigation / journeys:
 *    option ≥ 0.65, semantic command ≥ 0.65, unique exact keyword (score ≥ 0.95), or a valid
 *    phone / OTP / amount / PIN fill. A non-exact keyword without autoExecute does not guess.
 */
export function shouldAutoExecute(cmd: CommandResponse, askBeforeActing: boolean): boolean {
  if (askBeforeActing) return false;
  if ((cmd.status ?? 'ok') !== 'ok') return false;
  if (cmd.confidenceBand && cmd.confidenceBand !== 'auto' && cmd.autoExecute !== true) return false;
  const t = planTarget(cmd);
  if (t.kind === 'none' || t.kind === 'assistant') return false;
  if (isDestructiveCommand(cmd)) return false;
  if (t.kind === 'fill' && !t.fields.every((f) => f.valid && AUTO_FIELD_TYPES.has(f.type))) return false;
  if (cmd.autoExecute !== undefined) return cmd.autoExecute;
  // Fallback for servers that do not send autoExecute.
  if (t.kind === 'select') return cmd.score >= OPTION_AUTO_THRESHOLD;
  if (t.kind === 'navigate') {
    const method = cmd.method ?? cmd.matchMethod;
    if (method === 'semantic') return cmd.score >= COMMAND_AUTO_THRESHOLD;
    if (method === 'keyword') return cmd.score >= KEYWORD_EXACT_THRESHOLD;
    return false;
  }
  return t.kind === 'fill';
}

/** Draft slots a screen registers for Undo, per plan target. */
export type UndoSlot = 'asset' | 'tenure' | 'mobile' | 'otp' | 'amount';

/** Which screen values an auto-act may change (snapshotted before it runs). */
export function undoSlotsFor(t: PlanTarget): UndoSlot[] {
  if (t.kind === 'select') return t.optionKind === 'vehicle_model' ? ['asset'] : t.optionKind === 'tenure' ? ['tenure'] : [];
  const fields = t.kind === 'fill' ? t.fields : [];
  const out = new Set<UndoSlot>();
  for (const f of fields) {
    if (f.type === 'PHONE') out.add('mobile');
    else if (f.type === 'OTP') out.add('otp');
    else if (f.type === 'AMOUNT') out.add('amount');
  }
  return [...out];
}

/** Short toast lines for common navigations ("Opening QR journey"). */
const NAV_TOAST: Readonly<Record<string, string>> = {
  START_QR_JOURNEY: 'Opening QR journey',
  SCAN_QR: 'Opening QR journey',
  START_MOBILE_JOURNEY: 'Starting the mobile number journey',
  START_NEW_LOAN: 'Starting the mobile number journey',
  SEARCH_MOBILE_NUMBER: 'Starting the mobile number journey',
  SEARCH_CUSTOMER: 'Starting the mobile number journey',
  NEW_TWO_WHEELER_LOAN: 'Starting a two-wheeler loan',
  NEW_CAR_LOAN: 'Starting a car loan',
  NEW_CONSUMER_DURABLE_LOAN: 'Starting a consumer durable loan',
  GO_HOME: 'Opening Home',
  OPEN_HELP: 'Opening Help & tutorials',
  OPEN_TUTORIALS: 'Opening Help & tutorials',
  SHOW_TUTORIALS: 'Opening Help & tutorials',
  HOW_TO: 'Opening Help & tutorials',
  HELP: 'Opening Help & tutorials',
  OPEN_TA_INF: 'Opening TA / INF',
};

const OTP_WORDS: Readonly<Record<number, string>> = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight' };

/** One short sentence: no trailing "?" / ".", max ~60 chars, otherwise null. */
function shortLine(text: string | undefined): string | null {
  const t = (text ?? '').trim().replace(/[.!]+$/, '');
  if (!t || t.length > 60 || /[?]/.test(t) || /[.!?]\s/.test(t)) return null;
  return t;
}

/**
 * Toast text for an auto-acted command. OTP is NEVER shown: "OTP captured, six digits".
 * `routeLabel` is the screen's human name ("Scan customer QR"), used when nothing better exists.
 */
export function autoToastText(cmd: CommandResponse, t: PlanTarget, routeLabel?: string): string {
  if (t.kind === 'select') return `Selected ${t.label}`;
  if (t.kind === 'fill') {
    const f = t.fields[0];
    if (!f) return 'Filled';
    if (f.type === 'OTP') {
      const n = f.value.replace(/\D/g, '').length;
      return `OTP captured, ${OTP_WORDS[n] ?? 'all'} digits`;
    }
    const shown = displayFields(cmd).find((d) => d.type === f.type)?.display || f.display || f.value;
    if (f.type === 'PHONE') return `Mobile number ${shown}`;
    if (f.type === 'AMOUNT') return `Amount ${shown}`;
    if (f.type === 'PIN' || f.type === 'PINCODE') return `PIN code ${shown}`;
    return `Filled ${shown}`;
  }
  if (t.kind === 'navigate') {
    const fixed = NAV_TOAST[cmd.intent];
    if (fixed) return fixed;
    // Server line only when it has no digits that could be an OTP and reads as one short sentence.
    const line = isOtpCommand(cmd) ? null : shortLine(cmd.readBack ?? cmd.responseText);
    if (line) return line;
    return `Opening ${routeLabel ?? t.route}`;
  }
  return 'Done';
}
