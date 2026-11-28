/**
 * v1.4.8 Payout statement by voice. Pure (no React Native): unit-tested in Node (voice/__tests__/payoutVoice.test.ts).
 *
 * Decided on the phone (useVoiceCommand.handleText / onDeviceFinal / deliver), at once and offline, so the phrases work
 * with the 8793 server's older command list too. The server catalogue has the same intents (firstgo-voice-local
 * commands.md); a server / Whisper answer naming one lands in the same place.
 *
 *   "payout statement dikhao" / "show my payout statement" / "is mahine ka payout" / "pichhle mahine ka statement" /
 *   "October ka statement"                                         → SHOW_PAYOUT_STATEMENT (period; speaks the summary)
 *   "short payment kahan hai" / "any short pay" / "kam payout kahan hai" / "difference dikhao" → SHOW_SHORT_PAYS
 *   "CR-20320 ka payout" / "Arjun Mehta ka commission" / "is file ka payout kitna aaya"         → SHOW_PAYOUT_LINE (sheet)
 *   "short pay pe query" / "payout pe query daalo" (and "raise a query" while on Payouts)       → RAISE_PAYOUT_QUERY
 * Plain "payouts kholo" / "open payouts" stay OPEN_PAYOUTS (unchanged; it opens the same statement screen).
 * "proceed" / "aage chaliye" are never read here (ADVANCE is decided before, voiceStep.ts).
 * Replies are English (spoken with Piper); amounts only from the statement fields.
 */
import { customerOptions, matchCustomer } from './customerMatch';
import { mifNorm } from './moneyVoice';
import { parseResponse } from './sttClient';
import type { CommandResponse } from './types';
import { TODAY, type Invoice } from '../services/business';
import { monthRange, presetRange, rangeContaining, type DateRange } from '../services/period';
import {
  allLines, findLine, lineSpokenLine, shortPayLine, shortPaysIn, statementLine, statementSummary, type StatementFilter,
} from '../services/payoutStatement';

export const PAYOUT_INTENTS = ['SHOW_PAYOUT_STATEMENT', 'SHOW_SHORT_PAYS', 'SHOW_PAYOUT_LINE', 'RAISE_PAYOUT_QUERY'] as const;
export type PayoutIntent = (typeof PAYOUT_INTENTS)[number];
export type PayoutQueryKind = 'statement' | 'short' | 'line' | 'query';
export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'last3Months';
export interface PayoutVoiceQuery { kind: PayoutQueryKind; intent: PayoutIntent; period?: PeriodPreset; month?: number; name?: string; lan?: string }
const KIND_INTENT: Record<PayoutQueryKind, PayoutIntent> = { statement: 'SHOW_PAYOUT_STATEMENT', short: 'SHOW_SHORT_PAYS', line: 'SHOW_PAYOUT_LINE', query: 'RAISE_PAYOUT_QUERY' };
const INTENT_KIND: Record<PayoutIntent, PayoutQueryKind> = { SHOW_PAYOUT_STATEMENT: 'statement', SHOW_SHORT_PAYS: 'short', SHOW_PAYOUT_LINE: 'line', RAISE_PAYOUT_QUERY: 'query' };
export const isPayoutIntent = (i: string | undefined): i is PayoutIntent => !!i && (PAYOUT_INTENTS as readonly string[]).includes(i);

