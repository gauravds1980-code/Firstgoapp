/**
 * v1.4.6 Money in flight by voice. Pure (no React Native): unit-tested in Node (voice/__tests__/moneyVoice.test.ts).
 *
 * The phone decides these on its own, at once and offline, from the recogniser's text (useVoiceCommand.handleText) —
 * so they work even when the 8793 server still runs an older command list. A server / Whisper answer with one of the
 * MIF intents (firstgo-voice-local commands.md) lands in the same place (useVoiceCommand.deliver), and the name is
 * read from the transcript by the same parser, so both paths answer the same.
 *
 *   "mera paisa kahan hai" / "where is my money" / "money in flight"     → SHOW_MONEY_IN_FLIGHT (list, all in flight)
 *   "kaunsi file atki hai" / "which file is stuck" / "stuck files"       → SHOW_STUCK_FILES (list, Stuck filter)
 *   "aaj kitna credit hua" / "today's credits"                           → SHOW_TODAYS_CREDITS (list, Credited filter)
 *   "Ramesh ka paisa aaya?" / "has Ramesh's money come" / "Pooja ki file kahan hai" → SHOW_FILE_MONEY_STATUS (sheet)
 *   "raise a query" / "query raise karo"                                 → RAISE_QUERY (QuerySheet)
 * "proceed" / "aage chaliye" are never read here (ADVANCE is decided before this, voiceStep.ts).
 * Replies are English (spoken with Piper); Hinglish is only in the trigger phrases.
 */
import { customerOptions, matchCustomer } from './customerMatch';
import { parseResponse } from './sttClient';
import type { CommandResponse } from './types';
import { transliterateDevanagari, isDevanagari } from './voiceNormalize';
import {
  fileStatusLine, isOverdue, MIF_NOT_AVAILABLE, MifFile, MifFilter, MIF_NOW, sortFiles, stuckLine, summaryLine, todayLine, visibleFiles,
} from '../services/moneyInFlight';

export const MIF_INTENTS = ['SHOW_MONEY_IN_FLIGHT', 'SHOW_STUCK_FILES', 'SHOW_TODAYS_CREDITS', 'SHOW_FILE_MONEY_STATUS', 'RAISE_QUERY'] as const;
export type MifIntent = (typeof MIF_INTENTS)[number];
export type MoneyQueryKind = 'list' | 'stuck' | 'today' | 'file' | 'query';
export interface MoneyQuery { kind: MoneyQueryKind; intent: MifIntent; name?: string }

const KIND_INTENT: Record<MoneyQueryKind, MifIntent> = {
  list: 'SHOW_MONEY_IN_FLIGHT', stuck: 'SHOW_STUCK_FILES', today: 'SHOW_TODAYS_CREDITS', file: 'SHOW_FILE_MONEY_STATUS', query: 'RAISE_QUERY',
};
const INTENT_KIND: Record<MifIntent, MoneyQueryKind> = {
  SHOW_MONEY_IN_FLIGHT: 'list', SHOW_STUCK_FILES: 'stuck', SHOW_TODAYS_CREDITS: 'today', SHOW_FILE_MONEY_STATUS: 'file', RAISE_QUERY: 'query',
};
export const isMifIntent = (intent: string | undefined): intent is MifIntent => !!intent && (MIF_INTENTS as readonly string[]).includes(intent);

