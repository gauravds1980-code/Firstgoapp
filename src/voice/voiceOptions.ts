/**
 * Registry of the chips the dealer can tap on the focused screen (vehicle models, tenures, …).
 * Screens register on focus and clear on blur; currentCommandContext() sends them with /command as
 * `options` so the server can resolve "select Xtreme 125" against what is actually on screen.
 *
 * Plain module (no React / React Native imports) so it can be unit-tested in Node and read from
 * non-hook code. Also holds the vehicle-name matcher the Asset screen uses for a confirmed select.
 */
import type { VoiceOption } from './types';

let current: { owner: number; route?: string; options: VoiceOption[] } | null = null;
let nextOwner = 1;

/**
 * Register the focused screen's options. `route` (when given) limits sending to that route, so a
 * screen left in the stack never leaks its chips. Returns a token for `clearVoiceOptions`.
 */
export function setVoiceOptions(options: VoiceOption[], route?: string): number {
  const owner = nextOwner++;
  current = { owner, ...(route ? { route } : {}), options: options.slice() };
  return owner;
}

/** Clear the registry. With a token, only clears if that registration is still the current one. */
export function clearVoiceOptions(token?: number): void {
  if (token === undefined || current?.owner === token) current = null;
}

/** Registered options (for `route`, when the registration was route-scoped). */
export function getVoiceOptions(route?: string): VoiceOption[] {
  if (!current) return [];
  if (current.route && route && current.route !== route) return [];
  return current.options;
}

/** Short brand used in chip labels. Mirrors firstgo-voice-local data/catalogue.json `shortBrand`. */
const SHORT_BRAND: Readonly<Record<string, string>> = {
  'Hero MotoCorp': 'Hero',
  'Royal Enfield': 'Royal Enfield',
  'Maruti Suzuki': 'Maruti',
  'Tata Motors': 'Tata',
};

export const shortBrand = (brand: string): string => SHORT_BRAND[brand] ?? brand;

/** "Hero Xtreme 125R" — the label the server also builds for this row. */
export const vehicleLabel = (a: { brand: string; model: string }): string => `${shortBrand(a.brand)} ${a.model}`.trim();

/** Filler words that may surround a spoken model name. */
const FILLER = new Set([
  'select', 'choose', 'pick', 'take', 'the', 'a', 'an', 'model', 'vehicle', 'bike', 'scooter', 'car', 'please',
  'one', 'this', 'that', 'want', 'i', 'we', 'go', 'with', 'for', 'customer',
]);

/**
 * Lowercase tokens with punctuation removed. "+" → "plus", "extreme" → "xtreme", and a trailing
 * R / S / X on a number ("125R", "450X") is optional, so it is dropped on both sides.
 */
export function vehicleTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t === 'extreme' ? 'xtreme' : t))
    .map((t) => (/^\d+[rsx]$/.test(t) ? t.slice(0, -1) : t));
}

export interface CatalogueRowLike { id: string; brand: string; model: string }

/**
 * Match a spoken / drafted vehicle name against catalogue rows. A row matches when every token of
 * its model is in the text ("select extreme 125" ⊇ "xtreme 125"), or when the text (minus brand and
 * filler words) is a part of the model that includes a word ("apache rtr" ⊆ "apache rtr 160 4v").
 * Returns the single best row, or null when nothing matches or the best is a tie.
 */
export function matchVehicleRow<T extends CatalogueRowLike>(text: string | undefined, rows: readonly T[]): T | null {
  if (!text || !text.trim()) return null;
  const byId = rows.find((r) => r.id === text.trim());
  if (byId) return byId;
  const all = vehicleTokens(text);
  const brandWords = new Set(rows.flatMap((r) => [...vehicleTokens(r.brand), ...vehicleTokens(shortBrand(r.brand))]));
  const q = all.filter((t) => !FILLER.has(t));
  const qSet = new Set(q);
  const qCore = q.filter((t) => !brandWords.has(t));
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const r of rows) {
    const m = vehicleTokens(r.model);
    if (!m.length) continue;
    const mSet = new Set(m);
    let score = 0;
    if (m.every((t) => qSet.has(t))) {
      score = 100 + m.length;
    } else if (qCore.length && qCore.some((t) => /[a-z]{3,}/.test(t)) && qCore.every((t) => mSet.has(t))) {
      score = 10 + qCore.length;
    }
    if (!score) continue;
    // Brand words in the text that belong to this row break ties ("Tata Nexon" vs another "Nexon").
    const rb = new Set([...vehicleTokens(r.brand), ...vehicleTokens(shortBrand(r.brand))]);
    if (q.some((t) => rb.has(t))) score += 0.5;
    if (score > bestScore) { best = r; bestScore = score; tie = false; } else if (score === bestScore) { tie = true; }
  }
  return tie ? null : best;
}