const PAYOUT = '(?:payouts?|pay out|commission|commision|comission|kamishan|incentives?)';
const STATEMENT = '(?:statement|statment|stetment|hisab|hisaab)';
const SHORT_RES: RegExp[] = [
  /\bshort ?(?:pay|pays|paid|payment|payments|payout|payouts)\b/,
  new RegExp(`\\bkam ${PAYOUT}\\b`), /\bkam (?:payment|paisa) (?:aaya|aya|mila)\b/,
  /\b(?:difference|differences|diff) (?:dikhao|dikha do|batao|show|kahan|kaha|kya hai)\b/,
  /\b(?:show|any|koi) (?:the |me )?(?:difference|differences)\b/,
  new RegExp(`\\b${PAYOUT} (?:me|mein|main|par|pe) (?:difference|kami|kam)\\b`),
  new RegExp(`\\b(?:kitna|kitni) (?:kam|kami) (?:aaya|aya|mila|hai)\\b`),
];
const QUERY_WORD = /\b(?:query|queries|ticket|complaint|dispute)\b/;
const QUERY_VERB = /\b(?:raise|daalo|dalo|daal do|karo|kar do|banao|file|lagao|chahiye)\b/;
const LAN_RE = /\b(cr|tw|cv)\s?(\d{4,6})\b/;
const MONTH_WORDS: [RegExp, number][] = [
  [/\b(?:january|jan|janvari)\b/, 0], [/\b(?:february|feb|farvari)\b/, 1], [/\b(?:march|mar)\b/, 2], [/\b(?:april|apr)\b/, 3], [/\bmay\b/, 4],
  [/\b(?:june|jun)\b/, 5], [/\b(?:july|jul)\b/, 6], [/\b(?:august|aug|agast)\b/, 7], [/\b(?:september|sept|sep|sitambar)\b/, 8],
  [/\b(?:october|oct|aktubar)\b/, 9], [/\b(?:november|nov|navambar)\b/, 10], [/\b(?:december|dec|disambar)\b/, 11],
];
const THIS_MONTH = /\b(?:is|iss|isi|this|current|chalu) (?:mahine|mahina|mahine ka|month)\b/;
const LAST_MONTH = /\b(?:pichhle|pichle|pichla|pichhla|picchle|last|previous|pichhli) (?:mahine|mahina|month)\b/;
const LAST3 = /\b(?:last|pichhle|pichle) (?:3|three|teen) (?:mahine|months?)\b|\bteen mahine\b/;

function periodOf(n: string): { period?: PeriodPreset; month?: number } {
  if (LAST3.test(n)) return { period: 'last3Months' };
  if (LAST_MONTH.test(n)) return { period: 'lastMonth' };
  if (THIS_MONTH.test(n)) return { period: 'thisMonth' };
  const m = MONTH_WORDS.find(([re]) => re.test(n));
  return m ? { month: m[1] } : {};
}

/** Words that are never a customer name in "<name> ka payout". */
const NOT_NAME = new Set([
  'mera', 'meraa', 'meri', 'mere', 'my', 'hamara', 'apna', 'is', 'iss', 'us', 'this', 'that', 'the', 'kya', 'file', 'loan', 'case', 'line', 'invoice',
  'mahine', 'mahina', 'month', 'pichhle', 'pichle', 'last', 'previous', 'current', 'aaj', 'today', 'total', 'kitna', 'show', 'open', 'dikhao', 'kholo',
  'ka', 'ki', 'ke', 'payout', 'payouts', 'commission', 'statement', 'short', 'pay', 'kam', 'teen', 'three', 's', 'me', 'please', 'customer', 'all', 'and', 'of',
]);
const isMonthWord = (w: string) => MONTH_WORDS.some(([re]) => re.test(w));
function nameOf(n: string): string | undefined {
  const pats = [
    new RegExp(`^(?:show |open |dikhao )?(.+?)\\s+(?:ka|ki|ke|kaa)\\s+${PAYOUT}\\b`),
    new RegExp(`\\b([a-z]+(?: [a-z]+)?) s ${PAYOUT}\\b`),
    new RegExp(`\\b${PAYOUT} (?:for|of) ([a-z]+(?: [a-z]+)?)\\b`),
  ];
  for (const re of pats) {
    const m = n.match(re);
    if (!m?.[1]) continue;
    const words = m[1].split(' ').filter((w) => w && !NOT_NAME.has(w) && !/^\d+$/.test(w) && !isMonthWord(w));
    if (words.length && words.length <= 3) return words.join(' ');
  }
  return undefined;
}

/**
 * Read a payout-statement phrase; null when it is not one. `onPayouts` = the dealer is on the Payouts screen (then a
 * bare "raise a query" / "is pe query daalo" is a payout query, not a Money-in-flight one).
 */
