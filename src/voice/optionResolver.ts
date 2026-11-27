/**
 * On-device resolver for the chips on the focused screen (v1.4.3 fix-xtreme-select).
 *
 * The Asset screen registers its vehicle-model and tenure chips (voiceOptions.ts); the server's /text path
 * resolves "extreme 125 r" against them. When the server cannot be reached (ngrok flap, timeout) the phone
 * used to fall back to its command matcher, which has no chip phrases and answered "Sorry, say that again"
 * for every select. This resolver gives the phone the same answer the server's select_option.match_options
 * would give for a clear case, in the same CommandResponse shape (SELECT_VEHICLE_MODEL / SELECT_OPTION,
 * action select, slots, "Select Hero Xtreme 125R?").
 *
 * Bands (stricter than the server, which also has LaBSE):
 *   full   every name word + the model's main number heard, nothing extra or conflicting → ok / auto
 *          (a chip select is reversible: auto-act shows a toast with Undo)
 *   partial a unique chip by name only ("vida", "hero extreme", "splendor"), a fuzzy spelling, an extra word,
 *          a bare number → ok / confirm ("Select Hero Vida V2?" with Confirm), never auto
 *   clash  the dealer named a chip's model but with another number ("pulsar ns 200", "xtreme 160")
 *          → clarify "Did you mean Bajaj Pulsar N250?" (one-tap candidate), never a select
 *   tie    two chips equally good → clarify with both
 *   none   a model that is not on screen ("jupiter 125": only the number matches) → null (caller keeps its reading)
 * Pure: no React Native imports.
 */
import { amountBlocksNavigation, payIsNotMandate, vehicleTokens } from './intentMatcher';
import { FIELD_METHODS, isFieldAnswer, LOAN_ASSET_NO_FIELD_TEXT, LOAN_FIELD_ID, LOAN_NO_FIELD_TEXT, resolveDrawdown, resolveEnhance, resolveLoanAmount, resolveTaRepay } from './fieldResolver';
import { hasUpdateVerb, isRcTurn, resolveRc, updateRcGuard, updateRcName } from './rcResolve';
import { parseResponse } from './sttClient';
import type { CommandContext, CommandResponse, IntentCandidate, VoiceOption } from './types';
import { planTarget } from './voiceLogic';
import { getVoiceField } from './voiceOptions';
import { customerPhrases, matchCustomer } from './customerMatch';
import { tokenSimilarity } from './voiceNormalize';
import { shortBrand } from './voiceOptions';

/** Words around a spoken chip name that carry no meaning (English + Hinglish, like the server's _SELECT_WORDS). */
const FILLER = new Set([
  'please', 'select', 'choose', 'pick', 'take', 'the', 'a', 'an', 'this', 'that', 'option', 'model', 'vehicle', 'bike',
  'scooter', 'car', 'gaadi', 'gadi', 'wali', 'wala', 'wale', 'chahiye', 'lena', 'le', 'lo', 'hai', 'na', 'mujhe', 'ko',
  'ke', 'liye', 'i', 'want', 'need', 'to', 'for', 'me', 'customer', 'yeh', 'woh', 'ye', 'wo', 'we', 'go', 'with', 'it',
  'karo', 'kar', 'do', 'de', 'set', 'make', 'put', 'ok', 'okay', 'is', 'should', 'be', 'and', 'can', 'you', 'let', 's',
]);
const MONTH_WORDS = new Set(['month', 'months', 'mahine', 'mahina', 'mahino', 'mahinon', 'tenure', 'emi']);
const YEAR_WORDS = new Set(['year', 'years', 'saal', 'sal', 'yr', 'yrs']);
/** Same threshold the vehicle entity uses (catalogue vehicles.hit) for a misspelt name word. */
const FUZZY_HIT = 0.85;

const isNum = (t: string) => /^\d+$/.test(t);
const toks = (s: string): string[] => vehicleTokens((s ?? '').replace(/\+/g, ' plus '));

type Level = 'full' | 'partial' | 'clash';
type Scored = { o: VoiceOption; level: Level; hits: number };

