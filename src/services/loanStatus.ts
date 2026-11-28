/**
 * v1.4.9 Feature 5 — Hinglish voice status checks (spec 05-hinglish-voice-status.md, approved by Gaurav).
 * Pure module (no React Native): unit-tested in Node (voice/__tests__/statusVoice.test.ts).
 *
 * ONE list of the dealer's loan files for status questions ("Ramesh ka loan kahan tak pahuncha", "aaj kitne approve
 * hue", "aaj kitna disburse hua"), composed on the phone from:
 *   - the dealer's Money-in-flight files (v1.4.6, in-scope products: used TW, new / used car, new / used CV), and
 *   - a small deterministic applications mock for what Money in flight never tracks: new-TW files (any stage) and
 *     applications not yet sanctioned (KYC / offer pending), plus an older disbursed new-TW case (Ramesh Kale).
 * Home's Today figures (Applied · Approved · Disbursed) come from the SAME list (todayCounts), so a spoken count always
 * matches the tile.
 *
 * Demo "today" = 24 Nov 2026 (Tuesday), clock 11:26 (MIF_NOW). v1.4.6 re-based 1111 so it has no new-TW in-flight
 * files: Ramesh Jadhav is the used Swift (CR-20424, approved today, e-Sign pending) and Pooja Iyer is a used Pulsar
 * (in Money in flight). New-TW files at 1111 are Priya Kulkarni and Sneha Joshi (approved today) and Ramesh Kale
 * (disbursed 12 Oct). The default Hero dealer (new TW only, Money in flight hidden) has its own new-TW files.
 *
 * Spoken lines are Hinglish (Piper readouts); UI labels stay English.
 */
import type { ProductId } from '../config/products';
import { MONTHS, TODAY, type Invoice } from './business';
import type { DealerProfile } from './dealer';
import {
  BLOCKERS, isMoneyInFlightEnabled, mifFilesFor, MIF_NOW, segmentsOf, spokenAmount, STAGE_LABEL, visibleFiles,
  type DealerSegment, type MifFile,
} from './moneyInFlight';

/* ---------------- Types ---------------- */

export type StatusPhase = 'applied' | 'approved' | 'disbursed';
export type StepState = 'done' | 'current' | 'future';
export interface StatusStep { key: string; title: string; detail?: string; at?: Date; state: StepState }
export interface StatusFile {
  lan: string;
  customer: string;
  /** 10-digit customer mobile; shown masked (last 4) only. */
  mobile: string;
  product: ProductId;
  condition: 'new' | 'used';
  vehicle: string;
  /** Sanctioned (or applied-for) loan amount. */
  amount: number;
  segment: DealerSegment;
  /** Tracked by Money in flight (v1.4.6 file). */
  inMif: boolean;
  phase: StatusPhase;
  /** Current stage, English UI label ("e-Sign pending", "Disbursed"). */
  stage: string;
  appliedAt: Date;
  approvedAt?: Date;
  disbursedAt?: Date;
  /** Net credited to the dealer, once disbursed. */
  credited?: number;
  steps: StatusStep[];
  /** The customer has the next step (e-Sign / mandate): the sheet's primary CTA is "Remind customer". */
  remind: boolean;
}

/* ---------------- Mock applications (what Money in flight does not track) ---------------- */

type AppStep = 'kyc' | 'offer' | 'esign' | 'mandate' | 'credited';
type When = [daysAgo: number, hh: number, mm: number];
interface AppSeed {
  customer: string; mobile: string; lan: string; product: ProductId; condition?: 'new' | 'used'; vehicle: string; amount: number;
  step: AppStep; applied: When; approved?: When; disbursed?: When; credited?: number;
}