export function parsePayoutQuery(text: string, onPayouts = false): PayoutVoiceQuery | null {
  const n = mifNorm(text);
  if (!n || n.split(' ').length > 14) return null;
  // Advance payout (its own card / flow) and claim commands stay theirs.
  if (/\badvance\b/.test(n)) return null;
  const hasPayout = new RegExp(`\\b${PAYOUT}\\b`).test(n);
  const hasShort = SHORT_RES.some((re) => re.test(n));
  if (QUERY_WORD.test(n) && (QUERY_VERB.test(n) || /\b(?:pe|par|on)\b/.test(n))) {
    if (hasShort || hasPayout || /\bdeduction\b/.test(n) || onPayouts) return { kind: 'query', intent: 'RAISE_PAYOUT_QUERY' };
    return null;
  }
  if (hasShort) return { kind: 'short', intent: 'SHOW_SHORT_PAYS' };
  const lan = n.match(LAN_RE);
  if (lan && (hasPayout || onPayouts)) return { kind: 'line', intent: 'SHOW_PAYOUT_LINE', lan: `${lan[1]!.toUpperCase()}-${lan[2]}` };
  if (hasPayout && /\b(?:is|iss|this) (?:file|line|case) (?:ka|ki|ke)\b/.test(n)) return { kind: 'line', intent: 'SHOW_PAYOUT_LINE' };
  const period = periodOf(n);
  const hasStatement = new RegExp(`\\b${STATEMENT}\\b`).test(n);
  if (hasPayout || hasStatement) {
    const name = period.period === undefined && period.month === undefined ? nameOf(n) : undefined;
    if (name) return { kind: 'line', intent: 'SHOW_PAYOUT_LINE', name };
    if (hasStatement || period.period || period.month !== undefined) return { kind: 'statement', intent: 'SHOW_PAYOUT_STATEMENT', ...period };
  }
  return null;
}

/** A command (server / Whisper / phone) as a payout request: its intent (+ details from the transcript), else the transcript. */
export function payoutQueryFor(cmd: { intent: string; transcript?: string }, onPayouts = false): PayoutVoiceQuery | null {
  const parsed = parsePayoutQuery(cmd.transcript ?? '', onPayouts);
  if (isPayoutIntent(cmd.intent)) {
    const kind = INTENT_KIND[cmd.intent];
    return { ...(parsed?.kind === kind ? parsed : {}), kind, intent: cmd.intent };
  }
  // On Payouts, the generic RAISE_QUERY (Money in flight on other screens) is the payout query.
  if (onPayouts && cmd.intent === 'RAISE_QUERY') return { kind: 'query', intent: 'RAISE_PAYOUT_QUERY' };
  return parsed;
}
export const intentForPayoutKind = (k: PayoutQueryKind): PayoutIntent => KIND_INTENT[k];

/* ---------------- The answer (pure) ---------------- */

export interface PayoutRouteParams { period?: PeriodPreset; month?: number; filter?: StatementFilter; invoice?: string; lan?: string; query?: boolean }
export type PayoutAnswer = { kind: 'open' | 'clarify' | 'absent'; params: PayoutRouteParams; say: string; toast: string };
export interface OpenLine { invoice: string; lan: string }

const rangeParams = (r: DateRange): Pick<PayoutRouteParams, 'period' | 'month'> => (r.preset === 'custom' ? { month: r.from.getMonth() } : { period: r.preset });
const rangeFor = (q: Pick<PayoutVoiceQuery, 'period' | 'month'>, today: Date): DateRange => {
  if (q.period) return presetRange(q.period, today);
  if (q.month !== undefined) {
    // A month later than this one means last year's ("December" said in November).
    const y = q.month > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
    const r = monthRange(y, q.month, today);
    return rangeContaining(r.from, today).preset === 'thisMonth' ? presetRange('thisMonth', today)
      : rangeContaining(r.from, today).preset === 'lastMonth' ? presetRange('lastMonth', today) : r;
  }
  return presetRange('thisMonth', today); // approved default period
};