const labelOf = (o: VoiceOption): string => {
  if (o.kind === 'tenure') { const n = Number(o.value ?? (o.label.match(/\d+/) ?? [''])[0]); return Number.isFinite(n) && n > 0 ? `${n} months` : o.label; }
  return o.brand && o.model ? `${shortBrand(o.brand)} ${o.model}`.trim() : o.label;
};

/** Model words of a vehicle chip: its model, else its label minus the brand. */
function modelTokens(o: VoiceOption, brandWords: Set<string>): string[] {
  if (o.model) return toks(o.model);
  return toks(o.label).filter((t) => !brandWords.has(t));
}

function scoreVehicle(q: string[], o: VoiceOption, brandWords: Set<string>): Scored | null {
  const m = modelTokens(o, brandWords);
  if (!m.length) return null;
  const nums = m.filter(isNum);
  const mainNum = nums[0];
  const letters = new Set(m.filter((t) => /^[a-z]$/.test(t)));
  const names = m.filter((t) => /^[a-z]{2,}$/.test(t));
  const own = new Set([...toks(o.brand ?? ''), ...toks(shortBrand(o.brand ?? ''))]);
  let nameHit = 0; let numHit = 0; let fuzzy = false; let extra = 0; let unknownWord = false; let clash = false; let brandConflict = false;
  const heard = new Set<string>();
  for (const t of q) {
    if (isNum(t)) { if (nums.includes(t)) { numHit++; heard.add(t); } else clash = true; continue; }
    if (t.length === 1) { if (letters.has(t)) heard.add(t); else extra++; continue; }
    if (names.includes(t)) { nameHit++; heard.add(t); continue; }
    const near = t.length >= 5 ? names.find((n) => n.length >= 5 && tokenSimilarity(t, n) >= FUZZY_HIT) : undefined;
    if (near) { nameHit++; fuzzy = true; heard.add(near); continue; }
    if (own.has(t)) continue;
    if (brandWords.has(t)) { brandConflict = true; continue; }
    extra++; unknownWord = true;
  }
  // The only word that matches is a number, and another (unknown) model name was said: "jupiter 125".
  const nameless = !names.length; // "450X": the number IS the name
  if (!nameHit && !(numHit && nameless)) {
    if (!numHit || unknownWord || clash) return null;
  }
  if (clash) return nameHit ? { o, level: 'clash', hits: nameHit } : null;
  const full = !fuzzy && !extra && !brandConflict && names.every((n) => heard.has(n)) && (!mainNum || heard.has(mainNum));
  return { o, level: full ? 'full' : 'partial', hits: nameHit + numHit };
}

const candidate = (o: VoiceOption, score: number): IntentCandidate => ({
  intent: o.kind === 'vehicle_model' ? 'SELECT_VEHICLE_MODEL' : 'SELECT_OPTION', phrase: labelOf(o), score,
  option: { id: o.id, kind: o.kind, label: labelOf(o), ...(o.value !== undefined ? { value: String(o.value) } : {}) },
});

function selectSlots(o: VoiceOption): Record<string, unknown> {
  const label = labelOf(o);
  if (o.kind === 'vehicle_model') return { label, vehicle: label, assetId: o.id, ...(o.brand ? { brand: o.brand } : {}), ...(o.model ? { model: o.model } : {}) };
  if (o.kind === 'tenure') { const n = Number(o.value ?? (o.label.match(/\d+/) ?? [''])[0]); return { label, ...(Number.isFinite(n) && n > 0 ? { tenureMonths: n } : {}) }; }
  return { label };
}

/** Same body as the server's SelectResult for an ok select, through parseResponse like a real reply. */
function selectResponse(text: string, o: VoiceOption, auto: boolean, confidence: number, others: VoiceOption[] = []): CommandResponse {
  const label = labelOf(o);
  const score = auto ? 1 : 0.8;
  return parseResponse({
    transcript: text, confidence, engine: 'device', method: 'select', matcher: 'option',
    intent: o.kind === 'vehicle_model' ? 'SELECT_VEHICLE_MODEL' : 'SELECT_OPTION', score, matchedPhrase: label,
    action: { type: 'select', kind: o.kind, id: o.id, label, ...(o.value !== undefined ? { value: String(o.value) } : {}) },
    slots: selectSlots(o), status: 'ok', responseText: `Select ${label}?`,
    candidates: [candidate(o, score), ...others.slice(0, 1).map((x) => candidate(x, 0.5))],
    confidenceBand: auto ? 'auto' : 'confirm', autoExecute: auto, autoReason: 'option',
  });
}

