/**
 * On-device keyword + fuzzy intent matcher (v1.4.0). Runs in a few milliseconds on the phone so the
 * recognizer's final text can act without a server round-trip. Same scoring as the server's keyword
 * path (firstgo-voice-local/src/intent.py score_phrase) over the same generated command list.
 *
 * Bands (mirrors the server's confidence.py, a little stricter because device ASR is checked later):
 *   score ≥ LOCAL_AUTO and a clear margin over the next *different action* → act now ('auto')
 *   LOCAL_CONFIRM ≤ score < LOCAL_AUTO, or a near tie                       → "Did you mean …?" ('confirm')
 *   below LOCAL_CONFIRM                                                     → ask the server / say again ('retry')
 * Destructive intents (submit / sign / pay / mandate / upload) are never auto, whatever the score.
 * Pure: no React Native imports.
 */
import { hasScaledAmount } from './amountParse';
import { COMMAND_CATALOG } from './commandCatalog.generated';
import { parseResponse } from './sttClient';
import type { CommandResponse, IntentCandidate, VoiceSlots } from './types';
import { isDestructiveCommand, withCandidate } from './voiceLogic';
import { normalizeText, phoneticKey, similarity, tokenize, tokenSimilarity } from './voiceNormalize';

export const LOCAL_AUTO = 0.8;
export const LOCAL_MARGIN = 0.08;
export const LOCAL_CONFIRM = 0.6;
/** Candidates below this are noise and never offered as "Did you mean". */
export const CANDIDATE_FLOOR = 0.45;
const TOKEN_HIT = 0.75;

export type MatchBand = 'auto' | 'confirm' | 'retry';

export interface LocalMatch {
  intent: string;
  phrase: string | null;
  score: number;
  /** keyword = exact / alias-level hit; fuzzy = typo / partial; none = nothing usable. */
  method: 'keyword' | 'fuzzy' | 'none';
  band: MatchBand;
  /** Best phrase per distinct action, best first (the top one is the match itself). */
  candidates: IntentCandidate[];
  /** Gap to the best different-action candidate. */
  margin: number;
  normalized: string;
  /** v1.4.2: set when a guard (negation / question / vehicle "Did you mean") forced confirm. Never promoted to auto. */
  guard?: MatchGuard;
  /** v1.4.2: vehicle model / category slots for loan + QR journey intents (same keys as the server). */
  slots?: VoiceSlots;
}

type Prepared = { intent: string; phrase: string; norm: string; tokens: string[] };
type Action = { type: string; route?: string; filter?: string; action?: string; kind?: string };

const ACTIONS = COMMAND_CATALOG.actions as unknown as Record<string, Action>;
const RESPONSES = COMMAND_CATALOG.responses as unknown as Record<string, string>;
const POOL: readonly Prepared[] = (COMMAND_CATALOG.phrases as readonly { intent: string; phrase: string; hint: string }[]).map((p) => {
  const norm = normalizeText(p.hint);
  return { intent: p.intent, phrase: p.phrase, norm, tokens: tokenize(norm) };
});

export const actionFor = (intent: string): Action => ACTIONS[intent] ?? { type: 'none' };
export const responseFor = (intent: string): string | undefined => RESPONSES[intent];
const actionKey = (intent: string): string => {
  const a = actionFor(intent);
  return `${a.type}|${a.route ?? a.action ?? ''}|${a.filter ?? ''}`;
};

/** Every distinct catalogue token with its phonetic key (precomputed once). */
const VOCAB: string[] = [...new Set(POOL.flatMap((p) => p.tokens))];
const VOCAB_KEY = new Map(VOCAB.map((t) => [t, phoneticKey(t)]));

/**
 * One utterance's token × catalogue-token similarity table, computed once per match (the slow part
 * used to be recomputing the same pairs for every phrase).
 */
