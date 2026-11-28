/**
 * v1.4.9 Feature 5 — Hinglish voice status checks. Pure (no React Native): unit-tested in Node
 * (voice/__tests__/statusVoice.test.ts).
 *
 * Decided on the phone (useVoiceCommand.handleText / onDeviceFinal / deliver), at once and offline, so every phrase
 * works with the 8793 server's older command list. A server / Whisper answer naming one of the new intents
 * (firstgo-voice-local commands.md) lands in the same place, and details (name, LAN) are re-read from the transcript.
 *
 *   "Ramesh ka loan kahan tak pahuncha" / "Ramesh ki file kis stage pe hai" / "what's the status of Ramesh's loan"
 *                                                    → SHOW_FILE_STATUS (one hit: file sheet; several: ClarifySheet)
 *   "aaj kitne approve hue" / "today's approvals"    → SHOW_TODAYS_APPROVALS   (speak only, stay on the screen — Gaurav #2)
 *   "aaj kitne apply hue" / "today's applications"   → SHOW_TODAYS_APPLICATIONS (speak only)
 *   "aaj kitna disburse hua" / "today's disbursals"  → SHOW_TODAYS_DISBURSALS   (speak only; all products incl. new TW)
 *   "mera commission kab aayega" / "payout kab aayega" → SHOW_COMMISSION_STATUS (Payouts, latest open invoice)
 *   "kitna commission pending hai" / "invoices to claim" → SHOW_INVOICES_TO_CLAIM (Payouts, Ready to claim; was TaInf)
 * Money questions stay feature 1 (moneyVoice.ts); this module adds the hybrid answer for a named file Money in flight
 * does not track (new TW at a mixed dealer, or not yet sanctioned) — Gaurav #4: open the file with a short line.
 * "proceed" / "aage chaliye" are never read here (ADVANCE is decided before, voiceStep.ts).
 * Status answers are ALWAYS spoken with Piper (Gaurav #1, replyModeFor('status') in voiceCues.ts).
 */
import { customerOptions, matchCustomer } from './customerMatch';
import { mifNorm, type MoneyQuery } from './moneyVoice';
import { parseResponse } from './sttClient';
import type { CommandResponse } from './types';
import { TODAY, type Invoice } from '../services/business';
import { MIF_NOW } from '../services/moneyInFlight';
import { rangeContaining } from '../services/period';
import {
  applicationsSpoken, approvalsSpoken, clarifySpoken, commissionStatus, disbursalsSpoken, fileStatusSpoken, hybridMoneySpoken,
  invoicesToClaim, maskMobilesIn, spokenModel, type StatusFile,
} from '../services/loanStatus';

export const STATUS_INTENTS = [
  'SHOW_FILE_STATUS', 'SHOW_TODAYS_APPROVALS', 'SHOW_TODAYS_APPLICATIONS', 'SHOW_TODAYS_DISBURSALS', 'SHOW_COMMISSION_STATUS', 'SHOW_INVOICES_TO_CLAIM',
] as const;
export type StatusIntent = (typeof STATUS_INTENTS)[number];
export type StatusKind = 'file' | 'approvals' | 'applications' | 'disbursals' | 'commission' | 'invoices';
export interface StatusQuery { kind: StatusKind; intent: StatusIntent; name?: string; lan?: string }
const KIND_INTENT: Record<StatusKind, StatusIntent> = {
  file: 'SHOW_FILE_STATUS', approvals: 'SHOW_TODAYS_APPROVALS', applications: 'SHOW_TODAYS_APPLICATIONS', disbursals: 'SHOW_TODAYS_DISBURSALS',
  commission: 'SHOW_COMMISSION_STATUS', invoices: 'SHOW_INVOICES_TO_CLAIM',
};
const INTENT_KIND = Object.fromEntries(Object.entries(KIND_INTENT).map(([k, v]) => [v, k])) as Record<StatusIntent, StatusKind>;
export const isStatusIntent = (i: string | undefined): i is StatusIntent => !!i && (STATUS_INTENTS as readonly string[]).includes(i);
export const intentForStatusKind = (k: StatusKind): StatusIntent => KIND_INTENT[k];

