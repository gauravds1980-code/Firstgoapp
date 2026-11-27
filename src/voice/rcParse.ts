/**
 * v1.4.5 S2.4 spoken RC (vehicle registration) number — phone mirror of the server's src/rc_reg.py `parse`.
 *
 *   "M H 12 B C 1 2 6 0" / "MH12BC1260" / "M H twelve B C one two six zero" / "em ech twelve bee see 1260" /
 *   "M for Mumbai H for Hotel 12 B C 1260" / "Mike Hotel 12 Bravo Charlie 1260" / "double one" / "22 BH 1234 AA" /
 *   "एम एच 12 बी सी 1260"  →  "MH12BC1260" (storage; display "MH 12 BC 1260"; read-back "M H twelve B C one two six zero").
 *
 * The shape is the typed REG_REGEX core (business.ts: 2-letter state, 1–2 digit RTO, 0–3 series letters, exactly 4
 * digits; BH series YY BH NNNN L[L]); the state code is checked against the official list and STT confusions are
 * snapped (KH → MH, EP → AP, …), preferring the dealer's state (default MH). Unknown code → `bad_code` with a spoken
 * correction (never filled). Letters + digits are never an OTP. Pure: no React Native imports.
 */
import { BH_REG_RE, normaliseReg, NORMAL_REG_RE, prettyReg, REG_REGEX } from '../services/business';

export const DEFAULT_STATE = 'MH';
export const STATE_CODES: ReadonlySet<string> = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'CT', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL',
  'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TG', 'TN', 'TR', 'TS', 'UK',
  'UA', 'UP', 'WB',
]);
const CONFUSIONS: Readonly<Record<string, string>> = {
  KH: 'MH', NH: 'MH', MS: 'MH', EH: 'MH', EP: 'AP', AB: 'AP', DE: 'DL', TM: 'TN', KE: 'KA', KY: 'KA', GH: 'GJ', OB: 'OD', VB: 'WB',
  BB: 'WB', HL: 'HR', UB: 'UP', JI: 'GJ', PP: 'PB', TL: 'TS', EL: 'KL',
};
const SIMILAR = new Set(['MN', 'BP', 'BD', 'BV', 'PT', 'DT', 'TV', 'EA', 'JG', 'JZ', 'SF', 'SX', 'EI', 'IY', 'KQ', 'KC', 'MK', 'HA', 'UO', 'LR', 'BW', 'VW']
  .map((p) => [...p].sort().join('')));
const similar = (a: string, b: string) => SIMILAR.has([a, b].sort().join(''));