function simTable(tokens: string[]): (u: string, v: string) => number {
  const rows = new Map<string, Map<string, number>>();
  for (const u of new Set(tokens)) {
    const pu = phoneticKey(u);
    const row = new Map<string, number>();
    for (const v of VOCAB) row.set(v, tokenSimilarity(u, v, pu, VOCAB_KEY.get(v)));
    rows.set(u, row);
  }
  return (u, v) => rows.get(u)?.get(v) ?? rows.get(v)?.get(u) ?? tokenSimilarity(u, v);
}

function coverage(needles: string[], hay: string[], sim: (u: string, v: string) => number): number {
  if (!needles.length) return 0;
  let total = 0;
  for (const n of needles) {
    let best = 0;
    for (const h of hay) { const s = sim(n, h); if (s > best) best = s; if (best === 1) break; }
    total += best >= TOKEN_HIT ? best : 0;
  }
  return total / needles.length;
}

const scorePhrase = (norm: string, tokens: string[], p: Prepared, sim: (u: string, v: string) => number): number => {
  const tok = 0.7 * coverage(p.tokens, tokens, sim) + 0.3 * coverage(tokens, p.tokens, sim);
  // Char similarity can only win when the lengths are close; skip the Levenshtein otherwise.
  const maxLen = Math.max(norm.length, p.norm.length);
  if (maxLen && 1 - Math.abs(norm.length - p.norm.length) / maxLen <= tok) return tok;
  return Math.max(similarity(norm, p.norm), tok);
};

// ---- v1.4.2 dispersed cues (same tables + formula as the server's intent.py cue_score) ----------
type CueSet = { intent: string; groups: string[][][]; negatives: string[][] };
const CUES = COMMAND_CATALOG.cues as unknown as CueSet[];
const CP = COMMAND_CATALOG.cueParams as unknown as { base: number; span: number; exactMaxLen: number; negHit: number };
const CUE_VOCAB = [...new Set(CUES.flatMap((c) => [...c.groups.flat(2), ...c.negatives.flat()]))];
for (const t of CUE_VOCAB) if (!VOCAB_KEY.has(t)) { (VOCAB as string[]).push(t); VOCAB_KEY.set(t, phoneticKey(t)); }

const cueTokenSim = (cue: string, tok: string, sim: (u: string, v: string) => number): number => {
  if (cue === tok) return 1;
  if (cue.length <= CP.exactMaxLen) return (VOCAB_KEY.get(cue) ?? phoneticKey(cue)) === phoneticKey(tok) ? 1 : 0;
  const s = sim(tok, cue);
  return s >= TOKEN_HIT ? s : 0;
};

function altHit(alt: string[], tokens: string[], sim: (u: string, v: string) => number, neg = false): number {
  const n = alt.length;
  let best = 0;
  for (let i = 0; i + n <= tokens.length; i++) {
    let tot = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      let sv = cueTokenSim(alt[k], tokens[i + k], sim);
      if (neg && sv < CP.negHit) sv = 0;
      if (sv <= 0) { ok = false; break; }
      tot += sv;
    }
    if (ok && tot / n > best) best = tot / n;
  }
  return best;
}

/** Every cue group hit anywhere (any order / distance) → base + span × mean hit; else 0. */
export function cueScore(cs: CueSet, tokens: string[], sim: (u: string, v: string) => number = tokenSimilarity): number {
  for (const alt of cs.negatives) if (altHit(alt, tokens, sim, true) > 0) return 0;
  let total = 0;
  for (const g of cs.groups) {
    let b = 0;
    for (const alt of g) { const h = altHit(alt, tokens, sim); if (h > b) b = h; }
    if (b <= 0) return 0;
    total += b;
  }
  return CP.base + (CP.span * total) / cs.groups.length;
}

function cueScores(tokens: string[], sim: (u: string, v: string) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const cs of CUES) { const s = cueScore(cs, tokens, sim); if (s > (out.get(cs.intent) ?? 0)) out.set(cs.intent, s); }
  return out;
}