function clarifyResponse(text: string, opts: VoiceOption[], confidence: number): CommandResponse {
  const labels = opts.map(labelOf);
  return parseResponse({
    transcript: text, confidence, engine: 'device', method: 'select', matcher: 'option',
    intent: 'UNKNOWN', score: 0.55, matchedPhrase: labels[0], action: { type: 'none' }, status: 'clarify',
    candidates: opts.map((o) => candidate(o, 0.55)), confidenceBand: 'clarify', autoExecute: false, autoReason: 'option',
    responseText: `Did you mean ${labels.join(' or ')}?`,
  });
}

function resolveTenure(text: string, q: string[], tenures: VoiceOption[], confidence: number): CommandResponse | null {
  const nums = q.filter(isNum);
  const words = q.filter((t) => !isNum(t));
  const months = words.some((t) => MONTH_WORDS.has(t));
  const years = words.some((t) => YEAR_WORDS.has(t));
  // Anything besides the number and month / year words (a model name…) is not a plain tenure pick.
  if (nums.length !== 1 || words.some((t) => !MONTH_WORDS.has(t) && !YEAR_WORDS.has(t))) return null;
  const n = Number(nums[0]) * (years && !months ? 12 : 1);
  const hit = tenures.find((o) => Number(o.value ?? (o.label.match(/\d+/) ?? [''])[0]) === n);
  if (!hit) return null;
  return selectResponse(text, hit, months || years, confidence);
}

/**
 * Resolve the spoken text against the registered on-screen options (kind 'vehicle_model' / 'tenure').
 * Returns a server-shaped select / clarify reply, or null when no chip is meant (caller keeps its own reading).
 */
export function resolveScreenOption(text: string, options: readonly VoiceOption[] | undefined, confidence = 1): CommandResponse | null {
  if (!text?.trim() || !options?.length) return null;
  const all = toks(text);
  const q = all.filter((t) => !FILLER.has(t));
  if (!q.length) return null;
  const vehicles = options.filter((o) => o.kind === 'vehicle_model');
  const tenures = options.filter((o) => o.kind === 'tenure');
  const timeWord = q.some((t) => MONTH_WORDS.has(t) || YEAR_WORDS.has(t));
  if (timeWord) return tenures.length ? resolveTenure(text, q, tenures, confidence) : null;

  const brandWords = new Set(vehicles.flatMap((o) => [...toks(o.brand ?? ''), ...toks(shortBrand(o.brand ?? ''))]));
  const scored = vehicles.map((o) => scoreVehicle(q, o, brandWords)).filter((s): s is Scored => !!s);
  const rank = (s: Scored) => (s.level === 'full' ? 2 : s.level === 'partial' ? 1 : 0);
  const good = scored.filter((s) => s.level !== 'clash').sort((a, b) => rank(b) - rank(a) || b.hits - a.hits);
  if (good.length) {
    const [top, second] = good;
    if (second && rank(second) === rank(top) && second.hits === top.hits && labelOf(second.o) !== labelOf(top.o)) {
      return clarifyResponse(text, [top.o, second.o], confidence);
    }
    return selectResponse(text, top.o, top.level === 'full', confidence, good.slice(1).map((s) => s.o));
  }
  const clashes = scored.filter((s) => s.level === 'clash').sort((a, b) => b.hits - a.hits);
  if (clashes.length) return clarifyResponse(text, clashes.slice(0, 2).map((s) => s.o), confidence);
  // A bare number that is not a model number may be a tenure ("24").
  if (tenures.length && q.length === 1 && isNum(q[0])) return resolveTenure(text, q, tenures, confidence);
  return null;
}

/**
 * Server unreachable on a screen with chips: which reading does the phone deliver? The chip answer when it is a
 * full match, or when the command matcher had nothing usable (status not ok); otherwise the local command
 * ("open payouts" on the Asset screen stays a navigation). Never for an expected field (OTP / phone / amount).
 */
