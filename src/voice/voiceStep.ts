/**
 * v1.4.5 S2 ADVANCE ("proceed", "continue", "next", "go ahead", "aage chaliye", "aage badho", "आगे चलिए", …):
 * a context-sensitive step press. Each screen / sheet REGISTERS what "advance" does on it (its CTA: id, label,
 * destructive, enabled, hint, press). Nothing registered → "Nothing to continue here." — never Go home, Enhance or
 * Change tenure.
 *
 *   plain step (Proceed / Continue / Get OTP)          → press now (the screen's own isAdvancing guard applies)
 *   destructive step (Send request / Pay / Submit / …)  → SPOKEN confirm ("Send request?"): a voice "yes" presses it
 *   cta.enabled false                                  → the step's hint ("Pick a reason first."), no press
 *
 * The registration is also sent to the server as `context.sheet / step / cta` (+ extras such as `customer`, `tab`,
 * `dealerState`), CONTRACT.md "S2.0". The grammar below mirrors the server's src/advance.py so the phone decides
 * the same offline. Pure module: no React / React Native imports (unit-tested in Node).
 */
import { parseResponse } from './sttClient';
import type { CommandResponse, StepCta, VoiceAction } from './types';
import { transliterateDevanagari } from './voiceNormalize';

export const ADVANCE_INTENT = 'ADVANCE';
export const CONTINUE_TEXT = 'Continuing.';
export const BLOCKED_TEXT = 'Complete this step first.';
export const NEGATED_TEXT = 'Okay, staying here.';
export const NOTHING_TEXT = 'Nothing to continue here.';

/** One pressable step control, with the code its button runs. */
export interface StepControl extends StepCta {
  /** The SAME function the on-screen button calls. */
  press: () => void;
  /** Spoken question for a destructive press ("Submit MH12BC1260 for Vikram Rao?"); default `${label}?`. */
  confirmPrompt?: string;
}

/** What a screen / sheet registers. `cta` absent = context only (tab, dealerState, …), no advance. */
export interface VoiceStepSpec {
  route: string;
  sheet?: string;
  step?: string;
  cta?: StepControl;
  /** Other CTAs a submit word may press on this step (the enhance amount step's final "Send request"). */
  alts?: StepControl[];
  /** Extra request context (`customer`, `tab`, `dealerState`, `regNo`, `amount`, …). */
  extra?: Record<string, unknown>;
}

let regs: { owner: number; spec: VoiceStepSpec }[] = [];
let nextOwner = 1;

/** Register a step (the newest registration with a CTA wins; extras merge). Returns a token for clearVoiceStep. */
export function setVoiceStep(spec: VoiceStepSpec): number {
  const owner = nextOwner++;
  regs = [...regs, { owner, spec }];
  return owner;
}

export function clearVoiceStep(token?: number): void {
  regs = token === undefined ? [] : regs.filter((r) => r.owner !== token);
}

/** The merged step for `route` (sheet / step / cta from the newest registration that has them). */
export function getVoiceStep(route: string | undefined): VoiceStepSpec | null {
  if (!route) return null;
  const mine = regs.filter((r) => r.spec.route === route).map((r) => r.spec);
  if (!mine.length) return null;
  const out: VoiceStepSpec = { route, extra: {} };
  for (const s of mine) {
    if (s.extra) out.extra = { ...out.extra, ...s.extra };
    if (s.sheet !== undefined || s.cta) { out.sheet = s.sheet; out.step = s.step; out.cta = s.cta; out.alts = s.alts; }
  }
  if (out.extra && !Object.keys(out.extra).length) delete out.extra;
  return out;
}

/** The `context` keys sent with /command for this step (CONTRACT.md S2.0). Never the press functions. */
export function stepContext(step: VoiceStepSpec | null): Record<string, unknown> {
  if (!step) return {};
  const cta = step.cta ? ctaOf(step.cta) : undefined;
  return { ...(step.extra ?? {}), ...(step.sheet ? { sheet: step.sheet } : {}), ...(step.step ? { step: step.step } : {}), ...(cta ? { cta } : {}) };
}

const ctaOf = (c: StepControl): StepCta => ({ id: c.id, label: c.label, destructive: !!c.destructive, enabled: c.enabled !== false, ...(c.hint ? { hint: c.hint } : {}) });

// ---- grammar (mirror of the server's src/advance.py) ----------------------------------------------------------------

