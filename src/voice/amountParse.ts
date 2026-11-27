/**
 * v1.4.5 rupee-amount parser on the phone: a mirror of the server's amounts.find_amount (src/amounts.py over
 * normalize_numbers.expand_spoken_numbers), so the offline path reads "loan amount 1 lakh" exactly as the server.
 *
 *   "1 lakh" / "one lakh" / "ek lakh" / "एक लाख"           → 1,00,000
 *   "1.2 lakh" → 1,20,000 (never 3 lakh), "2.5L" / "5 L"     → 2,50,000 / 5,00,000
 *   "dedh lakh" 1.5, "sava lakh" 1.25, "sava do lakh" 2.25, "dhai lakh" 2.5, "saade teen lakh" 3.5, "paune do lakh" 1.75
 *   "95k" / "95 thousand" / "80 hazaar" / "पचानवे हज़ार"     → 95,000 / 80,000
 *   "1 lakh 20 thousand" / "one lakh twenty thousand"        → 1,20,000
 *   "1,10,000" / "110,000" (comma grouping)                 → 1,10,000 and always money (never a PIN code)
 * Not amounts: tenures ("24 months", "2 saal"), phone-length runs (10+ digits), model numbers under 1000
 * ("Xtreme 125R", "bullet 350").
 * Pure: no React Native imports (unit-tested in Node).
 */

/** Keys in NFC (Devanagari nukta letters such as ज़ decompose under NFC; input is NFC-normalized too). */
function nfc<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.normalize('NFC'), v]));
}

const UNITS: Readonly<Record<string, number>> = nfc({
  zero: 0, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, chaar: 4, five: 5, paanch: 5, panch: 5,
  six: 6, chhe: 6, chhah: 6, seven: 7, saat: 7, eight: 8, aath: 8, nine: 9, nau: 9,
});
const TWO_DIGIT: Readonly<Record<string, number>> = nfc({
  ten: 10, das: 10, eleven: 11, gyarah: 11, twelve: 12, barah: 12, baarah: 12, thirteen: 13, terah: 13, fourteen: 14, chaudah: 14,
  fifteen: 15, pandrah: 15, sixteen: 16, solah: 16, seventeen: 17, satrah: 17, eighteen: 18, atharah: 18, nineteen: 19, unnees: 19,
  twenty: 20, bees: 20, thirty: 30, tees: 30, forty: 40, chalis: 40, chaalis: 40, fifty: 50, pachaas: 50, pachas: 50,
  sixty: 60, saath: 60, seventy: 70, sattar: 70, eighty: 80, assi: 80, ninety: 90, nabbe: 90,
  ikkis: 21, bais: 22, teis: 23, chaubis: 24, chobis: 24, pachis: 25, pachees: 25, chhabbis: 26, sattais: 27, atthais: 28,
  untees: 29, battis: 32, paintees: 35, chhattis: 36, paintalis: 45, pachpan: 55, pachapan: 55, painsath: 65,
  pachattar: 75, pachhattar: 75, pachasi: 85, pachanve: 95, pachaanve: 95, panchanve: 95, ninyanve: 99,
});
const DEV_WORDS: Readonly<Record<string, number>> = nfc({
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बारह': 12, 'पंद्रह': 15,
  'बीस': 20, 'पच्चीस': 25, 'चौबीस': 24, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90,
  'पचानवे': 95, 'पंचानवे': 95, 'निन्यानवे': 99,
});
const SCALES: Readonly<Record<string, number>> = nfc({
  hundred: 100, sau: 100, 'सौ': 100,
  thousand: 1000, thousands: 1000, hazaar: 1000, hazar: 1000, hajaar: 1000, hazaaar: 1000, k: 1000, 'हज़ार': 1000, 'हजार': 1000,
  lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, laakh: 100_000, l: 100_000, 'लाख': 100_000,
  crore: 10_000_000, crores: 10_000_000, cr: 10_000_000, karod: 10_000_000, 'करोड़': 10_000_000, 'करोड': 10_000_000,
  // v1.4.5 S2: international scale words ("1.5 million" = ₹15,00,000; used to store 15).
  million: 1_000_000, millions: 1_000_000, mln: 1_000_000,
});
/** Fractions that take no number: dedh lakh = 1.5 lakh. */
const FRACTION: Readonly<Record<string, number>> = nfc({
  dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5, 'डेढ़': 1.5, 'डेढ': 1.5, 'ढाई': 2.5,
});
/** Fractions that modify the next number: sava do = 2.25, saade teen = 3.5, paune do = 1.75 (bare "sava" = 1.25). */
const MODIFIER: Readonly<Record<string, { delta: number; bare?: number }>> = nfc({
  sava: { delta: 0.25, bare: 1 }, sawa: { delta: 0.25, bare: 1 }, 'सवा': { delta: 0.25, bare: 1 },
  saade: { delta: 0.5 }, sade: { delta: 0.5 }, saadhe: { delta: 0.5 }, sadhe: { delta: 0.5 }, 'साढ़े': { delta: 0.5 }, 'साढे': { delta: 0.5 },
  paune: { delta: -0.25 }, pone: { delta: -0.25 }, 'पौने': { delta: -0.25 },
});
const TENURE_WORDS = new Set(['month', 'months', 'mahine', 'mahina', 'mahino', 'mahinon', 'mo', 'year', 'years', 'yr', 'yrs', 'saal', 'sal', 'महीने', 'महीना', 'साल'].map((k) => k.normalize('NFC')));
/** Words that break a spoken number ("set loan amount to 80000": "to" is not "two"). */
const STOP = new Set(['for', 'to', 'too', 'a', 'an', 'the', 'are', 'or', 'of', 'and', 'on']);
/** Words that may sit next to a small number without making it a model number. */
const MONEY_WORDS = new Set([
  'loan', 'amount', 'rs', 'rupees', 'rupee', 'rupaye', 'inr', 'pay', 'repay', 'set', 'make', 'karo', 'kar', 'jama', 'bhar', 'bharo',
  'chuka', 'only', 'is', 'it', 'ka', 'ki', 'ke', 'mera', 'meri', 'de', 'dijiye', 'rakho', 'please', 'change', 'down', 'payment',
]);
const MONEY_CUE = /₹|\b(?:rs\.?|inr|rupees?|rupaye)\b|रुपये|रुपए/i;