// ---- v1.4.2 guards (patterns exported from the server's intent.py) ----------------------------
const G = COMMAND_CATALOG.guards as unknown as { negation: string; question: string; clauseSplit: string; qrAction: string };
const NEGATION_RE = new RegExp(G.negation);
const QUESTION_RE = new RegExp(G.question);
const CLAUSE_SPLIT_RE = new RegExp(G.clauseSplit, 'i');
const QR_ACTION_RE = new RegExp(G.qrAction);
const SETS = COMMAND_CATALOG.intentSets as unknown as { startLike: string[]; vehicleFriendly: string[]; vehicleSlot: string[]; loan: string[]; categoryIntent: Record<string, string> };
const START_LIKE = new Set(SETS.startLike);
const VEHICLE_FRIENDLY = new Set(SETS.vehicleFriendly);
const VEHICLE_SLOT = new Set(SETS.vehicleSlot);
const LOAN_INTENTS = new Set(SETS.loan);
const QR_INTENTS = new Set(['START_QR_JOURNEY', 'SCAN_QR']);
const QR_RE = /\bqr\b|\bq\s*r\b/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const intentFamily = (intent: string): string => (LOAN_INTENTS.has(intent) ? 'loan' : QR_INTENTS.has(intent) ? 'qr' : actionKey(intent));

export const isNegated = (text: string): boolean => NEGATION_RE.test(normalizeText(text));
/** "What is a QR code?" / "QR journey ka matlab kya hai": a QR question with no start / scan / open verb. */
export function isQrQuestion(text: string): boolean {
  const n = normalizeText(text);
  return QR_RE.test(n) && QUESTION_RE.test(n) && !QR_ACTION_RE.test(n);
}
/** "don't start the QR journey, open payouts" → { positive: "open payouts", negated: "don't start the QR journey" }. */
export function clausePlan(text: string): { positive: string; negated: string | null } {
  const parts = (text ?? '').split(new RegExp(CLAUSE_SPLIT_RE.source, 'gi')).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { positive: text, negated: null };
  const neg = parts.filter((p) => NEGATION_RE.test(normalizeText(p)));
  const pos = parts.filter((p) => !NEGATION_RE.test(normalizeText(p)) && tokenize(normalizeText(p)).length);
  if (!neg.length || !pos.length) return { positive: text, negated: null };
  return { positive: pos.join(' '), negated: neg.join(' ') };
}

// ---- v1.4.2 vehicle model entity (SEED master exported from firstgo-voice-local data/vehicle_models.json) ----
type VehicleModel = { id: string; inApp: boolean; category: string; brand: string; model: string; label: string; familyToks: string[][]; number: string | null };
const VV = COMMAND_CATALOG.vehicles as unknown as { hit: number; aliases: Record<string, string>; numberWords: Record<string, number>; numberWordsAmbiguous: string[]; models: VehicleModel[] };
const NUM_AMBIG = new Set(VV.numberWordsAmbiguous);
const alias = (t: string) => VV.aliases[t] ?? t;

/** Runs of number words → one digit string: one twenty five → 125, three fifty → 350, two hundred → 200. */
export function collapseNumberWords(toks: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    let j = i;
    while (j < toks.length && VV.numberWords[toks[j]] !== undefined) j++;
    const run = toks.slice(i, j);
    if (!run.length || (run.length === 1 && NUM_AMBIG.has(run[0])) || run[0] === 'for') { out.push(toks[i]); i++; continue; }
    const groups: [number, string][] = [];
    for (const w of run) {
      const v = VV.numberWords[w];
      const last = groups[groups.length - 1];
      if (v === 100) { if (last && last[1] === 'd' && last[0] >= 1 && last[0] <= 9) { last[0] *= 100; last[1] = 'h'; } else groups.push([100, 'h']); }
      else if (v >= 20 && v <= 90 && v % 10 === 0) { if (last && last[1] === 'h') { last[0] += v; last[1] = 't'; } else groups.push([v, 't']); }
      else if (v >= 10 && v <= 19) { if (last && last[1] === 'h') { last[0] += v; last[1] = 'c'; } else groups.push([v, 'c']); }
      else if (v >= 1 && v <= 9) { if (last && (last[1] === 't' || last[1] === 'h')) { last[0] += v; last[1] = 'c'; } else groups.push([v, 'd']); }
      else groups.push([v, 'd']);
    }
    out.push(groups.map((g) => String(g[0])).join(''));
    i = j;
  }
  return out;
}