export type StatusKey = '1111' | '2222' | '3333' | 'default';
const APP_SEEDS: Record<StatusKey, AppSeed[]> = {
  // Shree Auto Mall: two new-TW approvals today (Priya, Sneha) + Ramesh Kale (clarify pair for "Ramesh").
  '1111': [
    { customer: 'Priya Kulkarni', mobile: '9822011115', lan: 'TW-184401', product: 'twoWheeler', vehicle: 'TVS Apache RTR 160', amount: 96000, step: 'esign', applied: [0, 9, 52], approved: [0, 10, 5] },
    { customer: 'Sneha Joshi', mobile: '9822011189', lan: 'TW-184412', product: 'twoWheeler', vehicle: 'Hero Splendor+', amount: 68000, step: 'mandate', applied: [0, 10, 10], approved: [0, 10, 24] },
    { customer: 'Ramesh Kale', mobile: '9822011190', lan: 'TW-184210', product: 'twoWheeler', vehicle: 'Honda Activa 6G', amount: 78000, step: 'credited', applied: [43, 11, 0], approved: [43, 11, 20], disbursed: [43, 16, 30], credited: 76000 },
  ],
  // Sai Motors: one car application today, offer not yet accepted (not sanctioned → not in Money in flight).
  '2222': [
    { customer: 'Nikhil Joshi', mobile: '9822012231', lan: 'CR-20436', product: 'car', vehicle: 'Maruti Brezza', amount: 840000, step: 'offer', applied: [0, 10, 20] },
  ],
  // Tata CV Hub: one CV application today, KYC pending.
  '3333': [
    { customer: 'Prakash Shinde', mobile: '9822013341', lan: 'CV-30230', product: 'cv', vehicle: 'Tata Intra V30', amount: 690000, step: 'kyc', applied: [0, 10, 48] },
  ],
  // ABC Motors (Hero, new TW only — Money in flight hidden): every file lives here.
  default: [
    { customer: 'Rakesh More', mobile: '9822014401', lan: 'TW-185021', product: 'twoWheeler', vehicle: 'Hero Splendor+', amount: 74000, step: 'esign', applied: [0, 9, 35], approved: [0, 9, 48] },
    { customer: 'Swati Kadam', mobile: '9822014402', lan: 'TW-185024', product: 'twoWheeler', vehicle: 'Hero Xtreme 125R', amount: 98000, step: 'mandate', applied: [0, 10, 2], approved: [0, 10, 15] },
    { customer: 'Kiran Jadhav', mobile: '9822014403', lan: 'TW-185027', product: 'twoWheeler', vehicle: 'Hero Vida V2', amount: 112000, step: 'kyc', applied: [0, 11, 5] },
    { customer: 'Ganesh Patil', mobile: '9822014404', lan: 'TW-185009', product: 'twoWheeler', vehicle: 'Hero Splendor+', amount: 71000, step: 'credited', applied: [1, 15, 10], approved: [1, 15, 22], disbursed: [0, 9, 15], credited: 69200 },
  ],
};

export function statusKeyFor(mobile: string | null | undefined): StatusKey {
  const m = mobile ?? '';
  return m.endsWith('1111') ? '1111' : m.endsWith('2222') ? '2222' : m.endsWith('3333') ? '3333' : 'default';
}

const at = ([d, h, m]: When, today: Date = TODAY) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - d, h, m);
const mins = (d: Date, n: number) => new Date(d.getTime() + n * 6e4);
const segmentOf = (product: ProductId, condition: 'new' | 'used'): DealerSegment =>
  `${condition === 'used' ? 'USED' : 'NEW'}_${product === 'twoWheeler' ? 'TW' : product === 'car' ? 'CAR' : 'CV'}` as DealerSegment;

const JOURNEY = ['kyc', 'offer', 'sanctioned', 'esign', 'mandate', 'credited'] as const;
const JOURNEY_TITLE: Record<(typeof JOURNEY)[number], [done: string, current: string]> = {
  kyc: ['KYC complete', 'KYC pending'], offer: ['Offer accepted', 'Offer pending'], sanctioned: ['Sanctioned', 'Sanction pending'],
  esign: ['e-Sign', 'e-Sign pending'], mandate: ['Mandate', 'Mandate pending'], credited: ['Credited', 'Credited'],
};
const CURRENT_INDEX: Record<AppStep, number> = { kyc: 0, offer: 1, esign: 3, mandate: 4, credited: 6 };