export interface AmountHit {
  /** Whole rupees. */
  value: number;
  /** The utterance marks it as money (scale word, k / L, ₹ / rupees, comma grouping) or it is ≥ 1000. */
  scaled: boolean;
  /** The digits as they came out of the parse ("100000"). */
  raw: string;
}

/** Indian ("1,10,000") or international ("110,000") comma grouping: always money. */
const GROUPED_RE = /(?<![\d,])\d{1,3}(?:,\d{2})*,\d{3}(?![\d,])|(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])/g;

const devDigits = (s: string): string => s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

/** Lower case tokens; "95k" → 95 k, "2.5L" → 2.5 l (capital L or attached l only), "1.2lakh" → 1.2 lakh. */
function tokens(text: string): { toks: string[]; grouped: boolean } {
  let s = devDigits((text ?? '').normalize('NFC'));
  let grouped = false;
  s = s.replace(GROUPED_RE, (m) => { grouped = true; return m.replace(/,/g, ''); });
  s = s.replace(/₹/g, ' rs ');
  // Shorthand scales right after digits. A spaced lower-case "5 l" is left alone (could be a letter).
  s = s.replace(/(\d)\s?(?:L)\b/g, '$1 l').replace(/(\d)l\b/g, '$1 l').replace(/(\d)\s?[kK]\b/g, '$1 k');
  s = s.toLowerCase().replace(/(\d)([a-zऀ-ॿ])/g, '$1 $2');
  const toks = s.split(/[^a-z0-9.ऀ-ॿ]+/).map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  return { toks, grouped };
}

const isDigits = (t: string): boolean => /^\d+(?:\.\d+)?$/.test(t);
const wordValue = (t: string): number | undefined => UNITS[t] ?? TWO_DIGIT[t] ?? DEV_WORDS[t];
const numberish = (t: string | undefined): boolean => t !== undefined && !STOP.has(t) && (isDigits(t) || wordValue(t) !== undefined);

type Span = { value: number; end: number; scaled: boolean; plainDigits: boolean };

/** Read one spoken number starting at toks[i], or null. */
function readNumber(toks: string[], i: number): Span | null {
  let total = 0;
  let current = 0;
  let saw = false;
  let scaled = false;
  let plainDigits = true;
  let j = i;
  let lastWasDigitRun = false;
  while (j < toks.length) {
    const t = toks[j];
    if (STOP.has(t)) break;
    if (FRACTION[t] !== undefined && SCALES[toks[j + 1]] !== undefined && SCALES[toks[j + 1]] >= 1000) {
      current += FRACTION[t]; saw = true; plainDigits = false; lastWasDigitRun = false; j += 1; continue;
    }
    const mod = MODIFIER[t];
    if (mod) {
      const next = toks[j + 1];
      const n = next !== undefined && numberish(next) ? (isDigits(next) ? Number(next) : wordValue(next)!) : undefined;
      if (n !== undefined && SCALES[toks[j + 2]] >= 1000) { current += n + mod.delta; saw = true; plainDigits = false; j += 2; lastWasDigitRun = false; continue; }
      if (mod.bare !== undefined && SCALES[next] >= 1000) { current += mod.bare + mod.delta; saw = true; plainDigits = false; j += 1; lastWasDigitRun = false; continue; }
      break;
    }
    const scale = SCALES[t];
    // "l" and "k" are scales only right after a number.
    if (scale !== undefined && (saw || (t !== 'l' && t !== 'k'))) {
      if (!saw && (t === 'l' || t === 'k')) break;
      if (scale === 100) current = (current || 1) * 100;
      else { total += (current || 1) * scale; current = 0; }
      saw = true; if (scale >= 1000) scaled = true; plainDigits = false; lastWasDigitRun = false; j += 1; continue;
    }
    if (isDigits(t)) {
      const single = /^\d$/.test(t);
      if (!saw) current = Number(t);
      else if (lastWasDigitRun && single) current = current * 10 + Number(t); // spaced digits "1 2 3" are one run
      else if (current === 0) current = Number(t); // "1 lakh 20 thousand"
      else break;
      saw = true; lastWasDigitRun = single || lastWasDigitRun; j += 1; continue;
    }
    const w = wordValue(t);
    if (w !== undefined) {
      // "twenty three" → 23; "one twenty five" → 125 (a model read-out, never money unless a scale follows).
      let n = w;
      const next = toks[j + 1];
      if (n >= 20 && n % 10 === 0 && next !== undefined && UNITS[next] !== undefined && UNITS[next] !== 0 && !STOP.has(next)) { n += UNITS[next]; j += 1; }
      if (saw && current !== 0 && current % 10 !== 0 && n < 10) break;
      current += n; saw = true; plainDigits = false; lastWasDigitRun = false; j += 1; continue;
    }
    break;
  }
  if (!saw) return null;
  // A lone unit word with no scale ("kar do", "one") is a word, not a number (the server keeps it as text).
  if (!scaled && j - i === 1 && UNITS[toks[i]] !== undefined) return null;
  return { value: Math.round(total + current), end: j, scaled, plainDigits };
}

