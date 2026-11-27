/**
 * v1.4.5 S2.4 RC number on RcPendency — phone mirror of the server's src/rc_reg.py rc_override / update_rc_guard.
 *
 * RC turn (`expect:'reg'`, or the RC entry sheet open: sheet 'rc-entry' / field 'vehicle-reg'):
 *   valid plate                 → SET_RC_NUMBER fill (auto): the Registration number is filled, read back
 *                                 ("M H twelve B C one two six zero."); "submit MH12BC1260" → voice-confirm submit
 *   unknown state / bad shape   → retry with the spoken correction, nothing filled
 *   digits only ("double one")  → "Say the full RC number, like M H 12 A B 1234." — never an OTP / number
 * Any other screen: a valid plate → "RC number M H twelve …?" (Confirm). "Submit" / "proceed" after a number are the
 * registered rc-submit step (voiceStep.resolveAdvance). "I want to update Vikram Rao's RC" opens that row (rows on
 * screen) or RcPendency with the name — never Start new loan. Pure: no React Native imports.
 */
import { matchCustomer } from './customerMatch';
import { DEFAULT_STATE, parseRc, STATE_CODES } from './rcParse';
import { parseResponse } from './sttClient';
import type { CommandContext, CommandResponse } from './types';
import { isAdvancePhrase } from './voiceStep';

export const RC_INTENT = 'SET_RC_NUMBER';
export const RC_FIELD_ID = 'vehicle-reg';
export const RC_ROUTE = 'RcPendency';
export const RC_SHEET = 'rc-entry';
export const RC_SUBMIT = 'rc-submit';

type Ctx = Pick<CommandContext, 'screen' | 'expect' | 'fields' | 'options' | 'context'>;

/** context.dealerState / stateCode (valid state code) else MH. */
export function dealerStateOf(ctx: Pick<CommandContext, 'context'>): string {
  const c = ctx.context ?? {};
  for (const v of [c.dealerState, c.stateCode]) {
    if (typeof v === 'string' && STATE_CODES.has(v.trim().toUpperCase().slice(0, 2))) return v.trim().toUpperCase().slice(0, 2);
  }
  return DEFAULT_STATE;
}

export function isRcTurn(ctx: Ctx): boolean {
  if (ctx.expect === 'reg') return true;
  const route = ctx.context?.route ?? ctx.screen;
  if (route !== RC_ROUTE) return false;
  return ctx.context?.sheet === RC_SHEET || !!ctx.fields?.some((f) => f.id === RC_FIELD_ID || f.kind === 'reg');
}

function customerOf(ctx: Ctx): { name?: string; lan?: string } {
  const c = ctx.context?.customer as { name?: string; lan?: string } | undefined;
  return { name: c?.name, lan: c?.lan };
}

function rcReply(text: string, confidence: number, body: Record<string, unknown>): CommandResponse {
  return parseResponse({ transcript: text, confidence, engine: 'device', method: 'rc_reg', matcher: 'field', matchedPhrase: 'rc number', ...body });
}

const SUBMIT_TOKEN_RE = /\b(?:submit|proceed|sabmit|verify|send)\b/i;
const DIGITISH_RE = /\d|[०-९]|\b(?:double|triple|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|paanch|saat|aath|nau)\b/i;

/** "Submit MH12BC1260 for Vikram Rao?" — the voice-confirmed press of the RC sheet's Submit. */
export function rcSubmitCommand(text: string, reg: string, ctx: Ctx, confidence = 1): CommandResponse {
  const c = customerOf(ctx);
  return rcReply(text, confidence, {
    intent: 'ADVANCE', score: 0.95, matchedPhrase: 'submit', method: 'advance',
    action: { type: 'advance', route: RC_ROUTE, sheet: RC_SHEET, cta: RC_SUBMIT, destructive: true, reg, ...(c.lan ? { customerLan: c.lan } : {}) },
    slots: { rcNumber: reg, ...(c.lan ? { customerLan: c.lan } : {}) }, status: 'ok',
    responseText: `Submit ${reg}${c.name ? ` for ${c.name}` : ' for verification'}?`, confidenceBand: 'confirm', autoExecute: false, autoReason: 'advance_destructive', voiceConfirm: true,
  });
}

