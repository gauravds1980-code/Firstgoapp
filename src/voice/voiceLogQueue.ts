/**
 * v1.4.5 offline queue for /log posts (pure; storage / clock injected so `npm run test:voice` runs it).
 *
 * A /log post that fails because the route is down (network error, timeout, tunnel 404 / 5xx / HTML page) is kept
 * and resent later, oldest first: after the next successful /log, when a route recovers, and at app start.
 * Bounded: at most MAX_QUEUED entries and MAX_QUEUE_AGE_MS old; the oldest are dropped first.
 *
 * Privacy: audio is NEVER persisted (audioBase64 / mimeType are stripped). OTP turns (otp flag, expect=otp, OTP
 * screens: Esign, DealerOtp, SearchMobile otp stage, consent OTP) keep only a masked transcript (••••••). Every text
 * field also has runs of 4+ digits (spaced digits or digit words, English / Hindi) masked before it is written.
 */
import type { KeyValueStorage } from './voiceTurnLog';

export const LOG_QUEUE_KEY = 'firstgo.voice.logQueue.v1';
export const MAX_QUEUED = 200;
export const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;
export const OTP_MASK = '••••••';

export type QueuedLog = { at: number; body: Record<string, unknown> };
export type SendOutcome = 'ok' | 'route' | 'app';

const DIGIT_WORDS = new Set([
  'zero', 'oh', 'o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'double', 'triple',
  'shunya', 'ek', 'do', 'teen', 'char', 'chaar', 'paanch', 'panch', 'chhe', 'che', 'chah', 'saat', 'aath', 'nau', 'nao',
]);

