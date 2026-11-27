/**
 * v1.4.5 on-device resolver for the numeric FIELDS a screen registers (voiceOptions.setVoiceFields), in the same
 * CommandResponse shape the server sends (CONTRACT.md §3). Used when the server cannot be reached, and as the
 * guard when an older server would navigate away on an amount.
 *
 * SET_LOAN_AMOUNT (Asset, field `loan-amount`; mirror of the server's src/loan_amount.py decide()):
 *   explicit ("loan amount 1 lakh", "loan 1 lakh", "set loan amount to 80000", "1 lakh ka loan") → ok / auto (Undo)
 *   bare ("one lakh", "95 thousand", "1,10,000")                                                → ok / confirm
 *   rounded to `step` (half up); above max / below min → clarify "… Set ₹X?" with a one-tap candidate
 *   "loan amount" with no number → retry "Say the loan amount, like one lakh. It is ₹X now."
 *   no field (any other screen) + a loan word → "You can set the loan amount on the vehicle screen." (never navigates)
 * Pure: no React Native imports.
 */
import { clampOffer, findAmount, formatInr, nonAmountWords, roundToStep } from './amountParse';
import { parseResponse } from './sttClient';
import type { CommandResponse, VoiceField } from './types';
import { normalizeText, tokenize } from './voiceNormalize';

export const LOAN_FIELD_ID = 'loan-amount';
export const LOAN_INTENT = 'SET_LOAN_AMOUNT';
export const LOAN_NO_FIELD_TEXT = 'You can set the loan amount on the vehicle screen.';
export const LOAN_ASSET_NO_FIELD_TEXT = 'Set the loan amount with the slider on this screen.';

const LOAN_WORD_RE = /\b(?:loan|loans|lone|loun|lon)\b|लोन|ऋण/i;
const AMOUNT_WORD_RE = /\b(?:amount|amt|rashi|raashi|rakam|rakkam)\b|अमाउंट|राशि|रकम/i;
const START_RE = /\b(?:start|new|begin|apply|journey|qr|shuru|chalu)\b|नया|नई|शुरू|चालू/i;
const DOWN_RE = /\bdown\s*-?\s*payment\b|\bdp\b|डाउन\s*पेमेंट/i;
const EMI_WORD_RE = /\bemi\b|\be\s*m\s*i\b|\binstall?ments?\b|\bkist\b|\bkisht\b|ईएमआई|किस्त/i;
const PAY_RE = /\b(?:re-?pay|pay|paying|payment|jama|chuka|chukao|bharo|bhar)\b|चुका|जमा|भुगतान/i;
const BARE_FILLER: ReadonlySet<string> = new Set([
  'rupees', 'rupee', 'rs', 'inr', 'only', 'please', 'the', 'a', 'make', 'it', 'set', 'to', 'kar', 'karo', 'do', 'de',
  'dijiye', 'rakho', 'hai', 'ok', 'okay', 'ji', 'haan', 'is', 'of', 'for', 'कर', 'करो', 'दो', 'रुपये',
].map((w) => w.normalize('NFC')));

/** Methods / intents of a field answer: exact (not fuzzy), so it wins over the command list offline. */
export const FIELD_METHODS: ReadonlySet<string> = new Set(['amount', 'ta_repay', 'otp', 'token:customer', 'enhance', 'advance', 'rc_reg', 'drawdown']);
export const FIELD_INTENTS: ReadonlySet<string> = new Set([LOAN_INTENT, 'TA_REPAY', 'ENHANCE_TA_LIMIT', 'SET_RC_NUMBER', 'SET_DRAWDOWN_AMOUNT']);
export const isFieldAnswer = (c: CommandResponse | null | undefined): boolean =>
  !!c && (FIELD_INTENTS.has(c.intent) || FIELD_METHODS.has(c.method ?? ''));

const loanOption = (n: number) => ({ id: LOAN_FIELD_ID, kind: 'amount', label: formatInr(n), value: String(Math.round(n)) });

function reply(text: string, confidence: number, body: Record<string, unknown>): CommandResponse {
  return parseResponse({ transcript: text, confidence, engine: 'device', method: 'amount', matcher: 'field', ...body });
}

