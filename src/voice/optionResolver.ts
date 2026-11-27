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
import { vehicleTokens } from './intentMatcher';
import { parseResponse } from './sttClient';
import type { CommandResponse, IntentCandidate, VoiceOption } from './types';
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
  if (expect || !option) return local;
  if (option.autoExecute === true || (local.status ?? 'ok') !== 'ok') return option;
  return local;
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