export function vehicleTokens(text: string): string[] {
  const split: string[] = [];
  for (const t of normalizeText(text ?? '').split(' ').filter(Boolean).map(alias)) split.push(...(t.match(/[a-z]+|\d+/g) ?? [t]));
  return collapseNumberWords(split.map(alias));
}

const familySim = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (a.length < 5 || /^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  return tokenSimilarity(a, b) >= VV.hit;
};

export type VehicleHit = { status: 'resolved' | 'ambiguous'; model: VehicleModel | null; candidates: VehicleModel[]; family: string; number: string | null };

/** A known model family named in the utterance → resolved model, or the closest models when ambiguous. */
export function detectVehicle(text: string): VehicleHit | null {
  const toks = vehicleTokens(text);
  if (!toks.length || !VV.models.length) return null;
  let pos = -1; let end = 0; let fam: VehicleModel[] = [];
  for (let i = 0; i < toks.length && pos < 0; i++) {
    for (const m of VV.models) {
      for (const f of m.familyToks) {
        const n = f.length;
        if (i + n <= toks.length && f.every((ft, k) => familySim(ft, toks[i + k]))) {
          if (pos < 0) { pos = i; end = i + n; fam = [m]; } else if (!fam.includes(m)) { fam.push(m); end = Math.max(end, i + n); }
        }
      }
    }
  }
  if (pos < 0) return null;
  const number = toks.slice(end, end + 3).find((t) => /^\d+$/.test(t)) ?? null;
  const family = fam[0].familyToks[0].join(' ');
  const num = (m: VehicleModel) => (m.number && /^\d+$/.test(m.number) ? Number(m.number) : null);
  if (number !== null) {
    const exact = fam.filter((m) => m.number === number);
    if (exact.length === 1) return { status: 'resolved', model: exact[0], candidates: exact, family, number };
    const pool = (exact.length ? exact : fam).slice().sort((a, b) => (num(a) === null ? 10000 : Math.abs(num(a)! - Number(number))) - (num(b) === null ? 10000 : Math.abs(num(b)! - Number(number))));
    return { status: 'ambiguous', model: null, candidates: pool, family, number };
  }
  if (fam.length === 1) return { status: 'resolved', model: fam[0], candidates: fam, family, number: null };
  const pool = fam.slice().sort((a, b) => (Number(!a.inApp) - Number(!b.inApp)) || ((num(a) ?? 0) - (num(b) ?? 0)));
  return { status: 'ambiguous', model: null, candidates: pool, family, number: null };
}

const vehicleOption = (m: VehicleModel) => ({ id: m.id, kind: 'vehicle_model' as const, label: m.label, value: m.id });

/** Slots the server's extract_slots would attach for a vehicle (model entity first, else the category words). */
export function vehicleSlots(text: string, hit: VehicleHit | null = detectVehicle(text)): VoiceSlots | undefined {
  if (hit?.status === 'resolved' && hit.model) {
    const m = hit.model;
    return { vehicle: m.label, vehicleCategory: m.category, model: m.model, brand: m.brand, ...(m.inApp ? { assetId: m.id } : {}) };
  }
  const n = normalizeText(text);
  const cats = hit ? [...new Set(hit.candidates.map((c) => c.category))] : [];
  const category = cats.length === 1 ? cats[0]
    : /\bcar\b|four wheeler/.test(n) ? 'CAR' : /two wheeler|\bbike\b|scooter/.test(n) ? 'TWO_WHEELER' : /consumer durable/.test(n) ? 'CONSUMER_DURABLE' : undefined;
  return category ? { vehicleCategory: category } : undefined;
}

export type MatchGuard = 'negation' | 'question' | 'qr_question' | 'vehicle_ambiguous' | 'vehicle_conflict';