/** The loan-amount reading of `text` on a screen with (or without) the loan field, or null (not a loan amount). */
export function resolveLoanAmount(text: string, field: VoiceField | undefined, screen?: string, confidence = 1): CommandResponse | null {
  const t = text ?? '';
  if (!t.trim() || DOWN_RE.test(t) || PAY_RE.test(t)) return null;
  const amt = findAmount(t);
  const loanWord = LOAN_WORD_RE.test(t);
  const explicit = loanWord || AMOUNT_WORD_RE.test(t);
  if (!amt) {
    // "loan amount" / "change the loan amount" with no number: ask for it (never a journey).
    if (field && explicit && !START_RE.test(t) && AMOUNT_WORD_RE.test(t)) {
      const now = typeof field.value === 'number' && field.value ? ` It is ${formatInr(field.value)} now.` : '';
      return reply(t, confidence, {
        intent: LOAN_INTENT, score: 0.7, matchedPhrase: 'loan amount', action: { type: 'none' }, status: 'retry',
        responseText: `Say the loan amount, like one lakh.${now}`, confidenceBand: 'retry', autoExecute: false, autoReason: 'loan_amount_missing',
      });
    }
    return null;
  }
  if (EMI_WORD_RE.test(t) && !explicit) return null; // "EMI 3000" is not the loan amount
  if (!field) {
    if (!loanWord || START_RE.test(t)) return null;
    return reply(t, confidence, {
      intent: LOAN_INTENT, score: 0.8, matchedPhrase: 'loan amount', action: { type: 'none' }, status: 'ok',
      responseText: screen === 'Asset' ? LOAN_ASSET_NO_FIELD_TEXT : LOAN_NO_FIELD_TEXT,
      confidenceBand: 'confirm', autoExecute: false, autoReason: 'loan_amount_no_field',
    });
  }
  if (!explicit && (!amt.scaled || nonAmountWords(t, BARE_FILLER).length > 1)) return null;
  const value = roundToStep(amt.value, field.step);
  const clamp = clampOffer(value, field);
  if (clamp) {
    const [side, limit] = clamp;
    const spoken = side === 'over'
      ? `${formatInr(value)} is above the limit of ${formatInr(limit)}. Set ${formatInr(limit)}?`
      : `${formatInr(value)} is below the minimum of ${formatInr(limit)}. Set ${formatInr(limit)}?`;
    return reply(t, confidence, {
      intent: LOAN_INTENT, score: 0.6, matchedPhrase: `Set ${formatInr(limit)}`, action: { type: 'none' }, status: 'clarify',
      slots: { loanAmount: value }, responseText: spoken, confidenceBand: 'clarify', autoExecute: false,
      autoReason: side === 'over' ? 'loan_amount_over_max' : 'loan_amount_under_min',
      candidates: [{ intent: LOAN_INTENT, phrase: `Set ${formatInr(limit)}`, score: 0.6, option: loanOption(limit) }],
    });
  }
  const auto = explicit;
  return reply(t, confidence, {
    intent: LOAN_INTENT, score: auto ? 0.95 : 0.8, matchedPhrase: `loan amount ${formatInr(value)}`,
    action: { type: 'select', ...loanOption(value) }, slots: { loanAmount: value }, status: 'ok',
    responseText: auto ? `Loan amount set to ${formatInr(value)}.` : `Set loan amount to ${formatInr(value)}?`,
    confidenceBand: auto ? 'auto' : 'confirm', autoExecute: auto, autoReason: auto ? 'loan_amount' : 'loan_amount_bare',
    candidates: [{ intent: LOAN_INTENT, phrase: `Set ${formatInr(value)}`, score: auto ? 0.95 : 0.8, option: loanOption(value) }],
  });
}

// ---- TA_REPAY / ENHANCE_TA_LIMIT (TaInf; mirror of the server's src/ta_repay.py read_repay / enhance_override) ----

export const TA_REPAY_INTENT = 'TA_REPAY';
export const ENHANCE_INTENT = 'ENHANCE_TA_LIMIT';
export const TA_FIELD_ID = 'ta-repay';
export const TA_ROUTE = 'TaInf';
export const REPAY_ASK_TEXT = 'How much?';
export const REPAY_NOTHING_TEXT = 'Nothing to repay.';
const FACILITY = 'Trade Advance';