export function offlineReading(local: CommandResponse, option: CommandResponse | null, expect?: string): CommandResponse {
  // v1.4.5: an exact field answer (loan amount, TA repay, OTP, customer row) always beats the command list.
  // v1.4.5 S2.7: "open TA" on a list screen is the sure command, not "Ta is not on this list." (an absent name).
  if (option && option.autoReason === 'customer_absent' && (local.status ?? 'ok') === 'ok' && local.autoExecute === true) return local;
  if (option && isFieldAnswer(option)) return option;
  if (expect || !option) return local;
  if (option.autoExecute === true || (local.status ?? 'ok') !== 'ok') return option;
  return local;
}

/** v1.4.5: shown instead of a fuzzy "Did you mean" when no voice route answers. */
export const NO_CONNECTION = 'No connection — try again or tap it';

/**
 * v1.4.5: every voice route is down. A confident phone reading still runs (auto-act, e.g. a full on-screen chip
 * match; a chip select preview is exact, not fuzzy). Anything the phone is unsure of — say again, clarify, a
 * "Did you mean" (confirm band) — becomes NO_CONNECTION instead. With a route up, always deliver.
 */
export function offlineVerdict(off: CommandResponse, allDown: boolean): 'deliver' | 'no_connection' {
  if (!allDown) return 'deliver';
  // v1.4.5: a field answer is exact (parsed amount / OTP digits / a named row), never a fuzzy guess.
  if (FIELD_METHODS.has(off.method ?? '')) return 'deliver';
  if ((off.status ?? 'ok') !== 'ok') return 'no_connection';
  if (off.action.type === 'select') return 'deliver';
  if (off.autoExecute === true || off.confidenceBand === 'auto') return 'deliver';
  // A sure keyword match that only needs Confirm because it moves money / signs (never auto by design).
  if (off.autoReason === 'destructive' && off.action.type !== 'none') return 'deliver';
  if (off.confidenceBand === undefined && off.action.type !== 'none' && off.score >= 0.8 && !off.candidates?.length) return 'deliver';
  return 'no_connection';
}

/** A chip answer that must not act on its own (shaky phone text): Confirm preview, same select. */
export function optionAsConfirm(c: CommandResponse): CommandResponse {
  if (c.action.type !== 'select') return c;
  return { ...c, autoExecute: false, confidenceBand: 'confirm', score: Math.min(c.score, 0.8) };
}

/**
 * How long the phone waits for the server's /text answer before acting on a FULL on-screen chip match
 * itself. The server stays first when reachable (it usually answers in well under a second); this only
 * stops a dead tunnel from holding the turn for STT_TIMEOUT_MS (45 s).
 */
export const OPTION_SERVER_BUDGET_MS = 2500;

/**
 * Ask the server's text path; when the phone already has a full chip match (`option.autoExecute`), race the
 * server against `budgetMs` and use the phone's chip if the server errors or is late. Without a full match
 * this is just `ask()` (errors propagate to the caller's offline fallback). A late server answer is ignored.
 */