/** Keyword + cue ranking of one (already clause-planned) text, best action first. */
function rank(text: string): { normalized: string; ranked: { p: Prepared; score: number }[] } {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  if (!tokens.length) return { normalized, ranked: [] };
  const sim = simTable(tokens);
  const cues = cueScores(tokens, sim);
  // Best phrase per action (START_QR_JOURNEY / SCAN_QR share one action, so they never "tie").
  const byAction = new Map<string, { p: Prepared; score: number }>();
  for (const p of POOL) {
    const s = Math.max(scorePhrase(normalized, tokens, p, sim), cues.get(p.intent) ?? 0);
    const k = actionKey(p.intent);
    const cur = byAction.get(k);
    if (!cur || s > cur.score + 1e-9 || (Math.abs(s - cur.score) < 1e-9 && p.tokens.length > cur.p.tokens.length)) byAction.set(k, { p, score: s });
  }
  return { normalized, ranked: [...byAction.values()].sort((a, b) => b.score - a.score || b.p.tokens.length - a.p.tokens.length) };
}

// ---- v1.4.5 amount / pay guards (server: loan_amount.guard_navigation, ta_repay.mandate_guard) ----------------
/** Only an explicit start verb keeps "a loan of 1 lakh" on a journey (server loan_amount.START_RE). */
const START_VERB_RE = /\b(?:start|new|begin|apply|journey|qr|shuru|chalu)\b|नया|नई|शुरू|चालू/i;
const DOWN_PAYMENT_RE = /\bdown\s*-?\s*payment\b|\bdp\b|डाउन\s*पेमेंट/i;
const PAY_WORD_RE = /\b(?:re-?pay|pay|paying|payment|jama|chuka|chukao|bharo|bhar)\b|चुका|जमा|भुगतान/i;
const MANDATE_CUE_RE = /\b(?:auto|autopay|mandate|emandate|upi|nach|e mandate)\b|ऑटो|मैंडेट/i;
/** Intents an amount phrase may still reach (they act on the current screen's field / sheet, Confirm-guarded). */
const AMOUNT_OK_INTENTS: ReadonlySet<string> = new Set(['SET_LOAN_AMOUNT', 'TA_REPAY', 'CHANGE_DOWN_PAYMENT']);
const MANDATE_INTENTS: ReadonlySet<string> = new Set(['SETUP_UPI_MANDATE', 'OPEN_UPI_APP']);

/**
 * v1.4.5: a spoken amount ("loan amount 1 lakh", "one lakh", "pay 80000") never maps to a navigation
 * (START_NEW_LOAN "want a loan", START_MOBILE_JOURNEY, …) unless an explicit start verb was said, and "pay …"
 * without a mandate word never suggests Auto pay (SETUP_UPI_MANDATE). Down payment phrases keep their route.
 */
export function amountBlocksNavigation(text: string): boolean {
  const t = text ?? '';
  return hasScaledAmount(t) && !START_VERB_RE.test(t) && !DOWN_PAYMENT_RE.test(t);
}
export const payIsNotMandate = (text: string): boolean => PAY_WORD_RE.test(text ?? '') && !MANDATE_CUE_RE.test(normalizeText(text ?? '')) && !MANDATE_CUE_RE.test(text ?? '');

const AMOUNT_WORD_RE = /\b(?:amount|amt|rashi|raashi|rakam)\b|अमाउंट|राशि|रकम/i;

function guardRanked(text: string, ranked: { p: Prepared; score: number }[]): { p: Prepared; score: number }[] {
  const noNav = amountBlocksNavigation(text);
  const noMandate = payIsNotMandate(text);
  // The v1.4.5 field intents only compete when their words are there: a repay needs a pay word, a loan amount
  // needs an amount (or the word "amount"). Otherwise a phonetic cue ("bhai" ~ "bhar") steals the margin.
  const noRepay = !PAY_WORD_RE.test(text);
  const noLoanAmount = !hasScaledAmount(text) && !AMOUNT_WORD_RE.test(text);
  if (!noNav && !noMandate && !noRepay && !noLoanAmount) return ranked;
  return ranked.filter(({ p }) => {
    if (noRepay && p.intent === 'TA_REPAY') return false;
    if (noLoanAmount && p.intent === LOAN_AMOUNT_INTENT) return false;
    if (noMandate && MANDATE_INTENTS.has(p.intent)) return false;
    if (noNav && actionFor(p.intent).type === 'navigate' && !AMOUNT_OK_INTENTS.has(p.intent)) return false;
    return true;
  });
}