// Word families (Hinglish spellings + what transliterated Devanagari gives: "aj kitne apruv hue", "lon", "fail", "stej").
const AAJ = '(?:aaj|aj|today)';
const KITNE = '(?:kitne|kitni|kitna|kitnay)';
const APPROVE = '(?:approve|approved|apruv|aprove|approval|approvals|sanction|sanctioned|sainkshn|sankshan|pass)';
const APPLY = '(?:apply|applied|application|applications|eplikeshn|aplikeshn|eplikeshan|login|logins)';
const DISBURSE = '(?:disburse|disbursed|disbursal|disbursals|disbursement|disbrs|disburs|disbars)';
const HUE = '(?:hue|hui|huye|hua|huyi|aaye|aayi|aai|ai|aye|hain|hai|he)';
const COMMISSION = '(?:commission|commision|comission|kamishan|kamishn|kamisan|payout|payouts|incentive)';
const KAB = '(?:kab|when)';
const AAYEGA = '(?:aayega|ayega|aaega|aega|aayegi|milega|milegi|credit hoga|credit hogi|aa jayega|come|arrive|be credited|be paid)';
const LOAN = '(?:loan|lon|file|fail|case|application|eplikeshn)';
const STATUS_TRIGGER = /\b(?:kahan tak|kahaan tak|kaha tak|kis stage|kis stej|kaunse stage|kaun se stage|kis step|status|stetas|pahuncha|pahunchi|pahunche|pahucha|pohcha|pahuncha hai|reached|how far)\b/;
const LAN_RE = /\b(cr|tw|cv)\s?(\d{4,6})\b/;

const APPROVALS_RES: RegExp[] = [
  new RegExp(`\\b${AAJ} ${KITNE} (?:files? |loans? |lon |cases? |log )?${APPROVE}\\b`),
  new RegExp(`\\b${KITNE} (?:files? |loans? |cases? )?${APPROVE} ${HUE}?\\s*${AAJ}\\b`),
  /\b(?:today s|todays|today) (?:approvals|approved|sanctions)\b/, /\b(?:approvals|approved|sanctioned) today\b/,
  /\bhow many (?:files |loans |cases )?(?:were |got |have been )?(?:approved|sanctioned) today\b/, new RegExp(`\\b${AAJ} ke approvals?\\b`),
];
const APPLICATIONS_RES: RegExp[] = [
  new RegExp(`\\b${AAJ} ${KITNE} (?:log |logon ne |customers? |files? )?${APPLY}\\b`),
  new RegExp(`\\b${AAJ} ${KITNE} (?:nayi |naye |new )?(?:applications?|eplikeshn|files?) (?:aayi|aai|ai|aaye|aye|hui|hue|aayin)\\b`),
  /\b(?:today s|todays|today) (?:applications|logins)\b/, /\bapplications today\b/, /\bhow many applications (?:came |were made |today)/,
];
const DISBURSALS_RES: RegExp[] = [
  new RegExp(`\\b${AAJ} ${KITNE} (?:paisa |amount |files? |loans? )?${DISBURSE}\\b`),
  /\b(?:today s|todays|today) (?:disbursals|disbursements|disbursal)\b/, /\bdisbursed today\b/, /\bdisbursals? today\b/,
  /\bhow much (?:was |got |has been )?disbursed today\b/,
];
const COMMISSION_RES: RegExp[] = [
  new RegExp(`\\b${COMMISSION} ${KAB} (?:tak )?${AAYEGA}\\b`),
  new RegExp(`\\b${COMMISSION} ${KAB} (?:tak )?(?:account mein |khate mein )?(?:aayega|ayega|aaega|aega|milega|credit hoga)\\b`),
  new RegExp(`\\bwhen will (?:my |the )?${COMMISSION} (?:come|arrive|be credited|be paid|reach)\\b`),
  new RegExp(`\\b${COMMISSION} (?:kab tak|kab) credit\\b`),
];
const INVOICES_RES: RegExp[] = [
  /\binvoices? to claim\b/, /\b(?:show |dikhao )?pending invoices?\b/, /\bclaim (?:karne )?(?:wale|ke liye) invoices?\b/,
  new RegExp(`\\b${KITNE} ${COMMISSION} (?:pending|baki|baaki|bacha)\\b`), new RegExp(`\\b${COMMISSION} (?:pending|baki|baaki) (?:kitna|hai)\\b`),
  /\bhow much (?:commission|payout) (?:is )?(?:pending|to claim|left to claim)\b/,
];