const A = '(?:aage|aagey|aagay|age|aghe|aange|agey)';
const CHAL = '(?:chaliye|chaliyeh|chalie|chaliae|chaliya|chalye|chaliyega|chalen|chalein|chale|chalo|chalte|chaliyo|chalo ji)';
const BADH = '(?:badho|badhiye|badhie|badhe|badhen|badhein|barho|barhiye|barhie|barhe|barhen|badhao|barhao|badhaiye)';
const ADVANCE_CORE = [
  'proceed(?: further| ahead)?', 'continue', 'next(?: step| page| screen| one)?', 'go (?:ahead|on|forward|next)',
  'move (?:ahead|on|forward|next)', 'carry on', 'keep going', 'go to (?:the )?next(?: step| page| screen)?',
  `${A} ${CHAL}`, `${A} ${BADH}`, `${CHAL} ${A}`, `${BADH} ${A}`, `${A} (?:jao|jaiye|jaie|chal)`,
  'agla(?: step| page)?', 'agle (?:step|page) (?:par|pe) (?:chalo|chaliye|jao)',
];
const FILLER = '(?:please|plz|kripya|ji|jee|now|ok|okay|haan|han|ha|ab|to|then|lets|let s|let us|bhai|sir|madam|yaar|'
  + 'and|so|right|alright|fine|theek hai|thik hai|achha|accha|acha|chalo)';
const ADVANCE_RE = new RegExp(`^(?:${FILLER}\\s+)*(?:${ADVANCE_CORE.join('|')})(?:\\s+${FILLER})*$`);
const NEG_RE = /\b(?:don t|dont|do not|not|never|mat|nahi|nahin|na|stop|wait|ruko|ruk|cancel|no)\b/;
const NEG_ADVANCE_RE = new RegExp(`(?:${ADVANCE_CORE.join('|')})`);
const SUBMIT_RE = new RegExp('^(?:(?:please|ok|okay|haan|han|ji|now|ab|then)\\s+)*(?:'
  + 'confirm|confirm it|confirm and (?:start|go to) kyc|submit|submit it|submit (?:the )?request|send(?: the)? request|'
  + 'send it|send|request bhejo|bhej do|bhejo|sabmit|sabmit karo|submit karo|submit kar do|confirm karo|'
  + 'confirm kar do|kanfrm|kanfrm karo|disburse|disburse it|disbursal|disbursement|confirm disburse|'
  + 'confirm disbursal|pay|pay now|pay it|pay karo|pay kar do|pe karo|pe kar do|start kyc|go to kyc|kyc start karo|'
  + 'kyc shuru karo|start the kyc|begin kyc|done|ho gaya|kar do|kardo'
  + ')(?:\\s+(?:please|ji|now|karo|kar do|do))*$');
const YES_RE = /^(?:(?:ok|okay|haan|han|ha|ji|yes|yeah|yep|sure|theek hai|thik hai|achha|accha|haan ji|han ji)\s*)+$/;