/** Match one utterance against the fixed command list (+ cues, guards, vehicle entity). */
export function matchCommand(text: string): LocalMatch {
  const plan = clausePlan(text ?? '');
  const ranked0 = rank(plan.positive);
  const normalized = ranked0.normalized;
  const ranked = guardRanked(text ?? '', ranked0.ranked);
  const none: LocalMatch = { intent: 'UNKNOWN', phrase: null, score: 0, method: 'none', band: 'retry', candidates: [], margin: 0, normalized };
  const top = ranked[0];
  if (!top) return none;
  let intent = top.p.intent;
  const qr = QR_RE.test(normalized);
  if (intent === 'SCAN_QR' || (LOAN_INTENTS.has(intent) && qr)) intent = 'START_QR_JOURNEY';
  const vehicle = detectVehicle(plan.positive);
  const slots = VEHICLE_SLOT.has(intent) ? vehicleSlots(plan.positive, vehicle) : undefined;
  // Plain loan + a vehicle category → the product loan (server _finalize does the same).
  if ((intent === 'START_NEW_LOAN' || intent === 'START_MOBILE_JOURNEY') && slots?.vehicleCategory && SETS.categoryIntent[slots.vehicleCategory]) intent = SETS.categoryIntent[slots.vehicleCategory];
  const score = top.score;
  const margin = score - (ranked[1]?.score ?? 0);
  let candidates: IntentCandidate[] = ranked.filter((r) => r.score >= CANDIDATE_FLOOR).slice(0, 3)
    .map((r, i) => ({ intent: i === 0 ? intent : r.p.intent, phrase: r.p.phrase, score: round3(r.score) }));
  const exact = top.p.norm === normalized || score >= 0.95;
  let band: MatchBand = score < LOCAL_CONFIRM ? 'retry' : score >= LOCAL_AUTO && (margin >= LOCAL_MARGIN || exact) ? 'auto' : 'confirm';
  let guard: MatchGuard | undefined;
  if (band !== 'retry') {
    if (isQrQuestion(plan.positive) && (QR_INTENTS.has(intent) || ['WHAT_CAN_I_SAY', 'HELP', 'EXPLAIN_SCREEN'].includes(intent))) {
      guard = 'qr_question';
      candidates = [{ intent: 'START_QR_JOURNEY', phrase: 'start QR journey', score: round3(score) }, { intent: 'WHAT_CAN_I_SAY', phrase: 'what can I say', score: 0.5 }];
    } else if (vehicle && VEHICLE_SLOT.has(intent) && vehicle.status === 'ambiguous') {
      guard = 'vehicle_ambiguous';
      candidates = [...vehicle.candidates.slice(0, 3).map((c, k) => ({ intent, phrase: c.label, score: round3(Math.max(0.5, score - 0.05 * k)), option: vehicleOption(c) })),
        { intent, phrase: top.p.phrase, score: round3(score) }];
    } else if (vehicle && !VEHICLE_FRIENDLY.has(intent)) {
      guard = 'vehicle_conflict';
      const m = vehicle.model ?? vehicle.candidates[0];
      candidates = [{ intent: SETS.categoryIntent[m.category] ?? 'START_NEW_LOAN', phrase: `new loan for ${m.label}`, score: round3(score) },
        { intent, phrase: top.p.phrase, score: round3(score * 0.9) }];
    } else if (NEGATION_RE.test(normalized)) guard = 'negation';
    else if (START_LIKE.has(intent) && QUESTION_RE.test(normalized)) guard = 'question';
    else if (plan.negated) {
      const neg = rank(plan.negated).ranked[0];
      if (neg && neg.score >= CANDIDATE_FLOOR + 0.05 && intentFamily(neg.p.intent) === intentFamily(intent)) guard = 'negation';
    }
    if (guard) band = 'confirm';
  }
  return { intent, phrase: top.p.phrase, score: round3(score), method: exact ? 'keyword' : 'fuzzy', band, candidates, margin: round3(margin), normalized, ...(guard ? { guard } : {}), ...(slots ? { slots } : {}) };
}