/** The RC reading of `text` (see the header), or null (other readers decide). */
export function resolveRc(text: string, ctx: Ctx, confidence = 1): CommandResponse | null {
  if (!text?.trim() || ctx.expect === 'otp') return null;
  const p = parseRc(text, dealerStateOf(ctx));
  const onSheet = isRcTurn(ctx);
  const c = customerOf(ctx);
  if (p?.kind === 'valid') {
    const field = { type: 'VEHICLE_REG', value: p.value, valid: true, readBack: p.readBack, display: p.display };
    if (onSheet && SUBMIT_TOKEN_RE.test(text)) return { ...rcSubmitCommand(text, p.value, ctx, confidence), normalizedFields: [field] } as CommandResponse;
    return rcReply(text, confidence, {
      intent: RC_INTENT, score: 0.95,
      action: { type: 'fill', field: RC_FIELD_ID, value: p.value, display: p.display, ...(c.lan ? { customerLan: c.lan } : {}) },
      slots: { rcNumber: p.value, ...(p.snappedFrom ? { rcSnappedFrom: p.snappedFrom } : {}) }, status: 'ok',
      responseText: onSheet ? `${p.readBack}.` : `RC number ${p.readBack}?`, normalizedFields: [field],
      confidenceBand: onSheet ? 'auto' : 'confirm', autoExecute: onSheet, autoReason: onSheet ? 'rc_number' : 'rc_number_off_sheet',
    });
  }
  if (!onSheet) return null;
  if (p) {
    return rcReply(text, confidence, { intent: RC_INTENT, score: 0.5, action: { type: 'none' }, status: 'retry', responseText: p.error,
      normalizedFields: [{ type: 'VEHICLE_REG', value: '', valid: false, readBack: p.error, display: '' }],
      confidenceBand: 'retry', autoExecute: false, autoReason: `rc_${p.kind}` });
  }
  if (DIGITISH_RE.test(text) && !isAdvancePhrase(text)) {
    return rcReply(text, confidence, { intent: RC_INTENT, score: 0.5, action: { type: 'none' }, status: 'retry', responseText: 'Say the full RC number, like M H 12 A B 1234.',
      confidenceBand: 'retry', autoExecute: false, autoReason: 'rc_bad_shape' });
  }
  return null;
}

const RC_WORD_RE = /\b(?:rc|r c|registration|reg)\b|आरसी/i;
const UPDATE_RE = /\b(?:update|upload|enter|fill|add|edit|open|submit|change|daalo|dalo|bharo|karo)\b/i;
const NAME_STOP = new Set(['i', 'want', 'to', 'update', 'upload', 'the', 'rc', 'of', 'for', 's', 'please', 'open', 'enter', 'add', 'registration', 'number', 'reg',
  'ka', 'ki', 'ke', 'karo', 'karna', 'hai', 'mujhe', 'my', 'customer', 'edit', 'fill', 'change', 'need', 'is', 'a', 'an', 'photo', 'details', 'do', 'it', 'daalo',
  'dalo', 'r', 'c', 'submit', 'bharo']);
const STEAL: ReadonlySet<string> = new Set(['START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'CHANGE_DOWN_PAYMENT', 'UNKNOWN', 'UPLOAD_RC', 'SHOW_RC_PENDENCY', 'NEW_TWO_WHEELER_LOAN', 'SEARCH_CUSTOMER']);

/** "update" / "upload" / "open" / "daalo" … (a row verb). */
export const hasUpdateVerb = (text: string): boolean => UPDATE_RE.test(text ?? '');

/** The customer name in "I want to update Vikram Rao's RC" (1–3 words), else null. */
export function updateRcName(text: string): string | null {
  if (!RC_WORD_RE.test(text ?? '') || !UPDATE_RE.test(text ?? '')) return null;
  const words = ((text ?? '').toLowerCase().replace(/['’]s\b/g, ' ').match(/[a-z]+/g) ?? []).filter((w) => !NAME_STOP.has(w));
  if (words.length < 1 || words.length > 3) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * "I want to update Vikram Rao's RC" / "update Vikram Rao's RC" is never a new loan / down payment: rows on screen →
 * null (the caller's customer matcher opens the row); no rows → open RcPendency with the name. Null = not that.
 */
export function updateRcGuard(text: string, cmd: CommandResponse, ctx: Ctx): CommandResponse | null {
  if (cmd.intent === 'SELECT_OPTION' || !STEAL.has(cmd.intent)) return null;
  const name = updateRcName(text);
  if (!name) return null;
  if (ctx.options?.some((o) => o.kind === 'customer') && matchCustomer(text, ctx.options)) return null;
  return parseResponse({ transcript: text, confidence: cmd.confidence, engine: cmd.engine ?? 'device', method: 'rc_reg', matcher: 'guard', intent: 'SHOW_RC_PENDENCY',
    score: 0.8, matchedPhrase: 'update RC', action: { type: 'navigate', route: RC_ROUTE, customerName: name }, slots: { customerName: name }, status: 'ok',
    responseText: `Open ${name}'s RC?`, confidenceBand: 'auto', autoExecute: true, autoReason: 'rc_customer_by_name' });
}
