/**
 * Voice latency metrics (v1.4.0). Timestamps each turn and keeps the last 50 in memory:
 *   pressToFeedback  press-in → first visual feedback painted (target < 100 ms)
 *   releaseToText    release / end-of-speech → final (or draft) text on screen (target < 300 ms)
 *   releaseToAction  release / end-of-speech → navigation / fill / preview applied (target < 700 ms)
 *   releaseToAudio   release / end-of-speech → reply audio starts
 *   releaseToCheck   release / end-of-speech → Whisper second check back (background)
 * Tags: path (device recognizer vs server), matcher (keyword / fuzzy / labse / server), mode.
 *
 * OTP SAFETY: no transcript is ever stored. The only free text is `note`, and every digit in it is
 * masked before it is kept or logged. Pure: no React Native imports (unit-tested in Node).
 */

export type TurnMark = 'pressIn' | 'feedback' | 'release' | 'finalText' | 'action' | 'audioStart' | 'check';
export type TurnPath = 'device' | 'server' | 'device+text';
export type TurnMatcher = 'keyword' | 'fuzzy' | 'labse' | 'server' | 'none';

export interface TurnTags {
  path?: TurnPath;
  matcher?: TurnMatcher;
  mode?: 'ptt' | 'handsfree';
  /** auto | preview | clarify | retry | error | cancelled | whisper_disagreed … */
  outcome?: string;
  /** Free text, digits masked. Never a transcript. */
  note?: string;
}

export interface Turn extends TurnTags {
  id: number;
  marks: Partial<Record<TurnMark, number>>;
  done: boolean;
}

export const METRIC_NAMES = ['pressToFeedback', 'releaseToText', 'releaseToAction', 'releaseToAudio', 'releaseToCheck'] as const;
export type MetricName = (typeof METRIC_NAMES)[number];
const SPANS: Record<MetricName, [TurnMark, TurnMark]> = {
  pressToFeedback: ['pressIn', 'feedback'],
  releaseToText: ['release', 'finalText'],
  releaseToAction: ['release', 'action'],
  releaseToAudio: ['release', 'audioStart'],
  releaseToCheck: ['release', 'check'],
};
/** Targets from the v1.4.0 brief (ms). */
export const TARGETS: Partial<Record<MetricName, number>> = { pressToFeedback: 100, releaseToText: 300, releaseToAction: 700 };

export const BUFFER_SIZE = 50;

/** Mask every digit (OTP, phone, amounts) — the only free text metrics accept. */
export const maskDigits = (s: string): string => s.replace(/\d/g, '•');

/** Nearest-rank percentile (p in 0..100) of an unsorted list; null when empty. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1];
}

export type MetricSummary = { n: number; p50: number | null; p95: number | null; max: number | null; target?: number };

const now = (): number => {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
};

export function createVoiceMetrics(opts: { size?: number; clock?: () => number; log?: (line: string) => void } = {}) {
  const size = opts.size ?? BUFFER_SIZE;
  const clock = opts.clock ?? now;
  let seq = 0;
  let turns: Turn[] = [];
  let log = opts.log;

  const find = (id: number) => turns.find((t) => t.id === id);

  const api = {
    /** Begin a turn (press-in or hands-free tap). Returns its id. */
    start(tags: TurnTags = {}, at = clock()): number {
      const id = ++seq;
      turns.push({ id, marks: { pressIn: at }, done: false, ...clean(tags) });
      if (turns.length > size) turns = turns.slice(turns.length - size);
      return id;
    },
    /** First timestamp wins (a later duplicate mark is ignored). */
    mark(id: number, m: TurnMark, at = clock()): void {
      const t = find(id);
      if (!t || t.marks[m] !== undefined) return;
      t.marks[m] = at;
    },
    tag(id: number, tags: TurnTags): void {
      const t = find(id);
      if (t) Object.assign(t, clean(tags));
    },
    end(id: number, tags: TurnTags = {}): void {
      const t = find(id);
      if (!t || t.done) return;
      Object.assign(t, clean(tags));
      t.done = true;
      if (log) log(api.line(t));
    },
    /** Duration of one span for one turn (ms), or null. */
    span(t: Turn, name: MetricName): number | null {
      const [a, b] = SPANS[name];
      const x = t.marks[a];
      const y = t.marks[b];
      return x !== undefined && y !== undefined && y >= x ? Math.round(y - x) : null;
    },
    summary(filter?: (t: Turn) => boolean): Record<MetricName, MetricSummary> {
      const out = {} as Record<MetricName, MetricSummary>;
      const pool = turns.filter((t) => (filter ? filter(t) : true));
      for (const name of METRIC_NAMES) {
        const xs = pool.map((t) => api.span(t, name)).filter((v): v is number => v !== null);
        out[name] = { n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), max: xs.length ? Math.max(...xs) : null, ...(TARGETS[name] ? { target: TARGETS[name] } : {}) };
      }
      return out;
    },
    turns(): readonly Turn[] { return turns; },
    reset(): void { turns = []; },
    setLogger(fn: ((line: string) => void) | undefined): void { log = fn; },
    /** One log line: spans + tags only (no transcript, digits masked). */
    line(t: Turn): string {
      const parts = METRIC_NAMES.map((n) => [n, api.span(t, n)] as const).filter(([, v]) => v !== null).map(([n, v]) => `${n}=${v}`);
      return `[voice-metrics] #${t.id} path=${t.path ?? '-'} matcher=${t.matcher ?? '-'} mode=${t.mode ?? '-'} outcome=${t.outcome ?? '-'} ${parts.join(' ')}${t.note ? ` note=${t.note}` : ''}`;
    },
  };
  return api;
}

function clean(tags: TurnTags): TurnTags {
  const out: TurnTags = { ...tags };
  if (out.note !== undefined) out.note = maskDigits(String(out.note)).slice(0, 80);
  if (out.outcome !== undefined) out.outcome = maskDigits(String(out.outcome)).slice(0, 40);
  return out;
}

export type VoiceMetrics = ReturnType<typeof createVoiceMetrics>;

/** The app-wide instance (also exposed as globalThis.__voiceMetrics for the web latency harness). */
export const voiceMetrics: VoiceMetrics = createVoiceMetrics();
(globalThis as { __voiceMetrics?: VoiceMetrics }).__voiceMetrics = voiceMetrics;