const PAY_WORDS = new Set(['pay', 'repay', 'repayment', 'payback', 'chuka', 'chukao', 'chukado', 'chukana', 'chukta', 'jama', 'bhar', 'bharo',
  'bhardo', 'bharna', 'bhugtan', 'repe', 'ripe', 'repaid', 'paid']);
const SOFT_PAY_WORDS = new Set(['pe', 'payment', 'pement']);
const KAR_WORDS = new Set(['karo', 'kar', 'karna', 'karde', 'kardo', 'karen', 'kijiye', 'make', 'do']);
const BLOCK_WORDS = new Set(['auto', 'autopay', 'mandate', 'emandate', 'upi', 'nach', 'payout', 'payouts', 'emi', 'commission', 'kyc', 'esign',
  'later', 'status', 'history', 'down', 'salary', 'incentive']);
const NEGATION_RE = /\b(?:don t|dont|do not|not|never|mat|nahi|nahin|na karo|cancel|stop)\b/;
const FULL_RE = /\b(?:full|all|poora|pura|poori|puri|pure|poore|sara|saara|sari|saari|total|entire|whole|everything|outstanding|complete|baki|baaki)\b/;
const TA_RE = /\b(?:ta|tie|t a|trade advance|trade|tranche|tranches|inf|inventory funding|inventory)\b/;

const repayAction = (extra: { amount?: number; full?: boolean } = {}) => ({ type: 'navigate', route: TA_ROUTE, filter: 'repay', sheet: 'repay', ...extra });

/** The TA utilised / outstanding the screen registered (field ta-repay), else undefined. */
export function taUtilised(fields: readonly VoiceField[] | undefined): number | undefined {
  const f = fields?.find((x) => x.id === TA_FIELD_ID);
  if (!f) return undefined;
  return f.utilised ?? f.max ?? (typeof f.value === 'number' ? f.value : undefined);
}

function taReply(text: string, confidence: number, body: Record<string, unknown>): CommandResponse {
  return parseResponse({ transcript: text, confidence, engine: 'device', method: 'ta_repay', matcher: 'field', ...body });
}

/**
 * "pay 80000" / "repay 80k" / "pay full" / "80 hazaar jama karo" / "poora chuka do" → TA_REPAY (always Confirm, never
 * auto; Confirm opens the repay sheet pre-filled). `amountTurn`: the last answer asked "How much?", so a bare amount
 * on TaInf is the repay amount. Null = not a repay.
 */