const LETTER_NAMES: Readonly<Record<string, string>> = {
  a: 'A', ay: 'A', ae: 'A', ei: 'A', b: 'B', be: 'B', bee: 'B', bi: 'B', c: 'C', see: 'C', sea: 'C', cee: 'C', si: 'C', d: 'D', dee: 'D', di: 'D',
  e: 'E', ee: 'E', f: 'F', ef: 'F', eff: 'F', g: 'G', gee: 'G', jee: 'G', h: 'H', aitch: 'H', ech: 'H', etch: 'H', eich: 'H', hech: 'H', edge: 'H',
  ach: 'H', i: 'I', aye: 'I', eye: 'I', j: 'J', jay: 'J', je: 'J', k: 'K', kay: 'K', ke: 'K', kei: 'K', l: 'L', el: 'L', ell: 'L', m: 'M', em: 'M',
  emm: 'M', n: 'N', en: 'N', enn: 'N', p: 'P', pee: 'P', pi: 'P', q: 'Q', queue: 'Q', cue: 'Q', kyu: 'Q', r: 'R', ar: 'R', aar: 'R', are: 'R',
  s: 'S', es: 'S', ess: 'S', t: 'T', tee: 'T', ti: 'T', tea: 'T', u: 'U', you: 'U', yu: 'U', v: 'V', vee: 'V', vi: 'V', w: 'W', dablyu: 'W',
  dabalu: 'W', x: 'X', ex: 'X', eks: 'X', y: 'Y', why: 'Y', wai: 'Y', vai: 'Y', z: 'Z', zed: 'Z', zee: 'Z', jed: 'Z', zedd: 'Z',
};
const NATO: Readonly<Record<string, string>> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', charly: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I',
  juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S',
  tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
};
const DEV_LETTERS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({
  'ए': 'A', 'बी': 'B', 'सी': 'C', 'डी': 'D', 'ई': 'E', 'एफ': 'F', 'जी': 'G', 'एच': 'H', 'आई': 'I', 'जे': 'J', 'के': 'K', 'एल': 'L', 'एम': 'M',
  'एन': 'N', 'ओ': 'O', 'पी': 'P', 'क्यू': 'Q', 'आर': 'R', 'एस': 'S', 'टी': 'T', 'यू': 'U', 'वी': 'V', 'डब्ल्यू': 'W', 'एक्स': 'X', 'वाई': 'Y',
  'ज़ेड': 'Z', 'जेड': 'Z', 'ज़ी': 'Z',
}).map(([k, v]) => [k.normalize('NFC'), v]));
/** server DIGIT_WORDS minus o / oh / do / doo / che / nil / nav, plus do, doo, barh, shuny, chhah. */
const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0', nought: '0', shunya: '0', sunya: '0', shoonya: '0', bindu: '0', shuny: '0', one: '1', ek: '1', ekam: '1', two: '2', do: '2', doo: '2',
  three: '3', teen: '3', four: '4', char: '4', chaar: '4', five: '5', paanch: '5', panch: '5', paanchh: '5', six: '6', chhe: '6', chhah: '6', chha: '6',
  chhey: '6', seven: '7', saat: '7', eight: '8', aath: '8', ath: '8', nine: '9', nau: '9', nao: '9', barh: '12',
};
const TEENS: Readonly<Record<string, number>> = {
  ten: 10, das: 10, duss: 10, eleven: 11, gyarah: 11, gyaarah: 11, twelve: 12, barah: 12, baarah: 12, thirteen: 13, terah: 13, fourteen: 14, chaudah: 14,
  chauda: 14, fifteen: 15, pandrah: 15, pandra: 15, pendrah: 15, sixteen: 16, solah: 16, sola: 16, seventeen: 17, satrah: 17, satra: 17, eighteen: 18,
  atharah: 18, athara: 18, athhaarah: 18, nineteen: 19, unnees: 19, unnis: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20, bees: 20, bis: 20, thirty: 30, tees: 30, forty: 40, chalis: 40, chaalis: 40, fifty: 50, pachaas: 50, pachas: 50, sixty: 60, saath: 60,
  seventy: 70, sattar: 70, eighty: 80, assi: 80, ninety: 90, nabbe: 90, navve: 90, nabbey: 90,
};
const DEV_DIGITS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({
  'शून्य': 0, 'जीरो': 0, 'ज़ीरो': 0, 'सुन्न': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'पंच': 5, 'छह': 6, 'छः': 6, 'छे': 6, 'छै': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'नो': 9,
  'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15, 'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20,
  'इक्कीस': 21, 'बाईस': 22, 'तेईस': 23, 'चौबीस': 24, 'पच्चीस': 25, 'छब्बीस': 26, 'सत्ताईस': 27, 'अट्ठाईस': 28, 'उनतीस': 29, 'तीस': 30, 'इकतीस': 31,
  'बत्तीस': 32, 'तैंतीस': 33, 'चौंतीस': 34, 'पैंतीस': 35, 'छत्तीस': 36, 'सैंतीस': 37, 'अड़तीस': 38, 'उनतालीस': 39, 'चालीस': 40, 'इकतालीस': 41,
  'बयालीस': 42, 'तैंतालीस': 43, 'चवालीस': 44, 'पैंतालीस': 45, 'छियालीस': 46, 'सैंतालीस': 47, 'अड़तालीस': 48,
}).map(([k, v]) => [k.normalize('NFC'), v < 10 ? String(v) : String(v).padStart(2, '0')]));
const AMBIG: Readonly<Record<string, string[]>> = { o: ['O', '0'], oh: ['O', '0'] };
const FILLER = new Set(['is', 'hai', 'he', 'h', 'the', 'number', 'no', 'num', 'and', 'then', 'space', 'dash', 'hyphen', 'please', 'ji', 'sir', 'ok',
  'okay', 'karo', 'kar', 'kardo', 'dijiye', 'plate', 'rc', 'registration', 'reg', 'vehicle', 'gaadi', 'gadi', 'gaddi', 'ki', 'my', 'mera', 'meri',
  'uska', 'it', 's', 'its', "it's", 'naya', 'new']);
/** Words that mean "this is not a plate" (an OTP, an amount, a command). */
const NOT_PLATE = new Set(['otp', 'pin', 'code', 'lakh', 'lakhs', 'thousand', 'rupees', 'rs', 'hazaar', 'crore', 'months', 'month', 'emi', 'loan',
  'pay', 'repay', 'phone', 'mobile']);