/**
 * v1.4.2: should the hook also send this device result to the server's text path? Yes for a plain
 * 'confirm' (the server has LaBSE, slots and cues on the full text and is right more often on long
 * sentences); no when a guard set the confirm (negation / question / vehicle "Did you mean" — the
 * server applies the same guards) or the local match is already auto / retry (retry goes anyway).
 * Take the server answer only when it comes back auto (confidenceBand 'auto' / autoExecute) within
 * CONFIRM_SERVER_BUDGET_MS; otherwise show the local "Did you mean".
 */
export const CONFIRM_SERVER_BUDGET_MS = 250;
export function shouldAskServerOnConfirm(m: LocalMatch): boolean {
  return m.band === 'confirm' && !m.guard;
}
/** The server's answer replaces a local confirm only when it is sure (auto) and not destructive. */
export function preferServerOnConfirm(local: CommandResponse, server: CommandResponse): boolean {
  return (local.status === 'clarify' || local.confidenceBand === 'confirm') && (server.status ?? 'ok') === 'ok'
    && server.autoExecute === true && server.confidenceBand === 'auto' && !isDestructiveCommand(server);
}

/**
 * v1.4.2 (useVoiceCommand-confirm-to-server.patch): race the server's text reading against
 * CONFIRM_SERVER_BUDGET_MS for a plain local "Did you mean". Returns the server answer when it should replace
 * the local one, else null (keep the local "Did you mean"). Never asked when the confidence gate already
 * guarded this text (`guard`), when a matcher guard set the confirm, or when the local band is not 'confirm'.
 * A server error or a late answer is null. `ask` is getSttProvider().text(...).
 */