/** Words that are never a customer name in a status question. */
const NOT_NAME = new Set([
  'mera', 'meraa', 'meri', 'mere', 'my', 'hamara', 'apna', 'is', 'iss', 'us', 'this', 'that', 'the', 'kya', 'what', 's', 'whats', 'what s',
  'ka', 'ki', 'ke', 'kaa', 'loan', 'lon', 'file', 'fail', 'case', 'application', 'status', 'of', 'for', 'customer', 'abhi', 'ab', 'tell', 'me',
  'batao', 'bata', 'do', 'please', 'show', 'check', 'dikhao', 'where', 'has', 'how', 'far', 'is', 'aaj', 'today', 'new', 'naya', 'sab',
  'paisa', 'money', 'commission', 'payout', 'mujhe', 'and', 'about',
]);
function nameOf(n: string): string | undefined {
  const pats: RegExp[] = [
    new RegExp(`^(?:kya |abhi |ab |zara |jara )?(.+?)\\s+(?:ka|ki|ke|kaa)\\s+(?:${LOAN}|status)\\b`),
    new RegExp(`\\bstatus (?:of|for) (.+?)(?: s)? ${LOAN}\\b`),
    /\bstatus (?:of|for) ([a-z]+(?: [a-z]+)?)\b/,
    new RegExp(`\\b(?:where has|how far has|where is|where s) (.+?) s ${LOAN}\\b`),
    new RegExp(`\\b([a-z]+(?: [a-z]+)?) s ${LOAN} (?:status|reached)\\b`),
  ];
  for (const re of pats) {
    const m = n.match(re);
    if (!m?.[1]) continue;
    const words = m[1].split(' ').filter((w) => w && !NOT_NAME.has(w) && !/^\d+$/.test(w));
    if (words.length && words.length <= 3) return words.join(' ');
  }
  return undefined;
}

/** Read a status question; null when it is not one (payout / alerts / Money-in-flight / the command list decide). */
export function parseStatusQuery(text: string): StatusQuery | null {
  const n = mifNorm(text);
  if (!n || n.split(' ').length > 16) return null;
  if (/\badvance\b/.test(n)) return null; // Advance payout / trade advance stay theirs
  if (INVOICES_RES.some((re) => re.test(n))) return { kind: 'invoices', intent: 'SHOW_INVOICES_TO_CLAIM' };
  if (COMMISSION_RES.some((re) => re.test(n))) return { kind: 'commission', intent: 'SHOW_COMMISSION_STATUS' };
  // "aaj kitna credit hua" stays Money in flight (credits); disbursals are all products.
  if (DISBURSALS_RES.some((re) => re.test(n))) return { kind: 'disbursals', intent: 'SHOW_TODAYS_DISBURSALS' };
  if (APPROVALS_RES.some((re) => re.test(n))) return { kind: 'approvals', intent: 'SHOW_TODAYS_APPROVALS' };
  if (APPLICATIONS_RES.some((re) => re.test(n))) return { kind: 'applications', intent: 'SHOW_TODAYS_APPLICATIONS' };
  if (STATUS_TRIGGER.test(n) && !/\b(?:paisa|paise|money|commission|payout|payouts|alerts?|rc)\b/.test(n)) {
    const lan = n.match(LAN_RE);
    if (lan) return { kind: 'file', intent: 'SHOW_FILE_STATUS', lan: `${lan[1]!.toUpperCase()}-${lan[2]}` };
    const name = nameOf(n);
    if (name) return { kind: 'file', intent: 'SHOW_FILE_STATUS', name };
  }
  return null;
}

/**
 * A command (server / Whisper / phone) as a status question: its intent (+ name / LAN from the transcript), else the
 * transcript. SHOW_INVOICES_TO_CLAIM from an older server for "TA INF" stays the old TaInf route (null here).
 */