const LEAD_RE = /^.*?\b(?:(?:rc|r c|registration|reg|vehicle|gaadi|gadi|gaddi|plate)\s*(?:number|no|num)?|number plate|registration)\s*(?:is|hai|he|:)?\s+/i;
const FOR_RE = /\b([a-z])\s+(?:for|as in|jaise|like)\s+[a-z]+\b/gi;
const TRAIL_RE = /\s+(?:for|of|ka|ki)\s+[a-z]+(?:\s+[a-z]+)?\s*$/i;
const DEVANAGARI_NUMERAL = /[०-९]/g;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS_EN = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_EN: Readonly<Record<number, string>> = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty', 6: 'sixty', 7: 'seventy', 8: 'eighty', 9: 'ninety' };

export type RcParse =
  | { kind: 'valid'; value: string; display: string; readBack: string; snappedFrom: string | null }
  | { kind: 'bad_code' | 'bad_shape'; value: ''; error: string };

/** Per-token alternatives, letter count and unknown words; null = not plate-like at all. */
function alternatives(text: string): { alts: string[][]; letters: number; unknown: string[] } | null {
  let s = (text ?? '').normalize('NFC').replace(DEVANAGARI_NUMERAL, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/['’]/g, ' ');
  s = s.replace(/[.,\-_/]/g, ' ');
  s = s.replace(LEAD_RE, '');
  s = s.replace(FOR_RE, (_m, l: string) => l);
  s = s.replace(TRAIL_RE, '');
  const toks = s.match(/[ऀ-ॿ]+|[A-Za-z]+|\d+/g) ?? [];
  const alts: string[][] = [];
  let letters = 0;
  const unknown: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i];
    const t = raw.toLowerCase();
    const nxt = toks[i + 1]?.toLowerCase();
    if (NOT_PLATE.has(t)) return null;
    if (/^\d+$/.test(t)) alts.push([t]);
    else if (['double', 'dubble', 'triple', 'treble'].includes(t) && nxt !== undefined) {
      const n = t === 'double' || t === 'dubble' ? 2 : 3;
      if (/^\d$/.test(nxt)) { alts.push([nxt.repeat(n)]); i++; }
      else if (DIGIT_WORDS[nxt] !== undefined) { alts.push([DIGIT_WORDS[nxt].repeat(n)]); i++; }
      else if (['u', 'you', 'yu'].includes(nxt) && n === 2) { alts.push(['W']); letters++; i++; }
      else if (LETTER_NAMES[nxt] || NATO[nxt]) { alts.push([(LETTER_NAMES[nxt] ?? NATO[nxt]).repeat(n)]); letters++; i++; }
      else if (AMBIG[nxt]) { alts.push(['O'.repeat(n), '0'.repeat(n)]); i++; }
      else unknown.push(t);
    } else if (TENS[t] !== undefined) {
      let n = TENS[t];
      const d = nxt !== undefined ? DIGIT_WORDS[nxt] : undefined;
      if (d !== undefined && d !== '0' && d.length === 1) { n += Number(d); i++; }
      alts.push([String(n)]);
    } else if (TEENS[t] !== undefined) alts.push([String(TEENS[t])]);
    else if (DEV_LETTERS[raw]) { alts.push([DEV_LETTERS[raw]]); letters++; }
    else if (DEV_DIGITS[raw] !== undefined) alts.push([DEV_DIGITS[raw]]);
    else if (AMBIG[t]) alts.push([...AMBIG[t]]);
    else if (DIGIT_WORDS[t] !== undefined) alts.push([DIGIT_WORDS[t]]);
    else if (NATO[t]) { alts.push([NATO[t]]); letters++; }
    else if (FILLER.has(t) && !(t === 'h' && alts.length)) { /* filler */ }
    else if (LETTER_NAMES[t]) { alts.push([LETTER_NAMES[t]]); letters++; }
    else if (/^[a-z]{1,3}$/.test(t)) { alts.push([t.toUpperCase()]); letters += t.length; }
    else if (['for', 'as', 'in', 'jaise', 'like'].includes(t)) { /* "M for Mumbai" leftovers */ }
    else unknown.push(t);
  }
  return { alts, letters, unknown };
}