/** Server advance.clean(): transliterated, lowercase, letters / digits / spaces only. */
export function cleanAdvance(text: string): string {
  return transliterateDevanagari(text ?? '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const isAdvancePhrase = (text: string): boolean => ADVANCE_RE.test(cleanAdvance(text));
export const isNegatedAdvance = (text: string): boolean => {
  const s = cleanAdvance(text);
  return NEG_ADVANCE_RE.test(s) && NEG_RE.test(s) && s.split(' ').length <= 6;
};
export const isSubmitWord = (text: string): boolean => SUBMIT_RE.test(cleanAdvance(text));
export const isYesWord = (text: string): boolean => YES_RE.test(cleanAdvance(text));

export const isAdvanceCommand = (cmd: CommandResponse): boolean => cmd.intent === ADVANCE_INTENT || cmd.action.type === 'advance';
/** ADVANCE, or the advance grammar's own "Okay, staying here." / "Complete this step first." replies. */
export const isAdvanceReply = (cmd: CommandResponse): boolean =>
  isAdvanceCommand(cmd) || cmd.autoReason === 'advance_negated' || cmd.autoReason === 'advance_blocked';

const spokenLabel = (label: string): string => (label ?? '').replace(/&/g, 'and').replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim();

function reply(text: string, body: Record<string, unknown>): CommandResponse {
  return parseResponse({ transcript: text, confidence: 1, engine: 'device', method: 'advance', matcher: 'keyword', score: 0.95, matchedPhrase: 'proceed', ...body });
}

/** The command for pressing `cta` (auto for a plain step, voice-confirm for a destructive one, retry when disabled). */
function pressCommand(text: string, step: Pick<VoiceStepSpec, 'route' | 'sheet' | 'step'>, cta: StepCta, phrase: string): CommandResponse {
  if (cta.enabled === false) {
    return reply(text, { intent: 'UNKNOWN', score: 0.6, matchedPhrase: phrase, action: { type: 'none' }, status: 'retry', responseText: cta.hint || BLOCKED_TEXT,
      confidenceBand: 'retry', autoExecute: false, autoReason: 'advance_blocked' });
  }
  const action = { type: 'advance', route: step.route, ...(step.sheet ? { sheet: step.sheet } : {}), ...(step.step ? { step: step.step } : {}), cta: cta.id, ...(cta.destructive ? { destructive: true } : {}) };
  if (cta.destructive) {
    return reply(text, { intent: ADVANCE_INTENT, matchedPhrase: phrase, action, status: 'ok', responseText: `${spokenLabel(cta.label)}?`,
      confidenceBand: 'confirm', autoExecute: false, autoReason: 'advance_destructive' });
  }
  return reply(text, { intent: ADVANCE_INTENT, matchedPhrase: phrase, action, status: 'ok', responseText: CONTINUE_TEXT,
    confidenceBand: 'auto', autoExecute: true, autoReason: 'advance' });
}

/**
 * The phone's reading of an advance / submit / negated-advance utterance on the registered step (server
 * advance_override without the session: a pending voice-confirm is answered on the phone by voiceAsk). Null = not
 * an advance utterance (the other readers decide). An advance phrase with NOTHING registered is still an ADVANCE
 * (decideAdvance answers "Nothing to continue here."), never the command list's Go home / Enhance / tenure.
 */
export function resolveAdvance(text: string, step: VoiceStepSpec | null): CommandResponse | null {
  const s = cleanAdvance(text);
  if (!s) return null;
  if (isNegatedAdvance(s)) {
    return reply(text, { intent: 'UNKNOWN', action: { type: 'none' }, status: 'ok', responseText: NEGATED_TEXT, confidenceBand: 'auto', autoExecute: false, autoReason: 'advance_negated' });
  }
  const where = { route: step?.route ?? '', sheet: step?.sheet, step: step?.step };
  if (ADVANCE_RE.test(s)) {
    if (!step?.cta) return reply(text, { intent: ADVANCE_INTENT, action: { type: 'advance' }, status: 'ok', responseText: CONTINUE_TEXT, confidenceBand: 'auto', autoExecute: true, autoReason: 'advance' });
    return pressCommand(text, where, step.cta, 'proceed');
  }
  if (!step) return null;
  if (step.cta?.destructive && (SUBMIT_RE.test(s) || (YES_RE.test(s) && step.sheet))) return pressCommand(text, where, step.cta, 'submit');
  const final = step.alts?.find((a) => a.destructive);
  if (final && SUBMIT_RE.test(s)) return pressCommand(text, where, final, 'submit');
  return null;
}

/** The command list picked ADVANCE from a longer sentence that is not an advance phrase: say again (server matcher_guard). */
export function advanceMatcherGuard(text: string, cmd: CommandResponse): CommandResponse {
  if (cmd.intent !== ADVANCE_INTENT || cmd.method === 'advance') return cmd;
  if (isNegatedAdvance(text)) {
    return reply(text, { intent: 'UNKNOWN', action: { type: 'none' }, status: 'ok', responseText: NEGATED_TEXT, confidenceBand: 'auto', autoExecute: false, autoReason: 'advance_negated' });
  }
  if (isAdvancePhrase(text)) return { ...cmd, action: cmd.action.type === 'advance' ? cmd.action : { type: 'advance' } };
  return reply(text, { intent: 'UNKNOWN', score: 0.6, action: { type: 'none' }, status: 'retry', responseText: 'Sorry, say that again.', confidenceBand: 'retry', autoExecute: false, autoReason: 'advance_not_alone' });
}

export type AdvanceDecision =
  | { kind: 'press'; control: StepControl; text: string }
  | { kind: 'confirm'; control: StepControl; prompt: string }
  | { kind: 'blocked'; text: string }
  | { kind: 'nothing'; text: string };

/**
 * What an ADVANCE command does on the registered step. The phone's registration is the truth (the server may have
 * used a default CTA): the CTA the server named is looked up among the step's controls, else the step's own CTA.
 * `confirmed` (the server already heard the spoken yes) presses a destructive CTA at once.
 */
export function decideAdvance(cmd: CommandResponse, step: VoiceStepSpec | null): AdvanceDecision {
  if (cmd.autoReason === 'advance_negated') return { kind: 'nothing', text: cmd.responseText || NEGATED_TEXT };
  if (cmd.autoReason === 'advance_blocked') return { kind: 'blocked', text: cmd.responseText || BLOCKED_TEXT };
  const a = cmd.action as Extract<VoiceAction, { type: 'advance' }> | { type: string };
  const named = a.type === 'advance' ? (a as Extract<VoiceAction, { type: 'advance' }>).cta : undefined;
  const controls = step?.cta ? [step.cta, ...(step.alts ?? [])] : [];
  const c = (named && controls.find((x) => x.id === named)) || step?.cta;
  if (!c) return { kind: 'nothing', text: NOTHING_TEXT };
  if (c.enabled === false) return { kind: 'blocked', text: c.hint || BLOCKED_TEXT };
  const confirmed = a.type === 'advance' && (a as Extract<VoiceAction, { type: 'advance' }>).confirmed === true;
  if (c.destructive && !confirmed) {
    const server = cmd.autoReason === 'advance_destructive' ? cmd.responseText : undefined;
    // The plate said WITH the submit word is newer than the registered prompt ("Submit MH12BC1260 for Vikram Rao?").
    const withReg = a.type === 'advance' && (a as Extract<VoiceAction, { type: 'advance' }>).reg ? server : undefined;
    return { kind: 'confirm', control: c, prompt: withReg || c.confirmPrompt || (cmd.engine !== 'device' ? server : undefined) || `${spokenLabel(c.label)}?` };
  }
  return { kind: 'press', control: c, text: c.destructive ? 'Done.' : CONTINUE_TEXT };
}