export function statusQueryFor(cmd: { intent: string; transcript?: string }): StatusQuery | null {
  const parsed = parseStatusQuery(cmd.transcript ?? '');
  if (isStatusIntent(cmd.intent)) {
    const n = mifNorm(cmd.transcript ?? '');
    if (cmd.intent === 'SHOW_INVOICES_TO_CLAIM' && /\b(?:ta|inf|trade advance|inventory funding)\b/.test(n)) return null;
    const kind = INTENT_KIND[cmd.intent];
    if (kind === 'file' && !(parsed?.kind === 'file')) return null; // no name / LAN: nothing to answer (old "status" phrases)
    return { ...(parsed?.kind === kind ? parsed : {}), kind, intent: cmd.intent };
  }
  return parsed;
}

/* ---------------- The answer (pure) ---------------- */

export type AnswerTone = 'info' | 'warning' | 'success';
export interface PayoutsParams { period?: 'thisMonth' | 'lastMonth' | 'last3Months'; month?: number; filter?: 'all' | 'ready'; invoice?: string }
export type StatusAnswer =
  /** Speak + VoiceAnswerCard on the current screen; nothing opens (counts — Gaurav #2; gated / unknown lines). */
  | { ui: 'card'; say: string; tone: AnswerTone }
  /** ClarifySheet over the current screen ("Which one?"). `money`: a money question (hybrid line on choose). */
  | { ui: 'clarify'; say: string; tone: 'info'; name: string; options: StatusFile[]; money?: boolean }
  /** File-status sheet (Timeline) over the current screen, with the VoiceAnswerCard at the top. */
  | { ui: 'file'; say: string; tone: AnswerTone; file: StatusFile }
  /** Opens Payouts (commission questions). */
  | { ui: 'navigate'; say: string; tone: AnswerTone; route: 'Payouts'; params: PayoutsParams; toast: string };

export interface StatusVoiceContext {
  signedIn: boolean;
  mifEnabled: boolean;
  files: readonly StatusFile[];
  invoices: readonly Invoice[];
  now?: Date;
  today?: Date;
}

const pretty = (s: string) => s.split(' ').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
export const toneForFile = (f: StatusFile, mifEnabled: boolean): AnswerTone =>
  (mifEnabled && f.segment === 'NEW_TW') ? 'warning' : f.phase === 'disbursed' ? 'success' : 'info';

/** Name → files (customerMatch rules: first name exact, surname fuzzy, first-name-only when unique). */
export function findFiles(name: string, files: readonly StatusFile[]): { kind: 'one'; file: StatusFile } | { kind: 'several'; files: StatusFile[] } | { kind: 'none' } {
  const opts = customerOptions(files, (f) => ({ lan: f.lan, name: f.customer, vehicle: f.vehicle }));
  let m = matchCustomer(name, opts);
  if ((!m || m.kind === 'absent') && /[a-z]{3,}s$/.test(name)) m = matchCustomer(name.replace(/s$/, ''), opts) ?? m;
  if (m?.kind === 'one') return { kind: 'one', file: files.find((f) => f.lan === m.option.value)! };
  if (m?.kind === 'several') return { kind: 'several', files: m.options.map((o) => files.find((f) => f.lan === o.value)!).filter(Boolean) };
  return { kind: 'none' };
}

const payoutsRange = (d: Date, today: Date): Pick<PayoutsParams, 'period' | 'month'> => {
  const r = rangeContaining(d, today);
  return r.preset === 'custom' ? { month: r.from.getMonth() } : { period: r.preset };
};