export function resolveTaRepay(text: string, screen: string | undefined, fields: readonly VoiceField[] | undefined, confidence = 1, amountTurn = false): CommandResponse | null {
  const norm = normalizeText(text ?? '');
  const toks = new Set(tokenize(norm));
  if (!toks.size) return null;
  const amt = findAmount(text);
  const amount = amt?.value;
  const onTa = screen === TA_ROUTE;
  const pay = [...toks].some((t) => PAY_WORDS.has(t)) || /\bpay (?:back|off)\b/.test(norm)
    || ([...toks].some((t) => SOFT_PAY_WORDS.has(t)) && (amount !== undefined || [...toks].some((t) => KAR_WORDS.has(t))) && !toks.has('down'));
  if (!pay && !(amountTurn && onTa && amount !== undefined)) return null;
  if ([...toks].some((t) => BLOCK_WORDS.has(t)) || NEGATION_RE.test(norm)) return null;
  const named = TA_RE.test(norm);
  const full = FULL_RE.test(norm);
  const utilised = taUtilised(fields);
  if (utilised !== undefined && utilised <= 0 && onTa) {
    return taReply(text, confidence, {
      intent: TA_REPAY_INTENT, score: 0.9, matchedPhrase: 'repay', action: { type: 'none' }, status: 'ok', slots: { repayNothing: true },
      responseText: REPAY_NOTHING_TEXT, confidenceBand: 'confirm', autoExecute: false, autoReason: 'ta_repay_nothing',
    });
  }
  let action: Record<string, unknown>;
  let slots: Record<string, unknown>;
  let line: string;
  if (amount !== undefined && amount > 0) {
    if (utilised !== undefined && amount > utilised) {
      const label = formatInr(utilised);
      return taReply(text, confidence, {
        intent: TA_REPAY_INTENT, score: 0.6, matchedPhrase: 'repay', action: { type: 'none' }, status: 'clarify', slots: { repayAmount: amount },
        responseText: `Repay the full ${label}?`, confidenceBand: 'clarify', autoExecute: false, autoReason: 'ta_repay_clarify',
        candidates: [{ intent: TA_REPAY_INTENT, phrase: `Repay the full ${label}`, score: 0.6, action: repayAction({ full: true, amount: utilised }),
          slots: { repayAll: true, repayAmount: utilised } }],
      });
    }
    action = repayAction({ amount });
    slots = { repayAmount: amount };
    line = `Repay ${formatInr(amount)} on ${FACILITY}?`;
  } else if (full) {
    action = repayAction({ full: true, ...(utilised ? { amount: utilised } : {}) });
    slots = { repayAll: true, ...(utilised ? { repayAmount: utilised } : {}) };
    line = utilised ? `Repay the full ${formatInr(utilised)} on ${FACILITY}?` : `Repay the full outstanding on ${FACILITY}?`;
  } else {
    if (!onTa && !named) return null;
    return taReply(text, confidence, {
      intent: TA_REPAY_INTENT, score: 0.6, matchedPhrase: 'repay', action: { type: 'none' }, status: 'retry', slots: { repayAsk: true },
      expectNext: 'amount', responseText: REPAY_ASK_TEXT, confidenceBand: 'retry', autoExecute: false, autoReason: 'ta_repay_retry',
    });
  }
  if (!onTa && !named) {
    return taReply(text, confidence, {
      intent: TA_REPAY_INTENT, score: 0.6, matchedPhrase: 'repay', action: { type: 'none' }, status: 'clarify', responseText: line,
      confidenceBand: 'clarify', autoExecute: false, autoReason: 'ta_repay_clarify',
      candidates: [{ intent: TA_REPAY_INTENT, phrase: line.replace(/\?$/, ''), score: 0.6, action, slots }],
    });
  }
  return taReply(text, confidence, {
    intent: TA_REPAY_INTENT, score: 0.9, matchedPhrase: 'repay', action, slots, status: 'ok', responseText: line,
    confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive',
  });
}

// ---- ENHANCE_TA_LIMIT (mirror of the server's src/enhance.py resolve) -------------------------------------------

export const ENHANCE_FIELD_ID = 'enhance-amount';
export const ENHANCE_SHEET = 'enhance';
const ENH_WORD_RE = /\b(?:enhance|enhanced|enhancement|enhancements|enhans|inhance|enhanse)\b/;
const LIMIT_WORD_RE = /\blimits?\b/;
const ENH_VERB_RE = /\b(?:increase|raise|extend|badhao|badha|badhana|barhao|barha|barhana|badhaiye|barhaiye|badhwa|barhwa|zyada|jyada|badhani|barhani|karo|kar do|kardo|set|make|chahiye|need|want|to|new)\b/;
const ENH_LOAN_RE = /\b(?:loan|lone|emi|down payment|tenure)\b/;
const ENH_PAY_RE = /\b(?:pay|repay|repayment|jama|chuka|chukao|bharo|disburse|disbursal|drawdown|withdraw)\b/;
const ENH_NEG_RE = /\b(?:don t|dont|do not|not|never|mat|nahi|nahin|cancel|stop)\b/;
/** Reason concepts → words heard (server enhance.REASONS + the app's chips: More inventory, festive demand, New OEM). */
const REASON_WORDS: Readonly<Record<string, readonly string[]>> = {
  showroom: ['new showroom', 'showroom', 'new branch', 'branch', 'new outlet', 'outlet', 'expansion', 'expand', 'naya showroom', 'nayi dukaan', 'dukaan', 'shop', 'new store', 'store'],
  festive: ['festive season', 'festive', 'festival', 'festivals', 'diwali', 'dussehra', 'dusshera', 'navratri', 'eid', 'tyohar', 'tyohaar', 'wedding season', 'shaadi season', 'season', 'seasonal'],
  stock: ['more stock', 'stock', 'inventory', 'more inventory', 'more vehicles', 'more bikes', 'more cars', 'zyada stock', 'jyada stock', 'maal', 'stocking', 'new models', 'new launch'],
  oem: ['new oem', 'oem', 'new brand', 'another brand', 'second brand', 'new company'],
  other: ['other', 'something else', 'kuch aur'],
};
const REASON_LABEL: Readonly<Record<string, string>> = { showroom: 'New showroom', festive: 'Festive season', stock: 'More stock', oem: 'New OEM', other: 'Other' };
const escRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function reasonConcepts(norm: string): string[] {
  const hits: [number, string][] = [];
  for (const [concept, words] of Object.entries(REASON_WORDS)) {
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      if (new RegExp(`\\b${escRe(w)}\\b`).test(norm)) { hits.push([norm.indexOf(w), concept]); break; }
    }
  }
  return hits.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

