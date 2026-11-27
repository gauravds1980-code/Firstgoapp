/**
 * Customer rows by name (v1.4.5, adapted from the fix-rc-pendency leftover). List screens (RC pendency) register their rows as voice options
 * `{ id: LAN, kind: 'customer', label: 'Vikram Rao', value: LAN, lan, vehicle, regNo?, status }`.
 *
 * Same rules as the server's src/select_customer.py, so the phone answers the same when the server is
 * unreachable:
 *   - verbs / RC words / fillers are dropped ("update", "open", "upload", "rc", "registration number", "for");
 *   - the first name must match exactly (or the same spelling by a simple phonetic key), never across first names;
 *   - surname exact → full; misheard surname (edit distance ≤ 1, ≤ 2 for long names, same first letter, or same
 *     phonetic key) → fuzzy; first name only / surname only → when unique. One clear row opens at once (like the
 *     server: opening a row is reversible, upload / submit stay manual taps);
 *   - several rows at the best level → clarify "Did you mean Vikram Rao or Vikram Singh?" (tappable candidates);
 *   - Pending rows win; a Submitted-only hit says it is already submitted;
 *   - a name-like phrase with an RC / update verb and no row → 'absent' ("Sanjay Pawar is not in pending RCs.");
 *   - otherwise null (no customer meant; the caller keeps its own reading).
 * Pure: no React Native imports.
 */
import type { VoiceOption } from './types';

export const CUSTOMER_KIND = 'customer';

const FILLER = new Set([
  'please', 'select', 'choose', 'pick', 'the', 'a', 'an', 'this', 'that', 'of', 'for', 'to', 'me', 'my', 'i',
  'want', 'need', 'is', 'it', 'its', 'and', 'with', 'on', 'in', 'now', 's', 'ji', 'sir', 'mr', 'mrs', 'ms',
  'update', 'updates', 'open', 'show', 'upload', 'share', 'add', 'enter', 'submit', 'put', 'edit', 'fill', 'find',
  'check', 'do', 'take', 'send', 'capture', 'snap', 'click', 'go', 'let', 'us', 'can', 'you',
  'rc', 'rcs', 'r', 'c', 'registration', 'register', 'reg', 'number', 'no', 'photo', 'pic', 'picture', 'image',
  'details', 'detail', 'customer', 'customers', 'pending', 'case', 'loan', 'account', 'lan', 'file', 'document',
  'documents', 'vehicle', 'card', 'book', 'papers', 'record', 'entry', 'his', 'her', 'their',
  'ka', 'ki', 'ke', 'ko', 'karo', 'kar', 'kholo', 'dikhao', 'batao', 'wala', 'wali', 'wale', 'hai', 'na', 'ye', 'yeh',
]);
/** Words of other commands: never part of a name ("open portfolio", "update down payment"). */
const NON_NAME = new Set([
  'home', 'portfolio', 'payout', 'payouts', 'profile', 'cases', 'emi', 'tenure', 'down', 'payment', 'kyc', 'esign',
  'sign', 'mandate', 'help', 'upi', 'qr', 'scan', 'offer', 'submitted', 'tab', 'all', 'list', 'screen', 'back',
  'next', 'continue', 'cancel', 'yes', 'ok', 'okay', 'oldest', 'newest', 'first', 'last', 'new', 'again', 'what',
  'how', 'why', 'say', 'zippy', 'today', 'collections', 'overdue', 'disbursal', 'disbursals', 'disbursed',
  'invoice', 'invoices', 'claim', 'approved', 'rejected', 'status', 'application', 'delivery', 'amount',
  'aadhaar', 'pan', 'face', 'mobile', 'search', 'start', 'journey', 'dealer', 'app', 'them', 'one', 'two',
  'explain', 'repeat', 'talk', 'actions', 'action', 'pay', 'money', 'advance', 'trade', 'bike', 'scooter', 'car',
  'model', 'month', 'months', 'kya', 'nahi', 'mujhe', 'hello', 'hi', 'thanks', 'thank',
]);

export type CustomerLevel = 'full' | 'fuzzy' | 'first' | 'surname';
const RANK: Record<CustomerLevel, number> = { full: 4, fuzzy: 3, first: 2, surname: 1 };

export type CustomerMatch =
  | { kind: 'one'; option: VoiceOption; level: CustomerLevel }
  | { kind: 'several'; options: VoiceOption[] }
  | { kind: 'submitted'; option: VoiceOption }
  | { kind: 'absent'; name: string }
  | null;

/** A request about a customer row (needed before answering "… is not in pending RCs."). */
const VERBS = new Set(['update', 'open', 'upload', 'rc', 'rcs', 'registration', 'reg', 'photo', 'show', 'share', 'add', 'submit', 'find', 'select', 'kholo', 'dikhao', 'enter', 'edit']);