/** What a status question does for this dealer and what Piper says. Answers come only from the phone's own lists. */
export function answerStatusQuery(q: StatusQuery, ctx: StatusVoiceContext): StatusAnswer {
  const now = ctx.now ?? MIF_NOW;
  const today = ctx.today ?? TODAY;
  switch (q.kind) {
    case 'approvals': return { ui: 'card', say: approvalsSpoken(ctx.files, now), tone: 'info' };
    case 'applications': return { ui: 'card', say: applicationsSpoken(ctx.files, now), tone: 'info' };
    case 'disbursals': return { ui: 'card', say: disbursalsSpoken(ctx.files, now), tone: 'info' };
    case 'commission': {
      const c = commissionStatus(ctx.invoices, today);
      if (!c.invoice) return { ui: 'card', say: c.say, tone: 'info' };
      return {
        ui: 'navigate', say: c.say, tone: c.state === 'paid' ? 'success' : 'info', route: 'Payouts',
        params: { ...payoutsRange(c.invoice.date, today), filter: 'all', invoice: c.invoice.id }, toast: `Payouts · ${c.invoice.id}`,
      };
    }
    case 'invoices': {
      const r = invoicesToClaim(ctx.invoices, today);
      if (!r.list.length) return { ui: 'card', say: r.say, tone: 'info' };
      const oldest = r.list[r.list.length - 1]!;
      const range = rangeContaining(oldest.date, today);
      const period = range.preset === 'thisMonth' ? 'thisMonth' : range.preset === 'lastMonth' ? 'lastMonth' : 'last3Months';
      return { ui: 'navigate', say: r.say, tone: 'info', route: 'Payouts', params: { period, filter: 'ready' }, toast: `Payouts · Ready to claim (${r.list.length})` };
    }
    case 'file': {
      const files = ctx.files;
      if (q.lan) {
        const f = files.find((x) => x.lan === q.lan) ?? files.find((x) => x.lan.endsWith(q.lan!.replace(/^\D+-/, '')));
        if (!f) return { ui: 'card', say: `${q.lan} is not on this list.`, tone: 'warning' };
        return { ui: 'file', say: fileStatusSpoken(f, { mifEnabled: ctx.mifEnabled, now }), tone: toneForFile(f, ctx.mifEnabled), file: f };
      }
      const name = q.name ?? '';
      const hit = findFiles(name, files);
      if (hit.kind === 'one') return { ui: 'file', say: fileStatusSpoken(hit.file, { mifEnabled: ctx.mifEnabled, now }), tone: toneForFile(hit.file, ctx.mifEnabled), file: hit.file };
      if (hit.kind === 'several') return { ui: 'clarify', say: clarifySpoken(pretty(name), hit.files, now), tone: 'info', name: pretty(name), options: hit.files };
      return { ui: 'card', say: `${pretty(name)} is not on this list.`, tone: 'warning' };
    }
  }
}

/** The file the dealer picked on the ClarifySheet, spoken: status line, or (money question) the hybrid / MIF line. */
export function answerForChoice(f: StatusFile, ctx: Pick<StatusVoiceContext, 'mifEnabled' | 'now'>, money = false): { say: string; tone: AnswerTone } {
  const now = ctx.now ?? MIF_NOW;
  if (money && !f.inMif) return { say: hybridMoneySpoken(f, now), tone: 'warning' };
  return { say: fileStatusSpoken(f, { mifEnabled: ctx.mifEnabled, now }), tone: toneForFile(f, ctx.mifEnabled) };
}

/**
 * Gaurav #4 / spec (e): a named money question ("Priya ka paisa aaya?") that Money in flight cannot answer (the file is
 * new TW at a mixed dealer, or not sanctioned yet). Opens that file with the short "money in flight isme nahi dikhta"
 * line. Null → feature 1 answers as before (in-scope file, unknown name, or a gated new-TW-only dealer: polite line).
 */
export function hybridMoneyAnswer(mq: MoneyQuery, ctx: StatusVoiceContext): StatusAnswer | null {
  if (mq.kind !== 'file' || !mq.name || !ctx.mifEnabled) return null;
  const outside = ctx.files.filter((f) => !f.inMif);
  const inside = ctx.files.filter((f) => f.inMif);
  // A name Money in flight itself resolves stays feature 1.
  if (findFiles(mq.name, inside).kind !== 'none') return null;
  const hit = findFiles(mq.name, outside);
  if (hit.kind === 'one') return { ui: 'file', say: hybridMoneySpoken(hit.file, ctx.now ?? MIF_NOW), tone: 'warning', file: hit.file };
  if (hit.kind === 'several') return { ui: 'clarify', say: clarifySpoken(pretty(mq.name), hit.files, ctx.now ?? MIF_NOW), tone: 'info', name: pretty(mq.name), options: hit.files, money: true };
  return null;
}

/* ---------------- ClarifySheet: the spoken choice ---------------- */