export interface ReasonChip { id: string; kind: string; label: string; value?: string }

/** The reason said, as the sheet's chip (exact label first, then concept), or a concept when no chips. */
export function findReason(text: string, chips: readonly ReasonChip[]): ReasonChip | null {
  const norm = normalizeText(text ?? '');
  const said = reasonConcepts(norm);
  if (chips.length) {
    for (const c of chips) { const l = normalizeText(c.label); if (l && new RegExp(`\\b${escRe(l)}\\b`).test(norm)) return c; }
    for (const concept of said) for (const c of chips) if (reasonConcepts(normalizeText(c.label)).includes(concept) || normalizeText(c.id) === concept) return c;
    return null;
  }
  return said.length ? { id: said[0], kind: 'reason', label: REASON_LABEL[said[0]], value: said[0] } : null;
}

const isEnhancePhrase = (norm: string, hasAmount: boolean): boolean =>
  ENH_WORD_RE.test(norm) || (LIMIT_WORD_RE.test(norm) && (ENH_VERB_RE.test(norm) || hasAmount) && !ENH_LOAN_RE.test(norm));

const enhanceOption = (n: number) => ({ id: ENHANCE_FIELD_ID, kind: 'amount', label: formatInr(n), value: String(Math.round(n)) });

function enhReply(text: string, confidence: number, body: Record<string, unknown>): CommandResponse {
  return parseResponse({ transcript: text, confidence, engine: 'device', method: 'enhance', matcher: 'field', matchedPhrase: 'enhance my limit', ...body });
}

/**
 * "enhance my limit" / "limit badhao" / "I need an enhancement of 15 lakhs" / "enhance limit to 20 lakh" / "15 lakh
 * for the new showroom" (sheet open) — server enhance.resolve on the phone. Sheet not open (no `enhance-amount`
 * field): open it, carrying the amount / reason. Field registered: explicit → fill now (+ Undo, `advance`); bare →
 * "Set new limit to ₹X?"; under min → "Must be above your current ₹X. Set ₹Y?"; over cap → "… above the maximum …";
 * a reason alone selects the chip; "15" alone → "Say the full amount, like 15 lakh.". Never SET_LOAN_AMOUNT.
 */