export async function serverOrOption(
  ask: () => Promise<CommandResponse>,
  option: CommandResponse | null,
  budgetMs = OPTION_SERVER_BUDGET_MS,
): Promise<{ cmd: CommandResponse; from: 'server' | 'option' }> {
  if (!option || option.autoExecute !== true) return { cmd: await ask(), from: 'server' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  try {
    const server = await Promise.race([ask().catch(() => null), late]);
    return server ? { cmd: server, from: 'server' } : { cmd: option, from: 'option' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * v1.4.5: the phone's own reading of the focused screen's fields and chips, in server shape, or null.
 * Order: loan amount (Asset field) → TA repay / enhance (TaInf) → customer rows → vehicle / tenure chips.
 * The server stays first whenever it answers; this is the offline path and the navigation guard below.
 */
export function resolveOnPhone(text: string, ctx: Pick<CommandContext, 'screen' | 'options' | 'fields' | 'expect' | 'context'>, confidence = 1): CommandResponse | null {
  if (!text?.trim() || ctx.expect === 'otp') return null;
  // v1.4.5 S2.4: an RC number (RC sheet: fill / correction / "say the full number"; elsewhere a valid plate → Confirm).
  const rc = resolveRc(text, ctx, confidence);
  if (rc) return rc;
  if (isRcTurn(ctx)) { const row = resolveCustomer(text, ctx.options, ctx.screen, confidence); if (row) return row; return null; }
  // v1.4.5 S2.5: the TA drawdown amount step (field drawdown-amount) takes a bare amount before repay / loan readers.
  const dd = resolveDrawdown(text, ctx.fields, confidence);
  if (dd) return dd;
  // TA "How much?" was asked: the next bare amount on TaInf is the repay amount.
  const amountTurn = ctx.expect === 'amount';
  const repay = resolveTaRepay(text, ctx.screen, ctx.fields, confidence, amountTurn);
  if (repay) return repay;
  if (amountTurn) return null;
  const loan = resolveLoanAmount(text, getVoiceField(LOAN_FIELD_ID, ctx.fields), ctx.screen, confidence);
  if (loan) return loan;
  const enhance = resolveEnhance(text, ctx.screen, confidence, ctx.fields, ctx.options, typeof ctx.context?.sheet === 'string' ? ctx.context.sheet : undefined);
  if (enhance) return enhance;
  const row = resolveCustomer(text, ctx.options, ctx.screen, confidence);
  if (row) return row;
  return resolveScreenOption(text, ctx.options, confidence);
}

/**
 * v1.4.5 customer rows (RcPendency; CONTRACT.md 3.5, server select_customer.py): one clear row → open it at once
 * ("Open Vikram Rao's RC?", same as a tap; upload stays a manual tap), duplicates → clarify "Vikram Rao or
 * Vikram Singh?", absent → "Sanjay Pawar is not in pending RCs.", submitted → already submitted. Null = no name.
 */
export function resolveCustomer(text: string, options: readonly VoiceOption[] | undefined, screen?: string, confidence = 1): CommandResponse | null {
  const m = matchCustomer(text, options);
  if (!m) return null;
  const rc = screen === 'RcPendency';
  const base = { transcript: text, confidence, engine: 'device', method: 'token:customer', matcher: 'customer' };
  const cand = (o: VoiceOption, score: number, phrase?: string) => ({ intent: 'SELECT_OPTION', phrase: phrase ?? o.label, score, option: { id: o.id, kind: 'customer', label: o.label, value: o.value ?? o.id } });
  if (m.kind === 'absent') {
    return parseResponse({ ...base, intent: 'UNKNOWN', score: 0.3, matchedPhrase: null, action: { type: 'none' }, status: 'retry',
      responseText: `${m.name} is ${rc ? 'not in pending RCs' : 'not on this list'}.`, confidenceBand: 'retry', autoExecute: false, autoReason: 'customer_absent' });
  }
  if (m.kind === 'submitted') {
    const reg = m.option.regNo ? ` (${m.option.regNo})` : '';
    return parseResponse({ ...base, intent: 'UNKNOWN', score: 0.5, matchedPhrase: m.option.label, action: { type: 'none' }, status: 'retry',
      responseText: `${m.option.label}'s RC is already submitted${reg}.`, confidenceBand: 'retry', autoExecute: false, autoReason: 'customer_submitted' });
  }
  if (m.kind === 'several') {
    const phrases = customerPhrases(m.options);
    return parseResponse({ ...base, intent: 'UNKNOWN', score: 0.6, matchedPhrase: phrases[0], action: { type: 'none' }, status: 'clarify',
      responseText: `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1]}?`, confidenceBand: 'clarify', autoExecute: false, autoReason: 'option',
      candidates: m.options.map((o, i) => cand(o, 0.6, phrases[i])) });
  }
  const o = m.option;
  const value = o.value ?? o.id;
  const score = m.level === 'full' || m.level === 'fuzzy' ? 0.95 : 0.8;
  return parseResponse({ ...base, intent: 'SELECT_OPTION', score, matchedPhrase: o.label,
    action: { type: 'select', kind: 'customer', id: o.id, label: o.label, value }, slots: { customerLan: value },
    status: 'ok', responseText: rc ? `Open ${o.label}'s RC?` : `Open ${o.label}?`, confidenceBand: 'auto', autoExecute: true, autoReason: 'option',
    candidates: [cand(o, score)] });
}

const ROW_STEALERS: ReadonlySet<string> = new Set(['UPLOAD_RC', 'SHOW_RC_PENDENCY', 'CHANGE_DOWN_PAYMENT', 'TAKE_DELIVERY_PHOTO']);
const LOAN_NAV_INTENTS: ReadonlySet<string> = new Set([
  'START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'NEW_TWO_WHEELER_LOAN', 'NEW_CAR_LOAN', 'NEW_CONSUMER_DURABLE_LOAN', 'SEARCH_MOBILE_NUMBER', 'SEARCH_CUSTOMER',
]);

/**
 * v1.4.5 last line of defence on ANY answer (an older server, Whisper's reading): an amount phrase never navigates
 * (START_NEW_LOAN / any journey) without a start verb, and "pay …" never becomes the UPI mandate. The phone's
 * field reading replaces it, else a non-acting line. `heard` = what the dealer said (device text / transcript).
 */
export function guardAnswer(cmd: CommandResponse, heard: string, ctx: Pick<CommandContext, 'screen' | 'options' | 'fields' | 'expect' | 'context'>): CommandResponse {
  const text = heard ?? '';
  if (!text.trim() || ctx.expect === 'otp' || isFieldAnswer(cmd)) return cmd;
  // v1.4.5: a name on a screen with customer rows beats an RC / down-payment reading ("upload RC for Vikram Rao"
  // opens Vikram Rao's row, never Docs; upload stays a manual tap).
  if (ROW_STEALERS.has(cmd.intent) && ctx.options?.some((o) => o.kind === 'customer')) {
    const row = resolveCustomer(text, ctx.options, ctx.screen, cmd.confidence);
    if (row) return row;
  }
  // v1.4.5 S2.4: on the RC sheet the phone's plate reading beats an older server's NUMBER + OTP reading; letters +
  // digits are never an OTP anywhere; "I want to update Vikram Rao's RC" is never a new loan.
  if (cmd.intent !== 'ADVANCE' && (isRcTurn(ctx) || (cmd.normalizedFields ?? []).some((f) => f.type === 'OTP' || f.type === 'NUMBER'))) {
    const rc = resolveRc(text, ctx, cmd.confidence);
    if (rc) return rc;
  }
  const upd = updateRcGuard(text, cmd, ctx);
  if (upd) return upd;
  if ((updateRcName(text) || hasUpdateVerb(text)) && ctx.options?.some((o) => o.kind === 'customer') && cmd.intent !== 'SELECT_OPTION' && cmd.action.type !== 'select') {
    // Only a named row (one / several / already submitted) — "open portfolio" is never "Portfolio is not in pending RCs".
    const row = resolveCustomer(text, ctx.options, ctx.screen, cmd.confidence);
    if (row && row.autoReason !== 'customer_absent') return row;
  }
  const t = planTarget(cmd);
  const loanNav = (LOAN_NAV_INTENTS.has(cmd.intent) || (t.kind === 'navigate' && cmd.intent !== 'TA_REPAY' && cmd.intent !== 'ENHANCE_TA_LIMIT' && t.filter !== 'down_payment'))
    && t.kind === 'navigate' && amountBlocksNavigation(text);
  const mandate = (cmd.intent === 'SETUP_UPI_MANDATE' || cmd.intent === 'OPEN_UPI_APP') && payIsNotMandate(text);
  if (!loanNav && !mandate) return cmd;
  const mine = resolveOnPhone(text, ctx, cmd.confidence);
  if (mine) return mine;
  const loanLine = loanNav && /\b(?:loan|lone)\b|लोन/i.test(text);
  return parseResponse({
    transcript: cmd.transcript, confidence: cmd.confidence, engine: cmd.engine ?? 'device', method: 'amount', matcher: 'guard',
    intent: loanLine ? 'SET_LOAN_AMOUNT' : 'UNKNOWN', score: 0, matchedPhrase: null, action: { type: 'none' }, status: loanLine ? 'ok' : 'retry',
    responseText: loanLine ? (ctx.screen === 'Asset' ? LOAN_ASSET_NO_FIELD_TEXT : LOAN_NO_FIELD_TEXT) : 'Sorry, say that again.',
    confidenceBand: loanLine ? 'confirm' : 'retry', autoExecute: false, autoReason: loanNav ? 'amount_never_navigates' : 'pay_is_not_mandate',
  });
}