const ORDINALS: [RegExp, number][] = [[/\b(?:pehla|pehli|pahla|pahli|first|1st|ek number)\b/, 0], [/\b(?:dusra|doosra|dusri|second|2nd)\b/, 1], [/\b(?:teesra|tisra|third|3rd)\b/, 2]];
/**
 * Which ClarifySheet row the dealer named: LAN tail, vehicle ("Swift wala", "Activa"), full name / surname, or
 * "pehla / dusra". Null when the words pick no single row ("proceed" never guesses — that is ADVANCE, decided before).
 */
export function chooseClarify(text: string, options: readonly StatusFile[]): StatusFile | null {
  const n = mifNorm(text);
  if (!n || !options.length) return null;
  const digits = n.match(/\b\d{3,6}\b/g) ?? [];
  for (const d of digits) {
    const hits = options.filter((f) => f.lan.replace(/\D/g, '').endsWith(d));
    if (hits.length === 1) return hits[0]!;
  }
  const words = new Set(n.split(' '));
  const vehicleHits = options.filter((f) => {
    const toks = f.vehicle.toLowerCase().replace(/\(.*\)/, '').replace(/\+/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(?:hero|honda|tvs|bajaj|maruti|tata|hyundai|royal|enfield|gold)$/.test(w));
    return toks.some((w) => words.has(w)) || words.has(spokenModel(f.vehicle).toLowerCase());
  });
  if (vehicleHits.length === 1) return vehicleHits[0]!;
  const opts = customerOptions(options, (f) => ({ lan: f.lan, name: f.customer, vehicle: f.vehicle }));
  const m = matchCustomer(n, opts);
  if (m?.kind === 'one' && (m.level === 'full' || m.level === 'fuzzy' || m.level === 'surname')) return options.find((f) => f.lan === m.option.value) ?? null;
  const ord = ORDINALS.find(([re]) => re.test(n));
  if (ord && options[ord[1]]) return options[ord[1]]!;
  return null;
}
/** Spoken hint when "proceed" is said on the ClarifySheet (design library: it never guesses). */
export const CLARIFY_HINT = 'Pehle file choose karo.';

/* ---------------- Commands + live context ---------------- */

export const STATUS_ROUTE = 'Status';
/** The phone's own reading as a command (same shape the server sends), so `deliver` handles both alike. */
export function statusLocalCommand(text: string, q: StatusQuery): CommandResponse {
  return parseResponse({
    transcript: text, confidence: 1, intent: q.intent, score: 1, matchedPhrase: null, status: 'ok', engine: 'device', method: 'keyword',
    action: { type: 'none' }, confidenceBand: 'auto', autoExecute: true, autoReason: 'status_local',
  });
}

let source: () => StatusVoiceContext = () => ({ signedIn: false, mifEnabled: false, files: [], invoices: [] });
export function setStatusVoiceSource(fn: () => StatusVoiceContext): void { source = fn; }
export const getStatusVoiceContext = (): StatusVoiceContext => source();

/* ---------------- On-screen answer state (VoiceAnswerCard / ClarifySheet / file sheet) ---------------- */

export type StatusUi =
  | { kind: 'card'; id: number; question: string; say: string; tone: AnswerTone }
  | { kind: 'clarify'; id: number; question: string; say: string; name: string; options: StatusFile[]; money: boolean }
  | { kind: 'file'; id: number; question: string; say: string; tone: AnswerTone; file: StatusFile };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
let ui: StatusUi | null = null;
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
export const statusUi = {
  get: (): StatusUi | null => ui,
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
  /** Show an answer. Question and answer text are masked (no full mobile; OTP-safe via the caller's maskSpoken). */
  show(next: DistributiveOmit<StatusUi, 'id'>): void {
    ui = { ...next, question: maskMobilesIn(next.question), say: maskMobilesIn(next.say), id: Date.now() } as StatusUi;
    emit();
  },
  clear(id?: number): void { if (id === undefined || ui?.id === id) { ui = null; emit(); } },
  /** The ClarifySheet that is open now (the next turn's spoken choice resolves against it). */
  clarifyOpen: (): Extract<StatusUi, { kind: 'clarify' }> | null => (ui?.kind === 'clarify' ? ui : null),
};