export function resolveEnhance(text: string, screen: string | undefined, confidence = 1, fields?: readonly VoiceField[], options?: readonly { id: string; kind: string; label: string; value?: string }[], sheet?: string): CommandResponse | null {
  const norm = normalizeText(text ?? '');
  if (!norm || ENH_NEG_RE.test(norm) || ENH_PAY_RE.test(norm)) return null;
  const fld = fields?.find((f) => f.id === ENHANCE_FIELD_ID);
  const sheetOpen = !!fld || (sheet === ENHANCE_SHEET && screen === TA_ROUTE);
  const amt = findAmount(text);
  const amount = amt && amt.value >= 1000 ? amt.value : undefined;
  const explicit = isEnhancePhrase(norm, amount !== undefined);
  const chips = (options ?? []).filter((o) => o.kind === 'reason');
  const reason = explicit || sheetOpen ? findReason(text, chips) : null;
  if (!explicit && !sheetOpen) return null;
  if (fld && amount === undefined && amt && !reason) {
    return enhReply(text, confidence, { intent: ENHANCE_INTENT, score: 0.6, action: { type: 'none' }, status: 'retry', responseText: 'Say the full amount, like 15 lakh.',
      confidenceBand: 'retry', autoExecute: false, autoReason: 'enhance_amount_too_small' });
  }
  if (!explicit && amount === undefined && !reason) return null;
  if (!explicit && amount !== undefined && ENH_LOAN_RE.test(norm)) return null;
  const slots: Record<string, unknown> = reason ? { enhanceReason: reason.label, enhanceReasonId: reason.id } : {};
  const reasonTxt = reason ? ` Reason: ${reason.label}.` : '';
  if (!fld) {
    const action: Record<string, unknown> = { type: 'navigate', route: TA_ROUTE, filter: ENHANCE_SHEET, sheet: ENHANCE_SHEET };
    if (amount !== undefined) { action.amount = amount; slots.enhanceAmount = amount; }
    if (reason) action.reason = reason;
    const onTa = screen === TA_ROUTE;
    const line = amount !== undefined
      ? (onTa ? `Opening the limit enhancement form for ${formatInr(amount)}.` : `Opening Trade Advance to enhance your limit to ${formatInr(amount)}.`)
      : (onTa ? 'Opening the limit enhancement form.' : 'Opening Trade Advance to enhance your limit.');
    return enhReply(text, confidence, { intent: ENHANCE_INTENT, score: 0.95, action, ...(Object.keys(slots).length ? { slots } : {}), status: 'ok',
      responseText: line + reasonTxt, confidenceBand: 'auto', autoExecute: true, autoReason: 'enhance_sheet' });
  }
  if (amount === undefined) {
    if (reason) {
      return enhReply(text, confidence, { intent: 'SELECT_OPTION', score: 0.9, matchedPhrase: reason.label, action: { type: 'select', ...reason, value: reason.value ?? reason.id }, slots,
        status: 'ok', responseText: `Reason: ${reason.label}.`, confidenceBand: 'auto', autoExecute: true, autoReason: 'enhance_reason',
        candidates: [{ intent: 'SELECT_OPTION', phrase: reason.label, score: 0.9, option: reason }] });
    }
    const cur = typeof fld.value === 'number' && fld.value ? ` It is ${formatInr(fld.value)} now.` : '';
    return enhReply(text, confidence, { intent: ENHANCE_INTENT, score: 0.7, action: { type: 'none' }, status: 'retry', responseText: `Say the new limit, like 15 lakh.${cur}`,
      confidenceBand: 'retry', autoExecute: false, autoReason: 'enhance_amount_missing' });
  }
  const value = roundToStep(amount, fld.step);
  slots.enhanceAmount = value;
  const clamp = clampOffer(value, fld);
  if (clamp) {
    const [side, limit] = clamp;
    const current = fld.current ?? (fld.min !== undefined ? fld.min - (fld.step ?? 0) : undefined);
    const spoken = side === 'under'
      ? `${current ? `Must be above your current ${formatInr(current)}.` : `${formatInr(value)} is below the minimum of ${formatInr(limit)}.`} Set ${formatInr(limit)}?`
      : `${formatInr(value)} is above the maximum of ${formatInr(limit)}. Set ${formatInr(limit)}?`;
    slots.enhanceLimit = limit;
    return enhReply(text, confidence, { intent: ENHANCE_INTENT, score: 0.6, matchedPhrase: `Set new limit to ${formatInr(limit)}`, action: { type: 'none' }, slots, status: 'clarify',
      responseText: spoken, confidenceBand: 'clarify', autoExecute: false, autoReason: side === 'over' ? 'enhance_over_max' : 'enhance_under_min',
      candidates: [{ intent: ENHANCE_INTENT, phrase: `Set new limit to ${formatInr(limit)}`, score: 0.6, option: enhanceOption(limit), slots: { ...slots, enhanceAmount: limit } }] });
  }
  const action: Record<string, unknown> = { type: 'select', ...enhanceOption(value) };
  if (typeof fld.value === 'number') action.previous = String(Math.round(fld.value));
  if (reason) action.reason = reason;
  if (explicit) action.advance = true;
  return enhReply(text, confidence, { intent: ENHANCE_INTENT, score: explicit ? 0.95 : 0.8, matchedPhrase: `Set new limit to ${formatInr(value)}`, action, slots, status: 'ok',
    responseText: (explicit ? `New limit set to ${formatInr(value)}.` : `Set new limit to ${formatInr(value)}?`) + reasonTxt,
    confidenceBand: explicit ? 'auto' : 'confirm', autoExecute: explicit, autoReason: explicit ? 'enhance_amount' : 'enhance_amount_bare',
    candidates: [{ intent: ENHANCE_INTENT, phrase: `Set new limit to ${formatInr(value)}`, score: explicit ? 0.95 : 0.8, option: enhanceOption(value) }] });
}