export const nameTokens = (text: string): string[] =>
  (text ?? '').toLowerCase().replace(/['’]/g, ' ').split(/[^a-z0-9ऀ-ॿ]+/).filter(Boolean);

/** Crude Indian-English spelling key: Rao / Rau / Raoo / Row → 'ro'; Vickram → 'vikram'. */
export function phonetic(word: string): string {
  let s = (word ?? '').toLowerCase();
  for (const [a, b] of [['ph', 'f'], ['ck', 'k'], ['q', 'k'], ['w', 'v'], ['z', 'j'], ['oo', 'u'], ['ee', 'i'],
    ['aa', 'a'], ['ao', 'o'], ['au', 'o'], ['ow', 'o'], ['ou', 'o'], ['ov', 'o'], ['ai', 'e'], ['ay', 'e']] as const) {
    s = s.split(a).join(b);
  }
  s = s.replace(/([bcdfgjklmnpqrstvxz])h/g, '$1');
  return s.replace(/(.)\1+/g, '$1');
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length]!;
}

const sameFirst = (q: string, name: string) => q === name || (q.length >= 3 && phonetic(q) === phonetic(name));

export function nearSurname(q: string, name: string): boolean {
  if (q.length < 2 || name.length < 2) return false;
  if (phonetic(q) === phonetic(name)) return true;
  if (q[0] !== name[0]) return false;
  return lev(q, name) <= (name.length >= 7 ? 2 : 1);
}

const isNum = (t: string) => /^\d+$/.test(t);

function scoreRow(q: string[], o: VoiceOption): CustomerLevel | null {
  const parts = nameTokens(o.label);
  if (!parts.length) return null;
  const [first, ...more] = parts as [string, ...string[]];
  const rest = more.filter((p) => p.length >= 2);
  const used = new Set<string>();
  const firstHit = q.find((t) => sameFirst(t, first));
  if (firstHit) used.add(firstHit);
  let exact = 0; let fuzzy = 0;
  for (const s of rest) {
    const hit = q.find((t) => !used.has(t) && t === s);
    if (hit) { exact++; used.add(hit); continue; }
    const near = q.find((t) => !used.has(t) && !isNum(t) && nearSurname(t, s));
    if (near) { fuzzy++; used.add(near); }
  }
  const leftover = q.filter((t) => !used.has(t) && !NON_NAME.has(t) && !isNum(t));
  if (firstHit) {
    if (rest.length && exact === rest.length) return 'full';
    if (exact || fuzzy) return 'fuzzy';
    if (!rest.length) return 'full';
    return leftover.length ? null : 'first'; // "Vikram Pawar" vs Vikram Rao: another surname was said
  }
  return rest.length && exact === rest.length && !leftover.length ? 'surname' : null;
}

/** Match spoken text against the customer rows in `options` (other kinds are ignored). */
export function matchCustomer(text: string, options: readonly VoiceOption[] | undefined): CustomerMatch {
  const rows = (options ?? []).filter((o) => o.kind === CUSTOMER_KIND && o.label?.trim());
  if (!rows.length) return null;
  const q = nameTokens(text).filter((t) => !FILLER.has(t));
  if (!q.length) return null;
  const scored = rows.map((o) => ({ o, level: scoreRow(q, o) })).filter((s): s is { o: VoiceOption; level: CustomerLevel } => !!s.level);
  if (!scored.length) {
    const verb = nameTokens(text).some((t) => VERBS.has(t));
    const nameLike = q.length >= 1 && q.length <= 3 && q.every((t) => /^[a-z]{2,}$/.test(t) && !NON_NAME.has(t));
    const name = q.filter((t) => !NON_NAME.has(t) && !isNum(t) && t.length >= 2).slice(0, 4).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
    return verb && nameLike && name ? { kind: 'absent', name } : null;
  }
  const best = Math.max(...scored.map((s) => RANK[s.level]));
  const top = scored.filter((s) => RANK[s.level] === best);
  const pending = top.filter((s) => s.o.status !== 'Submitted');
  if (!pending.length) return { kind: 'submitted', option: top[0]!.o };
  if (pending.length > 1) return { kind: 'several', options: pending.slice(0, 4).map((s) => s.o) };
  return { kind: 'one', option: pending[0]!.o, level: pending[0]!.level };
}

/** Clarify labels: rows sharing a name get their vehicle / LAN so the dealer can tell them apart. */
export function customerPhrases(opts: readonly VoiceOption[]): string[] {
  return opts.map((o) => {
    const dup = opts.filter((x) => x.label === o.label).length > 1;
    const extra = o.vehicle ?? o.lan ?? o.id;
    return dup && extra ? `${o.label}, ${extra}` : o.label;
  });
}

/** Rows of a list screen as voice options (same helper for every customer list). */
export function customerOptions<T>(rows: readonly T[], pick: (r: T) => { lan: string; name: string; vehicle?: string; regNo?: string; status?: string }): VoiceOption[] {
  return rows.map((r) => {
    const x = pick(r);
    return {
      id: x.lan, kind: CUSTOMER_KIND, label: x.name, name: x.name, loanNo: x.lan, value: x.lan, lan: x.lan,
      ...(x.vehicle ? { vehicle: x.vehicle } : {}), ...(x.regNo ? { regNo: x.regNo } : {}), ...(x.status ? { status: x.status } : {}),
    };
  });
}