function buildApp(s: AppSeed): StatusFile {
  const condition = s.condition ?? 'new';
  const appliedAt = at(s.applied);
  const approvedAt = s.approved ? at(s.approved) : undefined;
  const disbursedAt = s.disbursed ? at(s.disbursed) : undefined;
  const cur = CURRENT_INDEX[s.step];
  const times: (Date | undefined)[] = [
    appliedAt, mins(appliedAt, 13), approvedAt,
    approvedAt && cur > 3 ? mins(approvedAt, 16) : undefined,
    approvedAt && cur > 4 ? mins(approvedAt, 40) : undefined,
    disbursedAt,
  ];
  const steps: StatusStep[] = JOURNEY.map((k, i) => {
    const state: StepState = i < cur ? 'done' : i === cur ? 'current' : 'future';
    const [done, current] = JOURNEY_TITLE[k];
    return {
      key: k, title: state === 'current' ? current : done, state,
      ...(state === 'current' && (k === 'esign' || k === 'mandate') ? { detail: 'Waiting on customer' } : {}),
      ...(state === 'done' && times[i] ? { at: times[i] } : {}),
    };
  });
  const phase: StatusPhase = s.step === 'credited' ? 'disbursed' : approvedAt ? 'approved' : 'applied';
  const stage = s.step === 'credited' ? 'Disbursed' : JOURNEY_TITLE[JOURNEY[cur]!][1];
  return {
    lan: s.lan, customer: s.customer, mobile: s.mobile, product: s.product, condition, vehicle: s.vehicle, amount: s.amount,
    segment: segmentOf(s.product, condition), inMif: false, phase, stage, appliedAt,
    ...(approvedAt ? { approvedAt } : {}), ...(disbursedAt ? { disbursedAt } : {}), ...(s.credited ? { credited: s.credited } : {}),
    steps, remind: s.step === 'esign' || s.step === 'mandate',
  };
}

/** A Money-in-flight file as a status file (same journey language; MIF stages after the mandate). */
export function fromMif(f: MifFile): StatusFile {
  const sanctionedAt = f.history[0]!.at;
  const appliedAt = mins(sanctionedAt, -57);
  const pre = f.stage === 'sanctioned';
  const block = f.blocker;
  const steps: StatusStep[] = [
    { key: 'kyc', title: 'KYC complete', state: 'done', at: appliedAt },
    { key: 'offer', title: 'Offer accepted', state: 'done', at: mins(appliedAt, 13) },
    { key: 'sanctioned', title: 'Sanctioned', state: 'done', at: sanctionedAt },
  ];
  if (pre) {
    const esignCur = block !== 'MANDATE';
    steps.push(
      { key: 'esign', title: esignCur ? 'e-Sign pending' : 'e-Sign', state: esignCur ? 'current' : 'done', ...(esignCur ? { detail: 'Waiting on customer' } : {}) },
      { key: 'mandate', title: esignCur ? 'Mandate' : 'Mandate pending', state: esignCur ? 'future' : 'current', ...(!esignCur ? { detail: 'Waiting on customer' } : {}) },
      { key: 'docsPending', title: STAGE_LABEL.docsPending, state: 'future' },
      { key: 'credited', title: 'Credited', state: 'future' },
    );
  } else {
    steps.push({ key: 'esign', title: 'e-Sign', state: 'done' }, { key: 'mandate', title: 'Mandate', state: 'done' });
    for (const st of ['docsPending', 'disbursalInitiated', 'credited'] as const) {
      const ev = f.history.find((h) => h.stage === st);
      const isCur = f.stage === st;
      steps.push({
        key: st, title: STAGE_LABEL[st], state: isCur && st !== 'credited' ? 'current' : ev ? 'done' : 'future',
        ...(ev ? { at: ev.at } : {}), ...(isCur && block ? { detail: BLOCKERS[block].label } : {}),
      });
    }
  }
  const credited = f.stage === 'credited' && f.credited;
  return {
    lan: f.lan, customer: f.customer, mobile: f.mobile, product: f.product, condition: f.condition, vehicle: f.vehicle, amount: f.sanctioned,
    segment: segmentOf(f.product, f.condition), inMif: true,
    phase: credited ? 'disbursed' : 'approved',
    stage: credited ? 'Credited' : block ? BLOCKERS[block].label : STAGE_LABEL[f.stage],
    appliedAt, approvedAt: sanctionedAt,
    ...(credited ? { disbursedAt: f.credited!.at, credited: f.credited!.amount } : {}),
    steps, remind: block === 'ESIGN' || block === 'MANDATE',
  };
}

/** Every file a status question may name, for the signed-in dealer (Money-in-flight files first). */
export function statusFilesFor(mobile: string | null | undefined, profile: DealerProfile | null | undefined, now: Date = MIF_NOW): StatusFile[] {
  if (!profile) return [];
  const mif = isMoneyInFlightEnabled(profile) ? visibleFiles(mifFilesFor(mobile, profile), now).map(fromMif) : [];
  const segs = segmentsOf(profile);
  const apps = APP_SEEDS[statusKeyFor(mobile)].map(buildApp).filter((f) => segs.includes(f.segment));
  return [...mif, ...apps];
}