/** Digits a token contributes to a run (0 = not part of a run). */
function digitWeight(tok: string): number {
  const t = tok.toLowerCase().replace(/[.,;:!?()-]+$/g, '').replace(/^[(]+/, '');
  if (!t) return 0;
  if (/^[\d-]+$/.test(t) && /\d/.test(t)) return t.replace(/\D/g, '').length;
  if (/^[०-९]+$/.test(t)) return t.length;
  return DIGIT_WORDS.has(t) ? 1 : 0;
}

/** Replace every run of tokens that together spell 4+ digits ("4 5 6 7", "four five six seven", "98765") with ••••••. */
export function maskDigitRuns(text: string): string {
  const parts = text.split(/(\s+)/);
  const out: string[] = [];
  let run: string[] = [];
  let weight = 0;
  let hasRealDigit = false;
  const close = () => {
    if (!run.length) return;
    // Lone filler words ("do", "one") are kept; a run is masked when it spells 4+ digits.
    if (weight >= 4 && (hasRealDigit || run.filter((p) => p.trim()).length >= 4)) out.push(OTP_MASK);
    else out.push(...run);
    run = []; weight = 0; hasRealDigit = false;
  };
  for (const p of parts) {
    if (/^\s+$/.test(p)) { if (run.length) run.push(p); else out.push(p); continue; }
    const w = digitWeight(p);
    if (w > 0) { run.push(p); weight += w; if (/\d/.test(p)) hasRealDigit = true; continue; }
    // trailing whitespace inside the run belongs outside it
    let tail = '';
    while (run.length && /^\s+$/.test(run[run.length - 1])) tail = run.pop()! + tail;
    close();
    if (tail) out.push(tail);
    out.push(p);
  }
  let tail = '';
  while (run.length && /^\s+$/.test(run[run.length - 1])) tail = run.pop()! + tail;
  close();
  if (tail) out.push(tail);
  return out.join('');
}

const OTP_SCREEN = /^(esign|dealerotp)$/i;

/** OTP turn by flag / expect / screen (Esign, DealerOtp, any *Otp* / consent screen, SearchMobile otp stage via expect). */
export function isOtpLogBody(b: Record<string, unknown>, otp?: boolean): boolean {
  if (otp || b.otp === true || b.hasOtpField === true) return true;
  if (String(b.expect ?? '').toLowerCase() === 'otp') return true;
  const ctx = (typeof b.context === 'object' && b.context !== null ? b.context : {}) as Record<string, unknown>;
  for (const s of [b.screen, ctx.route]) {
    const v = String(s ?? '');
    if (OTP_SCREEN.test(v) || /otp|consent/i.test(v)) return true;
  }
  return false;
}

const TEXT_KEYS = ['transcript', 'deviceTranscript', 'normalizedTranscript', 'partial', 'matchedPhrase'];

/** The body as it may be written to storage: no audio, OTP text masked, digit runs masked. */
export function sanitizeQueuedBody(body: Record<string, unknown>, opts: { otp?: boolean } = {}): Record<string, unknown> {
  const otp = isOtpLogBody(body, opts.otp);
  const { audioBase64: _a, mimeType: _m, audio: _au, ...rest } = body;
  const out: Record<string, unknown> = { ...rest };
  for (const k of TEXT_KEYS) {
    if (typeof out[k] !== 'string') continue;
    out[k] = otp ? ((out[k] as string).trim() ? OTP_MASK : '') : maskDigitRuns(out[k] as string);
  }
  if (Array.isArray(out.candidates)) {
    out.candidates = (out.candidates as unknown[]).map((c) => {
      if (typeof c !== 'object' || c === null) return c;
      const cc = { ...(c as Record<string, unknown>) };
      if (typeof cc.phrase === 'string') cc.phrase = otp ? OTP_MASK : maskDigitRuns(cc.phrase);
      return cc;
    });
  }
  delete out.normalizedFields;
  delete out.slots;
  if (otp) out.otp = true;
  return out;
}

export type LogQueueDeps = {
  storage: KeyValueStorage;
  now?: () => number;
  max?: number;
  maxAgeMs?: number;
};

export function createLogQueue(deps: LogQueueDeps) {
  const now = deps.now ?? Date.now;
  const max = deps.max ?? MAX_QUEUED;
  const maxAge = deps.maxAgeMs ?? MAX_QUEUE_AGE_MS;
  let items: QueuedLog[] | null = null;
  let loading: Promise<QueuedLog[]> | null = null;
  let flushing: Promise<{ sent: number; dropped: number; left: number }> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const prune = (list: QueuedLog[]) => {
    const cutoff = now() - maxAge;
    const fresh = list.filter((e) => e && typeof e.at === 'number' && e.at >= cutoff && typeof e.body === 'object' && e.body !== null);
    return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
  };

  function load(): Promise<QueuedLog[]> {
    if (items) return Promise.resolve(items);
    if (!loading) {
      loading = (async () => {
        let list: QueuedLog[] = [];
        try {
          const raw = await deps.storage.get(LOG_QUEUE_KEY);
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) list = parsed as QueuedLog[];
        } catch { /* corrupt: start empty */ }
        // Re-sanitise on load too (an older build's file can never leak audio / OTP digits).
        items = prune(list).map((e) => ({ at: e.at, body: sanitizeQueuedBody(e.body) }));
        return items;
      })().finally(() => { loading = null; });
    }
    return loading;
  }

  async function save() {
    try { await deps.storage.set(LOG_QUEUE_KEY, JSON.stringify(items ?? [])); } catch { /* best effort */ }
  }

  /** Serialise mutations so enqueue / flush never interleave writes. */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  function enqueue(body: Record<string, unknown>, opts: { otp?: boolean } = {}): Promise<void> {
    return locked(async () => {
      const list = await load();
      list.push({ at: now(), body: sanitizeQueuedBody(body, opts) });
      items = prune(list);
      await save();
    });
  }

  /**
   * Resend in order. `send` → 'ok' (sent, removed), 'app' (the server refused it: dropped, never retried forever),
   * 'route' (route down: stop, keep the rest). Concurrent calls share one flush.
   */
  function flush(send: (body: Record<string, unknown>) => Promise<SendOutcome>): Promise<{ sent: number; dropped: number; left: number }> {
    if (flushing) return flushing;
    flushing = locked(async () => {
      const list = prune(await load());
      items = list;
      let sent = 0; let dropped = 0;
      while (items.length) {
        const e = items[0];
        let r: SendOutcome;
        try { r = await send({ ...e.body, queued: true, queuedAgeMs: Math.max(0, now() - e.at) }); } catch { r = 'route'; }
        if (r === 'route') break;
        items.shift();
        if (r === 'ok') sent++; else dropped++;
        await save();
      }
      if (!sent && !dropped) await save();
      return { sent, dropped, left: items.length };
    }).finally(() => { flushing = null; });
    return flushing;
  }

  return {
    load, enqueue, flush,
    size: () => items?.length ?? 0,
    peek: async () => [...(await load())],
  };
}

export type LogQueue = ReturnType<typeof createLogQueue>;