/**
 * First rupee amount in `text` (same rules as the server's find_amount), or null.
 * `scaled` = the text itself marks it as money, or it is ≥ 1000.
 */
export function findAmount(text: string): AmountHit | null {
  if (!(text ?? '').trim()) return null;
  const { toks, grouped } = tokens(text);
  const cue = grouped || MONEY_CUE.test(text);
  for (let i = 0; i < toks.length; i++) {
    if (!numberish(toks[i]) && FRACTION[toks[i]] === undefined && MODIFIER[toks[i]] === undefined) continue;
    const span = readNumber(toks, i);
    if (!span) continue;
    const next = toks[span.end];
    if (next !== undefined && TENURE_WORDS.has(next)) { i = span.end; continue; }
    const n = span.value;
    if (n <= 0) { i = span.end - 1; continue; }
    if (span.plainDigits && String(n).length >= 10) { i = span.end - 1; continue; }
    const scaled = span.scaled || cue || n >= 1000;
    if (!scaled && n < 1000) {
      // A small bare number next to a name word is a model number ("bullet 350", "xtreme 125").
      const prev = toks[i - 1];
      const near = [prev, next].filter((t): t is string => t !== undefined && /^[a-z]{2,}$/.test(t) && !MONEY_WORDS.has(t) && !STOP.has(t));
      if (near.length) { i = span.end - 1; continue; }
    }
    return { value: n, scaled, raw: String(n) };
  }
  return null;
}

/** A money-looking amount is in the text ("1 lakh", "95k", "80000", "1,10,000"). */
export const hasScaledAmount = (text: string): boolean => !!findAmount(text)?.scaled;

/** Indian grouping with the rupee sign: 100000 → ₹1,00,000, 95000 → ₹95,000, 1250000 → ₹12,50,000. */
export function formatInr(n: number): string {
  const v = Math.round(n);
  const neg = v < 0;
  let s = String(Math.abs(v));
  if (s.length > 3) {
    let head = s.slice(0, -3);
    const tail = s.slice(-3);
    const parts: string[] = [];
    while (head.length > 2) { parts.unshift(head.slice(-2)); head = head.slice(0, -2); }
    if (head) parts.unshift(head);
    s = `${parts.join(',')},${tail}`;
  }
  return `${neg ? '-' : ''}₹${s}`;
}

/** Nearest multiple of `step`, half up (1,02,500 / 5,000 → 1,05,000). */
export function roundToStep(n: number, step?: number): number {
  if (!step || step <= 1) return Math.round(n);
  return Math.floor(n / step + 0.5) * step;
}

/** ['over', max] / ['under', min] when `value` is outside the range, limits snapped onto the step grid inside it. */
export function clampOffer(value: number, f: { min?: number; max?: number; step?: number } | null | undefined): ['over' | 'under', number] | null {
  if (!f) return null;
  const { step, max: hi, min: lo } = f;
  if (hi !== undefined && value > hi) {
    let lim = step && step > 1 ? Math.floor(hi / step) * step : hi;
    if (lo !== undefined && lim < lo) lim = hi;
    return ['over', lim];
  }
  if (lo !== undefined && value < lo) {
    let lim = step && step > 1 ? Math.ceil(lo / step) * step : lo;
    if (hi !== undefined && lim > hi) lim = lo;
    return ['under', lim];
  }
  return null;
}

/** Words of the text other than the number itself and harmless filler (a bare amount = nothing else said). */
export function nonAmountWords(text: string, filler: ReadonlySet<string>): string[] {
  const { toks } = tokens(text);
  return toks.filter((t) => !numberish(t) && SCALES[t] === undefined && FRACTION[t] === undefined && MODIFIER[t] === undefined && !filler.has(t) && !STOP.has(t));
}