// ---- SET_DRAWDOWN_AMOUNT (TA DisburseSheet amount step; mirror of the server's src/drawdown.py) ---------------------

export const DRAWDOWN_FIELD_ID = 'drawdown-amount';
export const DRAWDOWN_INTENT = 'SET_DRAWDOWN_AMOUNT';
const DD_NEG_RE = /\b(?:don t|dont|do not|not|never|mat|nahi|nahin|cancel|stop)\b/i;
const DD_OTHER_RE = /\b(?:repay|pay|limit|enhance|enhancement|loan|emi|tenure|down payment)\b/i;
const drawdownOption = (n: number) => ({ id: DRAWDOWN_FIELD_ID, kind: 'amount', label: formatInr(n), value: String(Math.round(n)) });

/**
 * With the drawdown amount step open (field `drawdown-amount`): "2 lakh" / "disburse 2 lakh" / "draw 80000" → fill at
 * once (auto + Undo, `advance`: go on to the confirm step); over available / under min → "… Set ₹X?" (no fill).
 * Null without the field or for repay / limit / loan words.
 */
export function resolveDrawdown(text: string, fields: readonly VoiceField[] | undefined, confidence = 1): CommandResponse | null {
  const fld = fields?.find((f) => f.id === DRAWDOWN_FIELD_ID);
  const t = text ?? '';
  if (!fld || !t.trim() || DD_NEG_RE.test(t) || DD_OTHER_RE.test(t)) return null;
  const amt = findAmount(t);
  if (!amt || amt.value < 1000) return null;
  const value = roundToStep(amt.value, fld.step);
  const base = { transcript: t, confidence, engine: 'device', method: 'drawdown', matcher: 'field' };
  const clamp = clampOffer(value, fld);
  if (clamp) {
    const [side, limit] = clamp;
    const spoken = side === 'over' ? `${formatInr(value)} is above your available ${formatInr(limit)}. Set ${formatInr(limit)}?`
      : `${formatInr(value)} is below the minimum of ${formatInr(limit)}. Set ${formatInr(limit)}?`;
    return parseResponse({ ...base, intent: DRAWDOWN_INTENT, score: 0.6, matchedPhrase: `Set ${formatInr(limit)}`, action: { type: 'none' },
      slots: { drawdownAmount: value }, status: 'clarify', responseText: spoken, confidenceBand: 'clarify', autoExecute: false,
      autoReason: side === 'over' ? 'drawdown_over_max' : 'drawdown_under_min',
      candidates: [{ intent: DRAWDOWN_INTENT, phrase: `Set ${formatInr(limit)}`, score: 0.6, option: drawdownOption(limit) }] });
  }
  return parseResponse({ ...base, intent: DRAWDOWN_INTENT, score: 0.95, matchedPhrase: `Set ${formatInr(value)}`,
    action: { type: 'select', ...drawdownOption(value), advance: true, ...(typeof fld.value === 'number' && fld.value ? { previous: String(fld.value) } : {}) },
    slots: { drawdownAmount: value }, status: 'ok', responseText: `Drawdown amount set to ${formatInr(value)}.`, confidenceBand: 'auto', autoExecute: true,
    autoReason: 'drawdown_amount', candidates: [{ intent: DRAWDOWN_INTENT, phrase: `Set ${formatInr(value)}`, score: 0.95, option: drawdownOption(value) }] });
}