/** Lower-case ASCII words (Devanagari transliterated, apostrophes kept as "'s" → " s"). */
export function mifNorm(text: string): string {
  let t = (text ?? '').normalize('NFC');
  if (isDevanagari(t)) t = transliterateDevanagari(t);
  return t.toLowerCase().replace(/[’`]/g, "'").replace(/'s\b/g, ' s').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Word families (Hinglish spellings the recogniser produces).
const PAISA = '(?:paisa|paise|paisaa|pesa|paysa|money|payment|amount|loan amount|credit)';
const KAHAN = '(?:kahan|kahaan|kaha|kahan par|where)';
const AAYA = '(?:aaya|aya|aayaa|aa gaya|aagaya|agaya|aaya kya|aya kya|aa gaya kya|credit hua|credited|hua)';
const FILE = '(?:file|files|case|cases|loan)';
const ATKI = '(?:atki|atka|atke|atak|atki hui|stuck|ruki|ruka|phansi|fasi|fansi)';
/** Stuck questions name a FILE ("which cases are overdue" stays SHOW_OVERDUE_CASES). */
const SFILE = '(?:file|files|fail|fyle)';

const LIST_RES: RegExp[] = [
  new RegExp(`\\b(?:mera|meraa|hamara|apna|my)?\\s*${PAISA}\\s+${KAHAN}\\b`),
  /\bwhere (?:is|s) (?:my|the|our) (?:money|payment|loan money|paisa)\b/,
  /\bwhere s my money\b/,
  /\bmoney in (?:flight|flite|fly)\b/,
  /\b(?:show|open|dikhao|kholo)?\s*(?:my )?pending credits?\b/,
  /\bpending credits? (?:dikhao|show|batao)\b/,
  /\bpaisa kab aayega\b/,
];
const STUCK_RES: RegExp[] = [
  new RegExp(`\\b(?:kaunsi|kaun si|konsi|kon si|kaunse|kaun se|which)\\s+${SFILE}\\s+(?:is |are )?${ATKI}\\b`),
  new RegExp(`\\b${SFILE}\\s+(?:kahan|kaha)?\\s*${ATKI}\\s+(?:hai|hain|he)\\b`),
  /\b(?:show |dikhao |open )?(?:my )?stuck files?\b/,
  /\boverdue files?(?: dikhao| show)?\b/,
  /\bwhich (?:file|files) (?:is|are) (?:stuck|overdue|held up|on hold)\b/,
  /\bkya atka hai\b/,
];
const TODAY_RES: RegExp[] = [
  /\baaj (?:kitna|kitne|kitni) (?:credit|paisa|paise|payment)/,
  /\b(?:today s|todays|today) credits?\b/,
  /\bcredited today\b/,
  /\bhow much (?:was |got |has been )?credited today\b/,
];
const QUERY_RES: RegExp[] = [
  /\braise (?:a |an )?(?:query|ticket|complaint)\b/,
  /\b(?:query|ticket|complaint) (?:raise|daalo|dalo|karo|kar do|banao)\b/,
  /\bis file (?:pe|par) query\b/,
];

/** Words that are never a customer name in these questions. */
const NOT_NAME = new Set([
  'mera', 'meraa', 'meri', 'mere', 'my', 'hamara', 'apna', 'is', 'iss', 'us', 'this', 'that', 'the', 'kya', 'has', 'have', 'did', 'does', 'was',
  'ka', 'ki', 'ke', 'paisa', 'paise', 'money', 'payment', 'amount', 'credit', 'credited', 'file', 'loan', 'case', 'aaya', 'aya', 'aa', 'gaya',
  'kahan', 'kaha', 'where', 'come', 'came', 'in', 'yet', 'hai', 'he', 'nahi', 'ya', 'or', 'not', 'status', 'of', 'for', 'customer', 'got', 'get',
  'received', 'reached', 'abhi', 'tak', 'batao', 'bata', 'do', 'please', 's', 'mujhe', 'tell', 'me', 'what', 'about', 'and',
]);

/** Customer name said in a status question, if any ("Ramesh ka paisa aaya" → "ramesh"). */
export function nameFromQuestion(n: string): string | undefined {
  const pats: RegExp[] = [
    // "<name> ka paisa aaya", "<name> ki file kahan hai", "<name> ke paise aaye"
    new RegExp(`^(?:kya |ab |abhi )?(.+?)\\s+(?:ka|ki|ke|kaa)\\s+(?:${PAISA}|${FILE}|paise)\\b`),
    // "has / did / is <name> s money come", "has <name> s money been credited"
    new RegExp(`\\b(?:has|did|is|was)\\s+(.+?)\\s+s?\\s*(?:money|payment|loan amount|loan|file)\\b`),
    // "<name> s money", "where is <name> s file"
    new RegExp(`\\b(?:where is |where s |status of |what about )?([a-z]+(?: [a-z]+)?) s (?:money|payment|file|loan)\\b`),
    // "money for <name>", "status of <name>"
    /\b(?:money|payment|credit|status) (?:for|of) ([a-z]+(?: [a-z]+)?)\b/,
    // "did <name> get the money", "has <name> got paid"
    /\b(?:did|has) ([a-z]+(?: [a-z]+)?) (?:get|got|received)\b/,
  ];
  for (const re of pats) {
    const m = n.match(re);
    if (!m?.[1]) continue;
    const words = m[1].split(' ').filter((w) => w && !NOT_NAME.has(w) && !/^\d+$/.test(w));
    if (words.length && words.length <= 3) return words.join(' ');
  }
  return undefined;
}

const isFileQuestion = (n: string): boolean =>
  new RegExp(`\\b(?:ka|ki|ke|kaa)\\s+(?:${PAISA}|paise)\\s+(?:${AAYA}|${KAHAN}|kab)\\b`).test(n)
  || new RegExp(`\\b(?:ka|ki|ke)\\s+${FILE}\\s+(?:${KAHAN}|${ATKI}|kis stage)\\b`).test(n)
  || /\b(?:has|did|is|was) .+ s? ?(?:money|payment|loan amount) (?:come|came|arrived|been credited|credited|reached|landed)\b/.test(n)
  || /\b(?:has|did|is) .+ (?:get|got|received) (?:the )?(?:money|payment)\b/.test(n)
  || /\b(?:where is|where s) [a-z]+(?: [a-z]+)? s (?:money|file|payment)\b/.test(n)
  || /\bis loan ka paisa\b/.test(n);

/**
 * Read a Money-in-flight question from what the dealer said; null when it is not one (the normal command list then
 * decides). File questions come first ("Ramesh ka paisa aaya" is not "mera paisa kahan hai").
 */
export function parseMoneyQuery(text: string): MoneyQuery | null {
  const n = mifNorm(text);
  if (!n || n.split(' ').length > 14) return null;
  // Commission is Payouts, not Money in flight (v1.4.8: also short-pay / statement questions — "short payment kahan hai").
  if (/\b(?:commission|payouts?|incentive|invoice|statement|short ?(?:pay|pays|paid|payment|payments))\b/.test(n)) return null;
  if (QUERY_RES.some((re) => re.test(n))) return { kind: 'query', intent: 'RAISE_QUERY' };
  if (isFileQuestion(n)) {
    const name = nameFromQuestion(n);
    return { kind: 'file', intent: 'SHOW_FILE_MONEY_STATUS', ...(name ? { name } : {}) };
  }
  if (TODAY_RES.some((re) => re.test(n))) return { kind: 'today', intent: 'SHOW_TODAYS_CREDITS' };
  if (STUCK_RES.some((re) => re.test(n))) return { kind: 'stuck', intent: 'SHOW_STUCK_FILES' };
  if (LIST_RES.some((re) => re.test(n))) return { kind: 'list', intent: 'SHOW_MONEY_IN_FLIGHT' };
  return null;
}

/** A command (server / Whisper / phone) as a Money-in-flight question: its MIF intent, else the transcript. */
export function moneyQueryFor(cmd: { intent: string; transcript?: string }): MoneyQuery | null {
  const parsed = parseMoneyQuery(cmd.transcript ?? '');
  if (isMifIntent(cmd.intent)) {
    const kind = INTENT_KIND[cmd.intent];
    const name = kind === 'file' ? parsed?.name ?? nameFromQuestion(mifNorm(cmd.transcript ?? '')) : undefined;
    return { kind, intent: cmd.intent, ...(name ? { name } : {}) };
  }
  return parsed;
}
export const intentForKind = (k: MoneyQueryKind): MifIntent => KIND_INTENT[k];

/* ---------------- The answer (pure) ---------------- */

export interface MifRouteParams { filter?: MifFilter; lan?: string; q?: string; query?: boolean; at?: number }
export type MoneyAnswer =
  | { kind: 'gated'; say: string }
  | { kind: 'open'; params: MifRouteParams; say: string; toast: string }
  | { kind: 'clarify'; params: MifRouteParams; say: string; toast: string }
  | { kind: 'absent'; params: MifRouteParams; say: string; toast: string };

/**
 * What a Money-in-flight question does for this dealer. `enabled` = isMoneyInFlightEnabled(profile) (false → the polite
 * not-available line, nothing opens). `openLan` = the file whose sheet is open now ("is file pe query raise karo",
 * "is loan ka paisa aaya").
 */
export function answerMoneyQuery(q: MoneyQuery, ctx: { enabled: boolean; files: readonly MifFile[]; openLan?: string | null; now?: Date }): MoneyAnswer {
  if (!ctx.enabled) return { kind: 'gated', say: MIF_NOT_AVAILABLE };
  const now = ctx.now ?? MIF_NOW;
  const files = ctx.files;
  switch (q.kind) {
    case 'list': return { kind: 'open', params: { filter: 'all' }, say: summaryLine(files, now), toast: 'Opening Money in flight' };
    case 'stuck': return { kind: 'open', params: { filter: 'stuck' }, say: stuckLine(files, now), toast: 'Money in flight · Stuck' };
    case 'today': return { kind: 'open', params: { filter: 'credited' }, say: todayLine(files, now), toast: 'Money in flight · Credited' };
    case 'query': {
      const open = ctx.openLan ? files.find((f) => f.lan === ctx.openLan) : undefined;
      const target = open ?? sortFiles(files.filter((f) => isOverdue(f, now)), now)[0];
      if (!target) return { kind: 'open', params: { filter: 'all' }, say: 'Open a file first, then raise the query from it.', toast: 'Opening Money in flight' };
      return { kind: 'open', params: { lan: target.lan, query: true }, say: 'Choose a reason for the query.', toast: `Raise a query · ${target.customer}` };
    }
    case 'file': {
      const vis = visibleFiles(files, now);
      if (!q.name) {
        const open = ctx.openLan ? vis.find((f) => f.lan === ctx.openLan) : undefined;
        if (open) return { kind: 'open', params: { lan: open.lan }, say: fileStatusLine(open, now), toast: open.customer };
        return { kind: 'clarify', params: { filter: 'all' }, say: "Whose file? Say the customer's name.", toast: 'Opening Money in flight' };
      }
      const opts = customerOptions(vis, (f) => ({ lan: f.lan, name: f.customer, vehicle: f.vehicle.replace(/\s*\(.*\)$/, '') }));
      let m = matchCustomer(q.name, opts);
      // "rameshs money": the recogniser glued the possessive s on.
      if ((!m || m.kind === 'absent') && /[a-z]{3,}s$/.test(q.name)) m = matchCustomer(q.name.replace(/s$/, ''), opts) ?? m;
      const pretty = q.name.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
      if (m?.kind === 'one') {
        const f = vis.find((x) => x.lan === (m as { option: { value?: string } }).option.value)!;
        return { kind: 'open', params: { lan: f.lan }, say: fileStatusLine(f, now), toast: f.customer };
      }
      if (m?.kind === 'several') {
        const ph = m.options.map((o) => `${o.label}, ${o.vehicle ?? o.lan}`);
        return { kind: 'clarify', params: { q: q.name }, say: `${ph.slice(0, -1).join(', ')} or ${ph[ph.length - 1]}?`, toast: `Money in flight · “${pretty}”` };
      }
      return { kind: 'absent', params: { filter: 'all' }, say: `${pretty} is not on this list.`, toast: 'Opening Money in flight' };
    }
  }
}

/** The phone's own reading as a command (same shape the server would send), so `deliver` handles both alike. */
export function mifLocalCommand(text: string, q: MoneyQuery): CommandResponse {
  return parseResponse({
    transcript: text, confidence: 1, intent: q.intent, score: 1, matchedPhrase: null, status: 'ok', engine: 'device', method: 'keyword',
    action: { type: 'navigate', route: MIF_ROUTE }, confidenceBand: 'auto', autoExecute: true, autoReason: 'mif_local',
  });
}
export const MIF_ROUTE = 'MoneyInFlight';

/* ---------------- Live context (who is signed in, which file is open) ---------------- */
// Set by RootNavigator (dealer + files) and the MoneyInFlight screen (open file). Plain module state: the voice hook
// reads it at answer time, so a voice question always sees the same files as the list.
export interface MifVoiceContext { enabled: boolean; files: readonly MifFile[]; openLan: string | null }
let mifCtx: MifVoiceContext = { enabled: false, files: [], openLan: null };
export function setMifVoiceContext(p: Partial<MifVoiceContext>): void { mifCtx = { ...mifCtx, ...p }; }
export function getMifVoiceContext(): MifVoiceContext { return mifCtx; }