/** What a payout request does: which period / filter / line opens, and what Piper says (statement fields only). */
export function answerPayoutQuery(q: PayoutVoiceQuery, ctx: { invoices: readonly Invoice[]; openLine?: OpenLine | null; today?: Date }): PayoutAnswer {
  const today = ctx.today ?? TODAY;
  const inv = ctx.invoices;
  const recentShorts = () => shortPaysIn(inv.filter((i) => i.date >= presetRange('last3Months', today).from));
  switch (q.kind) {
    case 'statement': {
      const r = rangeFor(q, today);
      const s = statementSummary(inv, r, today);
      return { kind: 'open', params: { ...rangeParams(r), filter: 'all' }, say: statementLine(s, r), toast: `Payout statement · ${s.title.split(' · ')[0]}` };
    }
    case 'short': {
      const shorts = recentShorts();
      if (!shorts.length) return { kind: 'open', params: { filter: 'all' }, say: shortPayLine([]), toast: 'Payouts · no short payments' };
      const r = rangeContaining(shorts[0]!.invoiceDate, today);
      return { kind: 'open', params: { ...rangeParams(r), filter: 'short' }, say: shortPayLine(shorts), toast: `Payouts · Short paid (${shorts.length})` };
    }
    case 'query': {
      const open = ctx.openLine ? findLine(inv, ctx.openLine.invoice, ctx.openLine.lan) : null;
      const s = recentShorts()[0];
      const target = open ? { invoice: open.inv.id, lan: open.line.lan, customer: open.line.customer } : s ? { invoice: s.invoice, lan: s.lan, customer: s.customer } : null;
      if (!target) return { kind: 'clarify', params: { filter: 'all' }, say: 'Open a payout line first, then raise the query from it.', toast: 'Opening Payouts' };
      return { kind: 'open', params: { invoice: target.invoice, lan: target.lan, query: true }, say: 'Choose a reason for the query.', toast: `Raise a query · ${target.customer}` };
    }
    case 'line': {
      const lines = allLines(inv);
      if (q.lan) {
        const hit = lines.find((x) => x.line.lan === q.lan);
        if (!hit) return { kind: 'absent', params: { filter: 'all' }, say: `${q.lan} is not on your payout statement.`, toast: 'Opening Payouts' };
        return { kind: 'open', params: { invoice: hit.inv.id, lan: hit.line.lan }, say: lineSpokenLine(hit.line, hit.inv), toast: `${hit.line.customer} · ${hit.line.lan}` };
      }
      if (!q.name) {
        const open = ctx.openLine ? findLine(inv, ctx.openLine.invoice, ctx.openLine.lan) : null;
        if (open) return { kind: 'open', params: { invoice: open.inv.id, lan: open.line.lan }, say: lineSpokenLine(open.line, open.inv), toast: open.line.customer };
        return { kind: 'clarify', params: { filter: 'all' }, say: "Whose payout? Say the customer's name or the loan number.", toast: 'Opening Payouts' };
      }
      // Recent lines (last 3 months) first; a name matches the newest line for that customer.
      const recent = lines.filter((x) => x.inv.date >= presetRange('last3Months', today).from);
      const opts = customerOptions(recent, (x) => ({ lan: `${x.inv.id}#${x.line.lan}`, name: x.line.customer, vehicle: x.line.vehicle }));
      let m = matchCustomer(q.name, opts);
      if ((!m || m.kind === 'absent') && /[a-z]{3,}s$/.test(q.name)) m = matchCustomer(q.name.replace(/s$/, ''), opts) ?? m;
      const pretty = q.name.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
      if (m?.kind === 'one') {
        const [invoice, lan] = String((m as { option: { value?: string } }).option.value).split('#') as [string, string];
        const hit = findLine(inv, invoice, lan)!;
        return { kind: 'open', params: { invoice, lan }, say: lineSpokenLine(hit.line, hit.inv), toast: `${hit.line.customer} · ${lan}` };
      }
      if (m?.kind === 'several') {
        const ph = m.options.map((o) => `${o.label}, ${o.vehicle ?? o.lan}`);
        return { kind: 'clarify', params: { filter: 'all' }, say: `${ph.slice(0, -1).join(', ')} or ${ph[ph.length - 1]}?`, toast: `Payouts · “${pretty}”` };
      }
      return { kind: 'absent', params: { filter: 'all' }, say: `${pretty} is not on your payout statement.`, toast: 'Opening Payouts' };
    }
  }
}

export const PAYOUTS_ROUTE = 'Payouts';
/** The phone's own reading as a command (same shape the server sends), so `deliver` handles both alike. */
export function payoutLocalCommand(text: string, q: PayoutVoiceQuery): CommandResponse {
  return parseResponse({
    transcript: text, confidence: 1, intent: q.intent, score: 1, matchedPhrase: null, status: 'ok', engine: 'device', method: 'keyword',
    action: { type: 'navigate', route: PAYOUTS_ROUTE }, confidenceBand: 'auto', autoExecute: true, autoReason: 'payout_local',
  });
}

/* ---------------- Live context (RootNavigator: dealer's statement; Payouts screen: the open line) ---------------- */
export interface PayoutVoiceContext { signedIn: boolean; invoices: readonly Invoice[]; openLine: OpenLine | null }
let source: () => Omit<PayoutVoiceContext, 'openLine'> = () => ({ signedIn: false, invoices: [] });
let openLine: OpenLine | null = null;
export function setPayoutVoiceSource(fn: () => Omit<PayoutVoiceContext, 'openLine'>): void { source = fn; }
export function setPayoutOpenLine(l: OpenLine | null): void { openLine = l; }
export const getPayoutVoiceContext = (): PayoutVoiceContext => ({ ...source(), openLine });
