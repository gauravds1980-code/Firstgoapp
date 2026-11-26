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
import { COMMAND_CATALOG } from './commandCatalog.generated';
import { parseResponse } from './sttClient';
import type { CommandResponse, IntentCandidate } from './types';
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
const VOCAB: readonly string[] = [...new Set(POOL.flatMap((p) => p.tokens))];
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

const QR_RE = /\bqr\b|\bq\s*r\b/;
const QR_QUESTION_RE = /\b(?:what(?: is| are)|kya hai|kya hota|matlab)\b/;
const LOAN_INTENTS = new Set(['START_NEW_LOAN', 'START_MOBILE_JOURNEY', 'NEW_TWO_WHEELER_LOAN', 'NEW_CAR_LOAN', 'NEW_CONSUMER_DURABLE_LOAN']);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Match one utterance against the fixed command list. */
export function matchCommand(text: string): LocalMatch {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  const none: LocalMatch = { intent: 'UNKNOWN', phrase: null, score: 0, method: 'none', band: 'retry', candidates: [], margin: 0, normalized };
  if (!tokens.length) return none;

  const sim = simTable(tokens);
  // Best phrase per action (START_QR_JOURNEY / SCAN_QR share one action, so they never "tie").
  const byAction = new Map<string, { p: Prepared; score: number }>();
  for (const p of POOL) {
    const s = scorePhrase(normalized, tokens, p, sim);
    const k = actionKey(p.intent);
    const cur = byAction.get(k);
    if (!cur || s > cur.score + 1e-9 || (Math.abs(s - cur.score) < 1e-9 && p.tokens.length > cur.p.tokens.length)) byAction.set(k, { p, score: s });
  }
  const ranked = [...byAction.values()].sort((a, b) => b.score - a.score || b.p.tokens.length - a.p.tokens.length);
  const top = ranked[0];
  if (!top) return none;
  let intent = top.p.intent;
  const qr = QR_RE.test(normalized);
  if (intent === 'SCAN_QR' || (LOAN_INTENTS.has(intent) && qr)) intent = 'START_QR_JOURNEY';
  const score = top.score;
  const margin = score - (ranked[1]?.score ?? 0);
  const candidates: IntentCandidate[] = ranked.filter((r) => r.score >= CANDIDATE_FLOOR).slice(0, 3)
    .map((r, i) => ({ intent: i === 0 ? intent : r.p.intent, phrase: r.p.phrase, score: round3(r.score) }));
  const exact = top.p.norm === normalized || score >= 0.95;
  // "What is a QR code?" is a question, not a request to start the QR journey.
  const qrQuestion = qr && QR_QUESTION_RE.test(normalized) && intent === 'START_QR_JOURNEY';
  const band: MatchBand = score < LOCAL_CONFIRM ? 'retry'
    : score >= LOCAL_AUTO && (margin >= LOCAL_MARGIN || exact) && !qrQuestion ? 'auto'
    : 'confirm';
  return { intent, phrase: top.p.phrase, score: round3(score), method: exact ? 'keyword' : 'fuzzy', band, candidates, margin: round3(margin), normalized };
}

/** Words that carry slots / numbers the server must parse (names, amounts, tenure, phone, OTP). */
const SLOT_RE = /\d|\b(?:for|down payment|months?|tenure|rupees|rs|lakh|lakhs|thousand|mahine|saal|years?|number|otp)\b/;
/** Should this device transcript go to the server's text path (slots, numbers, on-screen options)? */
export function needsServerText(text: string, ctx: { expect?: string; options?: unknown[] } = {}): boolean {
  if (ctx.expect) return true;
  if (ctx.options && ctx.options.length) return true;
  return SLOT_RE.test(normalizeText(text));
}

/**
 * Turn a local match into the same CommandResponse shape the server returns, so planCommand /
 * shouldAutoExecute / applyCommand / the preview work unchanged. auto → status ok (+ autoExecute
 * unless destructive); confirm → status clarify with "Did you mean" candidates; retry → status retry.
 */
export function localCommand(text: string, m: LocalMatch, asrConfidence = 1): CommandResponse {
  const base = { transcript: text, confidence: asrConfidence, engine: 'device', method: 'keyword', matcher: m.method, normalizedTranscript: m.normalized };
  if (m.band === 'auto' || (m.band === 'confirm' && m.candidates.length <= 1 && m.score >= LOCAL_AUTO)) {
    const cmd = parseResponse({
      ...base, intent: m.intent, score: m.score, matchedPhrase: m.phrase, action: actionFor(m.intent), status: 'ok',
      responseText: responseFor(m.intent), confidenceBand: 'auto', autoExecute: true, autoReason: m.method === 'keyword' ? 'keyword_exact' : 'keyword',
      candidates: m.candidates,
    });
    if (isDestructiveCommand(cmd)) return { ...cmd, confidenceBand: 'confirm', autoExecute: false, autoReason: 'destructive' };
    return cmd;
  }
  const status = m.band === 'confirm' && m.candidates.length ? 'clarify' : 'retry';
  return parseResponse({
    ...base, intent: 'UNKNOWN', score: m.score, matchedPhrase: m.phrase, action: { type: 'none' }, status,
    candidates: m.candidates, confidenceBand: status, autoExecute: false, autoReason: status,
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