export async function serverOverConfirm(
  local: CommandResponse,
  match: LocalMatch,
  ask: () => Promise<CommandResponse>,
  opts: { guard?: boolean; budgetMs?: number } = {},
): Promise<CommandResponse | null> {
  if (opts.guard || !shouldAskServerOnConfirm(match)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.budgetMs ?? CONFIRM_SERVER_BUDGET_MS); });
  try {
    const server = await Promise.race([ask().catch(() => null), timeout]);
    return server && preferServerOnConfirm(local, server) ? server : null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const LOAN_AMOUNT_INTENT = 'SET_LOAN_AMOUNT';
/** Server loan_amount.NO_FIELD_TEXT: a loan amount said off the vehicle screen never navigates. */
export const LOAN_AMOUNT_NO_FIELD = 'You can set the loan amount on the vehicle screen.';

/** Words that carry slots / numbers the server must parse (names, amounts, tenure, phone, OTP). */
const SLOT_RE = /\d|\b(?:for|down payment|months?|tenure|rupees|rs|lakh|lakhs|lac|lacs|thousand|hazaar|hazar|hajaar|crore|mahine|saal|years?|number|otp)\b/;
/** Should this device transcript go to the server's text path (slots, numbers, on-screen options / fields)? */
export function needsServerText(text: string, ctx: { expect?: string; options?: unknown[]; fields?: unknown[] } = {}): boolean {
  if (ctx.expect) return true;
  if (ctx.options && ctx.options.length) return true;
  if (ctx.fields && ctx.fields.length) return true;
  return SLOT_RE.test(normalizeText(text)) || hasScaledAmount(text);
}

/**
 * Turn a local match into the same CommandResponse shape the server returns, so planCommand /
 * shouldAutoExecute / applyCommand / the preview work unchanged. auto → status ok (+ autoExecute
 * unless destructive); confirm → status clarify with "Did you mean" candidates; retry → status retry.
 */
export function localCommand(text: string, m: LocalMatch, asrConfidence = 1): CommandResponse {
  const base = { transcript: text, confidence: asrConfidence, engine: 'device', method: 'keyword', matcher: m.method, normalizedTranscript: m.normalized };
  // v1.4.5: the command list knows "loan amount …" but not the screen's field: never a select / navigation from
  // here. The phone's field resolver (optionResolver.resolveOnPhone) sets it on the Asset screen.
  if (m.intent === LOAN_AMOUNT_INTENT && m.band !== 'retry') {
    return parseResponse({
      ...base, intent: LOAN_AMOUNT_INTENT, score: m.score, matchedPhrase: m.phrase, action: { type: 'none' }, status: 'ok',
      responseText: LOAN_AMOUNT_NO_FIELD, confidenceBand: 'confirm', autoExecute: false, autoReason: 'loan_amount_no_field',
    });
  }
  // A guard-set confirm (negation / question / vehicle "Did you mean") is never promoted to auto.
  if (m.band === 'auto' || (!m.guard && m.band === 'confirm' && m.candidates.length <= 1 && m.score >= LOCAL_AUTO)) {
    const cmd = parseResponse({
      ...base, intent: m.intent, score: m.score, matchedPhrase: m.phrase, action: actionFor(m.intent), status: 'ok',
      responseText: responseFor(m.intent), confidenceBand: 'auto', autoExecute: true, autoReason: m.method === 'keyword' ? 'keyword_exact' : 'keyword',
      candidates: m.candidates, ...(m.slots ? { slots: m.slots } : {}),
    });
    if (isDestructiveCommand(cmd)) return { ...cmd, confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive' };
    return cmd;
  }
  // Negation / flow question: show the command itself with Confirm (status ok, never auto).
  if (m.guard === 'negation' || m.guard === 'question') {
    return parseResponse({
      ...base, intent: m.intent, score: m.score, matchedPhrase: m.phrase, action: actionFor(m.intent), status: 'ok',
      responseText: responseFor(m.intent), confidenceBand: 'confirm', autoExecute: false, autoReason: m.guard,
      candidates: m.candidates, ...(m.slots ? { slots: m.slots } : {}),
    });
  }
  const status = m.band === 'confirm' && m.candidates.length ? 'clarify' : 'retry';
  return parseResponse({
    ...base, intent: 'UNKNOWN', score: m.score, matchedPhrase: m.phrase, action: { type: 'none' }, status,
    candidates: m.candidates, confidenceBand: status, autoExecute: false, autoReason: m.guard ?? status, ...(m.slots ? { slots: m.slots } : {}),
    responseText: status === 'clarify' ? 'Did you mean this?' : 'Sorry, say that again.',
  });
}

/** Same action target? (navigate route + filter, assistant action, or select id.) */
export function sameTarget(a: CommandResponse, b: CommandResponse): boolean {
  const k = (c: CommandResponse) => {
    const x = c.action;
    if (x.type === 'navigate') return `n|${x.route}|${x.filter ?? ''}`;
    if (x.type === 'assistant') return `a|${x.action}`;
    if (x.type === 'select') return `s|${x.id}`;
    return c.intent === 'UNKNOWN' ? 'none' : `i|${actionKey(c.intent)}`;
  };
  return k(a) === k(b);
}

/** withCandidate + the catalogue's action / reply for intents the route map doesn't cover (assistant read-outs). */
export function chooseCandidate(cmd: CommandResponse, c: IntentCandidate): CommandResponse {
  const out = withCandidate(cmd, c);
  const reply = responseFor(out.intent);
  const withReply = reply && !c.option ? { ...out, responseText: reply, readBack: undefined } : out;
  if (withReply.action.type !== 'none') return withReply;
  const action = parseResponse({ action: actionFor(c.intent) }).action;
  return { ...withReply, action };
}