/* ---------------- Today (Home tiles + count questions) ---------------- */

const sameDay = (a: Date | undefined, b: Date) => !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const appliedToday = (fs: readonly StatusFile[], now: Date = MIF_NOW) => byTime(fs.filter((f) => sameDay(f.appliedAt, now)), 'appliedAt');
export const approvedToday = (fs: readonly StatusFile[], now: Date = MIF_NOW) => byTime(fs.filter((f) => sameDay(f.approvedAt, now)), 'approvedAt');
export const disbursedToday = (fs: readonly StatusFile[], now: Date = MIF_NOW) => byTime(fs.filter((f) => sameDay(f.disbursedAt, now)), 'disbursedAt');
function byTime(fs: StatusFile[], k: 'appliedAt' | 'approvedAt' | 'disbursedAt'): StatusFile[] {
  return [...fs].sort((a, b) => (a[k]?.getTime() ?? 0) - (b[k]?.getTime() ?? 0));
}
export interface TodayCounts { apps: number; approved: number; disbursed: number; disbursedCount: number }
export function todayCounts(fs: readonly StatusFile[], now: Date = MIF_NOW): TodayCounts {
  const d = disbursedToday(fs, now);
  return { apps: appliedToday(fs, now).length, approved: approvedToday(fs, now).length, disbursed: d.reduce((t, f) => t + (f.credited ?? f.amount), 0), disbursedCount: d.length };
}
/** Home "Loans" preview rows from the same list: today's files, newest event first. */
export interface ActivityRow { id: string; at: Date; status: 'APPROVED' | 'PENDING' | 'DISBURSED'; amount: number; product: ProductId }
export function todayActivity(fs: readonly StatusFile[], now: Date = MIF_NOW): ActivityRow[] {
  const rows = fs.flatMap((f): ActivityRow[] => {
    if (sameDay(f.disbursedAt, now)) return [{ id: f.lan, at: f.disbursedAt!, status: 'DISBURSED' as const, amount: f.amount, product: f.product }];
    if (sameDay(f.approvedAt, now)) return [{ id: f.lan, at: f.approvedAt!, status: 'APPROVED' as const, amount: f.amount, product: f.product }];
    if (sameDay(f.appliedAt, now)) return [{ id: f.lan, at: f.appliedAt, status: 'PENDING' as const, amount: f.amount, product: f.product }];
    return [];
  });
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/* ---------------- Spoken lines (Hinglish readouts) ---------------- */

const HI_NUM = ['koi', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chheh', 'saat', 'aath', 'nau', 'das'];
export const hiCount = (n: number): string => HI_NUM[n] ?? String(n);
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const BRANDS = new Set(['hero', 'honda', 'tvs', 'bajaj', 'maruti', 'tata', 'hyundai', 'royal', 'enfield', 'suzuki', 'yamaha', 'kia', 'mahindra', 'ather']);
/** "Hero Splendor+" → "Splendor", "Maruti Swift (2021, used)" → "Swift", "Tata 407 Gold SFC" → "407 Gold". */
export function spokenModel(vehicle: string): string {
  const words = vehicle.replace(/\s*\(.*\)$/, '').replace(/\+/g, '').split(/\s+/).filter(Boolean);
  const rest = words.filter((w, i) => !(BRANDS.has(w.toLowerCase()) && i < 2));
  const w = rest.length ? rest : words;
  return /^\d/.test(w[0] ?? '') ? w.slice(0, 2).join(' ') : w[0] ?? vehicle;
}
/** "Ramesh Jadhav, Priya Kulkarni aur Sneha Joshi" (first three, then "aur N aur"). */
export function namesList(fs: readonly StatusFile[]): string {
  const n = fs.map((f) => f.customer);
  if (n.length <= 1) return n[0] ?? '';
  if (n.length <= 3) return `${n.slice(0, -1).join(', ')} aur ${n[n.length - 1]}`;
  return `${n.slice(0, 3).join(', ')} aur ${hiCount(n.length - 3)} aur`;
}
const dayWord = (d: Date, now: Date) => (sameDay(d, now) ? 'aaj' : `${d.getDate()} ${MONTHS[d.getMonth()]} ko`);
const isNewTw = (f: StatusFile) => f.segment === 'NEW_TW';
/** Money-in-flight scope tail for a new-TW file at a dealer that has Money in flight (spec (d) / (e)). */
export const NEW_TW_TAIL = 'New two-wheeler hai, isliye money in flight mein nahi dikhega.';

/** One file's status (spec (d)): "Ramesh Jadhav, Swift, aaj approve hua, abhi e-sign pending hai." */
export function fileStatusSpoken(f: StatusFile, opts: { mifEnabled: boolean; now?: Date }): string {
  const now = opts.now ?? MIF_NOW;
  const head = `${f.customer}, ${spokenModel(f.vehicle)}`;
  let body: string;
  if (f.phase === 'disbursed' && f.disbursedAt) {
    body = sameDay(f.disbursedAt, now)
      ? `aaj disburse hua, ${spokenAmount(f.credited ?? f.amount)} credit ho gaya.`
      : `${dayWord(f.disbursedAt, now)} disburse ho chuka hai, loan active hai.`;
  } else if (f.phase === 'approved' && f.approvedAt) {
    body = `${dayWord(f.approvedAt, now)} approve hua, abhi ${f.stage.toLowerCase()} hai.`;
  } else {
    body = `${dayWord(f.appliedAt, now)} apply hua, abhi ${f.stage.toLowerCase()} hai.`;
  }
  const tail = opts.mifEnabled && isNewTw(f) ? ` ${NEW_TW_TAIL}` : '';
  return `${head}, ${body}${tail}`;
}

/** A money question about a file Money in flight does not track (spec (e), Gaurav #4: open the file + short line). */
export function hybridMoneySpoken(f: StatusFile, now: Date = MIF_NOW): string {
  const lead = isNewTw(f) ? `${f.customer} new two-wheeler hai, money in flight isme nahi dikhta.` : `${f.customer} ka loan abhi sanction nahi hua, isliye money in flight mein nahi hai.`;
  const st = f.phase === 'disbursed' && f.disbursedAt
    ? (sameDay(f.disbursedAt, now) ? `Aaj ${spokenAmount(f.credited ?? f.amount)} credit hua.` : `File ${dayWord(f.disbursedAt, now)} disburse ho chuki hai.`)
    : `Abhi ${f.stage.toLowerCase()} hai.`;
  return `${lead} ${st}`;
}

/** Clarify question (spec): "Do Ramesh hain. Ramesh Jadhav, Swift, aaj approve hua, e-sign pending? Ya Ramesh Kale, Activa, pehle se disbursed?" */
export function clarifySpoken(name: string, fs: readonly StatusFile[], now: Date = MIF_NOW): string {
  const short = (f: StatusFile) => {
    const st = f.phase === 'disbursed' ? (f.disbursedAt && sameDay(f.disbursedAt, now) ? 'aaj disbursed' : 'pehle se disbursed')
      : f.phase === 'approved' ? `${f.approvedAt && sameDay(f.approvedAt, now) ? 'aaj approve hua' : 'approved'}, ${f.stage.toLowerCase()}`
        : f.stage.toLowerCase();
    return `${f.customer}, ${spokenModel(f.vehicle)}, ${st}`;
  };
  const parts = fs.map(short);
  return `${cap(hiCount(fs.length))} ${cap(name)} hain. ${parts.slice(0, -1).join('? Ya ')}? Ya ${parts[parts.length - 1]}?`;
}

export function approvalsSpoken(fs: readonly StatusFile[], now: Date = MIF_NOW): string {
  const a = approvedToday(fs, now);
  if (!a.length) return 'Aaj abhi tak koi file approve nahi hui.';
  return `Aaj ${hiCount(a.length)} ${a.length === 1 ? 'file' : 'files'} approve hui. ${namesList(a)}.`;
}
export function applicationsSpoken(fs: readonly StatusFile[], now: Date = MIF_NOW): string {
  const a = appliedToday(fs, now);
  if (!a.length) return 'Aaj abhi tak koi application nahi aayi.';
  return `Aaj ${hiCount(a.length)} ${a.length === 1 ? 'application' : 'applications'} aayi. ${namesList(a)}.`;
}
/** All products, including new TW (unlike "aaj kitna credit hua", which is Money in flight only). */
export function disbursalsSpoken(fs: readonly StatusFile[], now: Date = MIF_NOW): string {
  const d = disbursedToday(fs, now);
  if (!d.length) return 'Aaj abhi tak koi disbursal nahi hua.';
  const total = d.reduce((t, f) => t + (f.credited ?? f.amount), 0);
  return `Aaj ${spokenAmount(total)} disburse hua, ${hiCount(d.length)} ${d.length === 1 ? 'file' : 'files'}. ${namesList(d)}.`;
}

/* ---------------- Commission (Payouts statement, v1.4.8) ---------------- */

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** `n` working days (Mon–Fri) after `d`. */
export function addWorkingDays(d: Date, n: number): Date {
  const x = new Date(d);
  let left = n;
  while (left > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) left--; }
  return x;
}
const invNo = (id: string) => id.split('/').pop() ?? id;
export interface CommissionAnswer { say: string; invoice?: Invoice; state: 'ready' | 'claimed' | 'paid' | 'none' }
/** "mera commission kab aayega": the latest open invoice (Not claimed, else Claimed), else the latest Paid one. */
export function commissionStatus(invoices: readonly Invoice[], today: Date = TODAY): CommissionAnswer {
  const newest = (s: Invoice['status']) => invoices.filter((i) => i.status === s && i.date <= today).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  const ready = newest('Not claimed');
  if (ready) {
    const by = addWorkingDays(today, 2);
    return {
      state: 'ready', invoice: ready,
      say: `Commission invoice ${invNo(ready.id)}, ${spokenAmount(ready.amount)}, claim ke liye ready hai. Claim karne ke baad do se teen working days mein account mein aata hai. Aaj ${WEEKDAY[today.getDay()]} hai, aaj claim karein to ${WEEKDAY[by.getDay()]} tak aa sakta hai.`,
    };
  }
  const claimed = newest('Claimed');
  if (claimed) return { state: 'claimed', invoice: claimed, say: `Invoice ${invNo(claimed.id)}, ${spokenAmount(claimed.amount)}, claim ho chuka hai. Usually do se teen working days mein credit hota hai.` };
  const paid = newest('Paid');
  if (paid) return { state: 'paid', invoice: paid, say: `Commission aa chuka hai. Invoice ${invNo(paid.id)}, ${spokenAmount(paid.amount)}${paid.utr ? `, UTR last four ${paid.utr.slice(-4)}` : ''}.` };
  return { state: 'none', say: 'Abhi koi commission invoice nahi hai.' };
}
/** "kitna commission pending hai" / "invoices to claim": Not-claimed invoices. */
export function invoicesToClaim(invoices: readonly Invoice[], today: Date = TODAY): { say: string; list: Invoice[]; total: number } {
  const list = invoices.filter((i) => i.status === 'Not claimed' && i.date <= today).sort((a, b) => b.date.getTime() - a.date.getTime());
  const total = list.reduce((t, i) => t + i.amount, 0);
  if (!list.length) return { list, total, say: 'Koi invoice claim ke liye pending nahi hai.' };
  return { list, total, say: `${cap(hiCount(list.length))} ${list.length === 1 ? 'invoice' : 'invoices'} claim ke liye ready ${list.length === 1 ? 'hai' : 'hain'}, ${spokenAmount(total)}.` };
}

/* ---------------- Masking (spoken / shown answers) ---------------- */

/** Any 10-digit mobile in an answer → last four only. */
export const maskMobilesIn = (s: string): string => s.replace(/\b(?:\+?91[\s-]?)?[6-9]\d{5}(\d{4})\b/g, '••••••$1');

/* ---------------- UI labels (English) ---------------- */

export const SEGMENT_LABEL: Record<DealerSegment, string> = {
  NEW_TW: 'New TW', USED_TW: 'Used TW', NEW_CAR: 'New car', USED_CAR: 'Used car', NEW_CV: 'New CV', USED_CV: 'Used CV',
};
const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** Row caption: "Approved today · e-Sign pending" / "Disbursed 12 Oct · Active" / "Applied today · KYC pending". */
export function statusCaption(f: StatusFile, now: Date = MIF_NOW): string {
  const when = (d: Date) => (sameDay(d, now) ? 'today' : shortDate(d));
  if (f.phase === 'disbursed' && f.disbursedAt) return sameDay(f.disbursedAt, now) ? `Disbursed today · ${f.stage}` : `Disbursed ${shortDate(f.disbursedAt)} · Active`;
  if (f.phase === 'approved' && f.approvedAt) return `Approved ${when(f.approvedAt)} · ${f.stage}`;
  return `Applied ${when(f.appliedAt)} · ${f.stage}`;
}
/** Timeline time: "24 Nov, 10:05 AM". */
export const stepTime = (d: Date): string => {
  const h = d.getHours();
  return `${shortDate(d)}, ${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