function* product(alts: string[][], limit = 256): Generator<string> {
  let n = 0;
  const rec = function* (i: number, acc: string): Generator<string> {
    if (n >= limit) return;
    if (i === alts.length) { n++; yield acc; return; }
    for (const a of alts[i]) yield* rec(i + 1, acc + a);
  };
  yield* rec(0, '');
}

const diff = (a: string, b: string) => [...a].filter((c, i) => c !== b[i]).length;

/** The state code itself, the dealer state (one letter off), a known confusion, or a unique similar-letter neighbour. */
export function snapState(code: string, dealer: string = DEFAULT_STATE): string | null {
  if (STATE_CODES.has(code)) return code;
  if (STATE_CODES.has(dealer) && diff(code, dealer) === 1) return dealer;
  if (CONFUSIONS[code]) return CONFUSIONS[code];
  const near = [...STATE_CODES].filter((c) => diff(code, c) === 1 && [...code].every((ch, i) => ch === c[i] || similar(ch, c[i])));
  return near.length === 1 ? near[0] : null;
}

const readDigits = (d: string) => [...d].map((c) => ONES[Number(c)]).join(' ');
function readRto(d: string): string {
  if (d.length === 1 || d.startsWith('0')) return readDigits(d);
  const n = Number(d);
  if (n < 20) return TEENS_EN[n - 10];
  return TENS_EN[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

/** "MH12BC1260" → "M H twelve B C one two six zero". */
export function readBackReg(value: string): string {
  const m = value.match(NORMAL_REG_RE);
  if (m) return [[...m[1]].join(' '), readRto(m[2]), ...(m[3] ? [[...m[3]].join(' ')] : []), readDigits(m[4])].join(' ');
  const b = value.match(BH_REG_RE);
  if (b) return `${readDigits(b[1])} B H ${readDigits(b[3])} ${[...b[4]].join(' ')}`;
  return [...value].join(' ');
}

/** A complete, valid plate (typed or spoken storage form): REG_REGEX + a real state code (BH series has none). */
export function isValidReg(value: string): boolean {
  const v = normaliseReg(value ?? '');
  if (!REG_REGEX.test(v)) return false;
  const m = v.match(NORMAL_REG_RE);
  return m ? STATE_CODES.has(m[1]) : BH_REG_RE.test(v);
}

/** Spoken / typed plate → parse result; null = not a plate. `dealerState` biases the state snap (default MH). */
export function parseRc(text: string, dealerState?: string): RcParse | null {
  const dealer = (dealerState || DEFAULT_STATE).toUpperCase().slice(0, 2);
  const r = alternatives(text);
  if (!r || !r.alts.length) return null;
  const { alts, letters, unknown } = r;
  type Cand = { kind: 'valid'; value: string; snappedFrom: string | null; rank: number } | { kind: 'bad_code'; value: string; code: string; rank: number };
  let best: Cand | null = null;
  for (let s of product(alts)) {
    if (s.startsWith('DEL') && s.length > 3 && /\d/.test(s[3])) s = `DL${s.slice(3)}`;
    let cand: Cand | null = null;
    const m = s.match(NORMAL_REG_RE);
    if (m) {
      const snapped = snapState(m[1], dealer);
      cand = snapped ? { kind: 'valid', value: snapped + s.slice(2), snappedFrom: snapped === m[1] ? null : m[1], rank: snapped === m[1] ? 0 : 1 }
        : { kind: 'bad_code', value: s, code: m[1], rank: 2 };
    } else if (BH_REG_RE.test(s)) cand = { kind: 'valid', value: s, snappedFrom: null, rank: 0 };
    if (cand && (!best || cand.rank < best.rank)) best = cand;
  }
  const digits = alts.reduce((n, a) => n + (/^\d+$/.test(a[0]) ? a[0].length : 0), 0);
  if (!best) {
    if (letters >= 1 && digits >= 1 && !unknown.length) return { kind: 'bad_shape', value: '', error: 'Say the full RC number, like M H 12 A B 1234.' };
    return null;
  }
  if (unknown.length && best.kind !== 'valid') return null;
  if (best.kind === 'bad_code') {
    const example = STATE_CODES.has(dealer) ? dealer : DEFAULT_STATE;
    return { kind: 'bad_code', value: '', error: `${[...best.code].join(' ')} is not an Indian state code. Say the RC number again, like ${[...example].join(' ')} 12 A B 1234.` };
  }
  return { kind: 'valid', value: best.value, display: prettyReg(best.value), readBack: readBackReg(best.value), snappedFrom: best.snappedFrom };
}
