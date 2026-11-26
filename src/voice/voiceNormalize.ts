/**
 * Text normalization for on-device intent matching (v1.4.0). A TypeScript port of
 * firstgo-voice-local/src/normalize.py that reads every table (synonyms, stopwords, Devanagari
 * transliteration) from the generated catalogue, so the app and the server normalize identically.
 * Pure: no React Native imports (unit-tested in Node).
 */
import { COMMAND_CATALOG } from './commandCatalog.generated';

const C = COMMAND_CATALOG;
const DEV = C.devanagari as unknown as { vowels: Record<string, string>; matras: Record<string, string>; consonants: Record<string, string>; nukta: Record<string, string> };
const WORD_SYNONYMS = C.wordSynonyms as unknown as Record<string, string>;
const STOPWORDS: ReadonlySet<string> = new Set(C.stopwords as readonly string[]);
const PHRASE_SYNONYMS: readonly [RegExp, string][] = (C.phraseSynonyms as unknown as [string, string][]).map(([p, r]) => [new RegExp(p, 'g'), r]);

const DEV_RE = /[ऀ-ॿ]/;
const VIRAMA = '्';
const NUKTA_SIGN = '़';

export const isDevanagari = (s: string): boolean => DEV_RE.test(s);

/** Rough Hindi → Latin (the hi-IN recognizer returns Devanagari; English loan words stay close to their spelling). */
export function transliterateDevanagari(input: string): string {
  if (!isDevanagari(input)) return input;
  const chars = [...input.normalize('NFC')];
  const out: string[] = [];
  let wordPos = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x0966 && code <= 0x096f) { out.push(String(code - 0x0966)); wordPos += 1; continue; }
    if (c === '।' || c === '॥') { out.push('. '); wordPos = 0; continue; }
    if (DEV.vowels[c]) { out.push(DEV.vowels[c]); wordPos += 1; continue; }
    if (DEV.matras[c]) { out.push(DEV.matras[c]); continue; }
    if (c === 'ं' || c === 'ँ') { out.push('n'); continue; }
    if (c === 'ः') { out.push('h'); continue; }
    if (c === VIRAMA || c === NUKTA_SIGN) continue;
    const hasNukta = chars[i + 1] === NUKTA_SIGN;
    const cons = hasNukta ? (DEV.nukta[c] ?? DEV.consonants[c]) : DEV.consonants[c];
    if (cons) {
      out.push(cons);
      const next = chars[hasNukta ? i + 2 : i + 1];
      if (wordPos === 0 && next !== undefined && DEV.consonants[next]) out.push('a');
      wordPos += 1;
      continue;
    }
    if (/\s/.test(c)) wordPos = 0;
    out.push(c);
  }
  return out.join('');
}

/** Lowercase, transliterate, apply phrase + word synonyms, strip punctuation, collapse spaces. */
export function normalizeText(input: string): string {
  let s = transliterateDevanagari(input ?? '');
  s = s.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase();
  s = s.replace(/[‘’`]/g, "'").replace(/₹/g, ' rs ');
  for (const [rx, rep] of PHRASE_SYNONYMS) { rx.lastIndex = 0; s = s.replace(rx, rep); }
  s = s.replace(/'s\b/g, 's').replace(/[^a-z0-9\s]/g, ' ');
  return s.split(/\s+/).filter(Boolean).map((w) => WORD_SYNONYMS[w] ?? w).join(' ').trim();
}

export const tokenize = (normalized: string): string[] => normalized.split(' ').filter((t) => t && !STOPWORDS.has(t));

export function phoneticKey(word: string): string {
  if (/^\d+$/.test(word)) return word;
  let w = word.replace(/ph/g, 'f').replace(/([sckgtdbjr])h/g, '$1');
  w = w.replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks');
  w = w.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
  w = w.replace(/ee|ea/g, 'i').replace(/oo/g, 'u').replace(/oa/g, 'o').replace(/ov$/, 'o');
  w = w.replace(/ai|ay|ei/g, 'e').replace(/au|ou/g, 'o').replace(/y$/, 'i').replace(/(.)\1+/g, '$1');
  if (w.length > 3) w = w.replace(/e$/, '');
  return w;
}

let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (rowA.length <= b.length) { rowA = new Int32Array(b.length + 1); rowB = new Int32Array(b.length + 1); }
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const mx = Math.max(a.length, b.length);
  return mx === 0 ? 1 : 1 - levenshtein(a, b) / mx;
}

const DIGITS = /^\d+$/;
export function tokenSimilarity(a: string, b: string, pa?: string, pb?: string): number {
  if (a === b) return 1;
  if (DIGITS.test(a) || DIGITS.test(b)) return 0;
  const s = similarity(a, b);
  if (s === 1) return 1;
  return Math.max(s, similarity(pa ?? phoneticKey(a), pb ?? phoneticKey(b)));
}
