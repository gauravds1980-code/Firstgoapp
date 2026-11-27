/**
 * v1.4.5 voice routes (pure: no React Native imports, so `npm run test:voice` runs it; fetch / clock / timers / storage
 * are injected).
 *
 * A "route" is a base URL of the voice server (e.g. https://…exp.direct/voice), no trailing slash. The APK bakes
 * EXPO_PUBLIC_STT_URL (primary) plus optional comma-separated EXPO_PUBLIC_STT_URLS; any working route can serve
 * GET {route}/routes → {"version":1,"routes":[url,…],"updatedAt":…}. The fetched list is validated (https only, at
 * most 5, no trailing slash), cached, and merged in front of the baked list. The baked routes are never removed, so a
 * changed tunnel URL needs no new APK as long as one route still answers.
 *
 * Health: the manager remembers the route that last worked. A route failure (network error, timeout, HTTP 404 / 502
 * / 503 / 504, or an HTML error page from ngrok / Cloudflare) is retried once on the same route, then the route is
 * marked down and the next route is used. A down route is probed with GET {route}/health after 1, 2, 4, 8, 16, 30,
 * 30 … s; when it answers it is up again, and the app switches back to it if it comes earlier in the list (the
 * primary). A 4xx JSON answer from our own server is NOT a route failure (the route works; the request was wrong).
 */

export type RouteOutcome = 'ok' | 'route' | 'app';
export type RouteState = 'ok' | 'unknown' | 'down';

/** Probe delays after a route goes down (s); the last value repeats. */
export const PROBE_BACKOFF_S: readonly number[] = [1, 2, 4, 8, 16, 30];
/** Fetched config limits. */
export const MAX_FETCHED_ROUTES = 5;
export const ROUTES_CACHE_KEY = 'firstgo.voice.routes.v1';
/** GET /health and GET /routes time out after this. */
export const PROBE_TIMEOUT_MS = 5000;

export const probeDelayMs = (step: number): number =>
  PROBE_BACKOFF_S[Math.min(Math.max(0, step), PROBE_BACKOFF_S.length - 1)] * 1000;

/** Trim + drop trailing slashes. */
const clean = (u: string) => u.trim().replace(/\/+$/, '');

/** Baked list: EXPO_PUBLIC_STT_URL first, then EXPO_PUBLIC_STT_URLS (comma separated). http allowed (local dev). */
export function bakedRouteList(primary: string | undefined, extra: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of [primary ?? '', ...(extra ?? '').split(',')]) {
    const u = clean(raw);
    if (u && /^https?:\/\/[^\s/?#]+/i.test(u) && !/[\s?#]/.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/** A fetched route: https only, a host, no query / fragment / whitespace, no trailing slash. */
export function validRoute(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  if (u !== u.trim() || /\/$/.test(u) || /[\s?#]/.test(u)) return false;
  return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s?#]*)?$/i.test(u) && u.length <= 200;
}

/** GET /routes body → the valid routes (max 5, de-duplicated), or null when the body is not a version-1 config. */
export function parseRoutesConfig(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.version !== 1 || !Array.isArray(b.routes)) return null;
  const out: string[] = [];
  for (const r of b.routes) if (validRoute(r) && !out.includes(r)) out.push(r);
  return out.slice(0, MAX_FETCHED_ROUTES);
}

/** Fetched routes first, then every baked route (never dropped). */
export function mergeRoutes(fetched: readonly string[] | null | undefined, baked: readonly string[]): string[] {
  const out: string[] = [];
  for (const u of [...(fetched ?? []).slice(0, MAX_FETCHED_ROUTES), ...baked]) if (u && !out.includes(u)) out.push(u);
  return out;
}

const isHtml = (contentType?: string | null, bodyStart?: string | null) =>
  /text\/html/i.test(contentType ?? '') || /^\s*<(!doctype|html|head|body|\?xml|div)/i.test(bodyStart ?? '');
const isJson = (contentType?: string | null, bodyStart?: string | null) =>
  /json/i.test(contentType ?? '') || /^\s*[{[]/.test(bodyStart ?? '');

/**
 * One HTTP answer → ok / route failure / app error. HTML (tunnel error page) and 502/503/504 are always route
 * failures; 404 is one unless our server answered it with JSON; any other non-2xx JSON is the server's own answer.
 */
export function classifyHttp(status: number, contentType?: string | null, bodyStart?: string | null): RouteOutcome {
  if (isHtml(contentType, bodyStart)) return 'route';
  if (status === 502 || status === 503 || status === 504 || status === 0) return 'route';
  if (status === 404) return isJson(contentType, bodyStart) ? 'app' : 'route';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 500 && !isJson(contentType, bodyStart)) return 'route';
  return 'app';
}

/** Minimal response shape the manager reads (fetch Response fits). */
export type RouteResponse = { status: number; ok?: boolean; headers?: { get(name: string): string | null } | null; text?(): Promise<string> };
export type RouteFetch = (url: string, init: { method: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<RouteResponse>;
export type RouteStorage = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

export type RouteHealth = { url: string; state: RouteState; fails: number; probeStep: number; nextProbeAt?: number; lastOkAt?: number; lastFailAt?: number };
export type RouteSnapshot = { current: string; index: number; routes: RouteHealth[]; allDown: boolean; fetchedAt?: number; source: 'baked' | 'fetched' };

/** Thrown error / outcome → how the request helper treats it. 'slow' = a timeout: route failure, but never retried. */
export type FailureKind = 'route' | 'slow' | 'app';

export type RouteManagerDeps = {
  baked: readonly string[];
  fetch?: RouteFetch;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  storage?: RouteStorage;
};

export function createRouteManager(deps: RouteManagerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const doFetch: RouteFetch = deps.fetch ?? ((url, init) => fetch(url, init as RequestInit) as unknown as Promise<RouteResponse>);
  let storage = deps.storage;
  const baked = [...deps.baked];
  let fetched: string[] | null = null;
  let fetchedAt: number | undefined;
  const health = new Map<string, RouteHealth>();
  const timers = new Map<string, unknown>();
  let routes: string[] = [];
  let cur = 0;
  const changeSubs = new Set<() => void>();
  const recoverSubs = new Set<(url: string) => void>();
  let refreshing: Promise<boolean> | null = null;

  function h(url: string): RouteHealth {
    let r = health.get(url);
    if (!r) { r = { url, state: 'unknown', fails: 0, probeStep: 0 }; health.set(url, r); }
    return r;
  }

  function setRoutes(list: string[]) {
    const keep = routes[cur];
    routes = list;
    for (const u of [...health.keys()]) if (!list.includes(u)) { health.delete(u); stopProbe(u); }
    for (const u of list) h(u);
    // The first route that is not down (fetched first, then baked), else stay where we were.
    const firstUp = list.findIndex((u) => h(u).state !== 'down');
    cur = firstUp >= 0 ? firstUp : Math.max(0, keep ? list.indexOf(keep) : 0);
  }
  setRoutes(mergeRoutes(null, baked));

  const emit = () => { for (const f of changeSubs) { try { f(); } catch { /* listener */ } } };

  function current(): string { return routes[cur] ?? ''; }
  const allDown = () => routes.length > 0 && routes.every((u) => h(u).state === 'down');

  /** Next route after `url` that is not down; if all are down, simply the next one (round robin). */
  function nextAfter(url: string): string {
    const i = routes.indexOf(url);
    for (let k = 1; k <= routes.length; k++) {
      const u = routes[(i + k) % routes.length];
      if (h(u).state !== 'down' && u !== url) return u;
    }
    return routes.length > 1 ? routes[(i + 1) % routes.length] : url;
  }

  function stopProbe(url: string) {
    const t = timers.get(url);
    if (t !== undefined) { clearTimer(t); timers.delete(url); }
  }

  function scheduleProbe(url: string) {
    stopProbe(url);
    const r = h(url);
    const ms = probeDelayMs(r.probeStep);
    r.nextProbeAt = now() + ms;
    timers.set(url, setTimer(() => { timers.delete(url); void probe(url); }, ms));
  }

  /** GET {url}/health once. Up → markOk (switch back if earlier in the list); down → next backoff step. */
  async function probe(url: string): Promise<boolean> {
    if (!routes.includes(url)) return false;
    const outcome = await get(url, '/health');
    if (!routes.includes(url)) return false;
    if (outcome.kind === 'ok') { markOk(url); return true; }
    const r = h(url);
    r.probeStep = Math.min(r.probeStep + 1, PROBE_BACKOFF_S.length - 1);
    r.lastFailAt = now();
    if (r.state === 'down') scheduleProbe(url);
    emit();
    return false;
  }

  async function get(url: string, path: string): Promise<{ kind: RouteOutcome; body?: string }> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const t = setTimer(() => ctrl?.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await doFetch(`${url}${path}`, { method: 'GET', headers: { accept: 'application/json' }, ...(ctrl ? { signal: ctrl.signal } : {}) });
      let body = '';
      try { body = res.text ? await res.text() : ''; } catch { /* body optional */ }
      const kind = classifyHttp(res.status, res.headers?.get('content-type') ?? null, body.slice(0, 64));
      return { kind, body };
    } catch {
      return { kind: 'route' };
    } finally {
      clearTimer(t);
    }
  }

  /** A request on `url` worked (or got our server's own 4xx JSON). */
  function markOk(url: string) {
    if (!routes.includes(url)) return;
    const r = h(url);
    const was = r.state;
    r.state = 'ok'; r.fails = 0; r.probeStep = 0; r.nextProbeAt = undefined; r.lastOkAt = now();
    stopProbe(url);
    const i = routes.indexOf(url);
    const before = cur;
    // Remember the healthy route; an earlier route (primary) that recovers wins back.
    if (h(routes[cur]).state === 'down' || i < cur) cur = i;
    if (was === 'ok' && before === cur) return; // nothing changed (e.g. every /stream chunk)
    if (was === 'down') {
      for (const f of recoverSubs) { try { f(url); } catch { /* listener */ } }
      void refreshConfig(url);
    }
    emit();
  }

  /**
   * A route failure on `url`. `down: true` marks it down at once (the caller will not retry it); otherwise the
   * second failure in a row does. Down → probe in the background and move to the next route.
   */
  function markFail(url: string, opts: { down?: boolean } = {}) {
    if (!routes.includes(url)) return;
    const r = h(url);
    r.fails += 1;
    r.lastFailAt = now();
    if ((opts.down || r.fails >= 2) && r.state !== 'down') {
      r.state = 'down';
      r.probeStep = 0;
      scheduleProbe(url);
      if (routes[cur] === url) cur = routes.indexOf(nextAfter(url));
    }
    emit();
  }

  function report(url: string, outcome: RouteOutcome, opts: { down?: boolean } = {}) {
    if (outcome === 'route') markFail(url, opts); else markOk(url);
  }

  /**
   * Run one request with the retry policy. `attempt(base)` resolves on success and throws on failure;
   * `classify(e)` says whether the error was the route's fault.
   * - 'same' (small requests): same route once more, then the next route once.
   * - 'next' (/text): one retry, on the next route when there is one, else the same route.
   * - 'none' (/command, /stream: large audio): no retry; a route failure marks the route down for the next turn.
   * Timeouts ('slow') are never retried (the time is already spent) and mark the route down.
   */
  async function run<T>(attempt: (base: string) => Promise<T>, classify: (e: unknown) => FailureKind, policy: 'same' | 'next' | 'none' = 'same'): Promise<T> {
    const first = current();
    if (!first) return attempt(first);
    const plan: string[] = [first];
    let lastErr: unknown;
    for (let k = 0; k < plan.length; k++) {
      const base = plan[k];
      try {
        const v = await attempt(base);
        markOk(base);
        return v;
      } catch (e) {
        lastErr = e;
        const kind = classify(e);
        if (kind === 'app') { markOk(base); throw e; }
        if (kind === 'slow' || policy === 'none') { markFail(base, { down: true }); throw e; }
        if (policy === 'next') {
          const nxt = routes.length > 1 ? nextAfter(base) : base;
          markFail(base, { down: nxt !== base });
          if (k === 0) plan.push(nxt);
          continue;
        }
        // 'same'
        markFail(base);
        if (k === 0) plan.push(base);
        else if (k === 1 && routes.length > 1) { const nxt = current(); if (nxt !== base) plan.push(nxt); }
      }
    }
    throw lastErr;
  }

  /** GET {from}/routes → validate → cache → merge. Resolves true when a valid config was applied. Never rejects. */
  function refreshConfig(from?: string): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const order = from ? [from, ...routes.filter((u) => u !== from && h(u).state !== 'down')] : routes.filter((u) => h(u).state !== 'down');
      for (const u of order.slice(0, 3)) {
        const r = await get(u, '/routes');
        if (r.kind === 'app') return false; // our server, but no /routes (older server): keep what we have
        if (r.kind !== 'ok') continue;
        let body: unknown = null;
        try { body = JSON.parse(r.body ?? ''); } catch { /* not JSON */ }
        const list = parseRoutesConfig(body);
        if (!list) return false; // this server has no (valid) config: keep what we have
        applyFetched(list, now());
        try { await storage?.set(ROUTES_CACHE_KEY, JSON.stringify({ version: 1, routes: list, fetchedAt: fetchedAt })); } catch { /* cache optional */ }
        return true;
      }
      return false;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function applyFetched(list: string[], at?: number) {
    fetched = list;
    fetchedAt = at;
    setRoutes(mergeRoutes(fetched, baked));
    emit();
  }

  /** App start: load the cached config (if any), then fetch a fresh one from a working route. */
  async function start(store?: RouteStorage): Promise<void> {
    if (store) storage = store;
    try {
      const raw = await storage?.get(ROUTES_CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw) as { routes?: unknown; fetchedAt?: unknown };
        const list = parseRoutesConfig({ version: 1, routes: c.routes });
        if (list?.length) applyFetched(list, typeof c.fetchedAt === 'number' ? c.fetchedAt : undefined);
      }
    } catch { /* bad cache: ignore */ }
    await refreshConfig();
  }

  function snapshot(): RouteSnapshot {
    return {
      current: current(), index: cur, allDown: allDown(), routes: routes.map((u) => ({ ...h(u) })),
      ...(fetchedAt !== undefined ? { fetchedAt } : {}), source: fetched?.length ? 'fetched' : 'baked',
    };
  }

  return {
    current, allDown, report, markOk, markFail, run, probe, refreshConfig, start, snapshot,
    routes: () => [...routes],
    onChange(f: () => void) { changeSubs.add(f); return () => { changeSubs.delete(f); }; },
    onRecover(f: (url: string) => void) { recoverSubs.add(f); return () => { recoverSubs.delete(f); }; },
    /** Tests / teardown. */
    stop() { for (const u of [...timers.keys()]) stopProbe(u); },
  };
}

export type RouteManager = ReturnType<typeof createRouteManager>;

/** Short diagnostics line: "yl0nisu-…exp.direct/voice · ok (1/2)" / "… · down, retry in 8 s". */
export function routeStatusText(s: RouteSnapshot, nowMs: number = Date.now()): string {
  if (!s.current) return 'Voice server: not configured';
  const r = s.routes[s.index];
  const host = s.current.replace(/^https?:\/\//, '');
  const pos = s.routes.length > 1 ? ` (route ${s.index + 1} of ${s.routes.length}${s.source === 'fetched' ? ', fetched list' : ''})` : '';
  if (!r) return `Voice server: ${host}${pos}`;
  if (s.allDown) {
    const next = Math.min(...s.routes.map((x) => x.nextProbeAt ?? Infinity));
    const secs = Number.isFinite(next) ? Math.max(0, Math.ceil((next - nowMs) / 1000)) : null;
    return `Voice server: ${host} · no connection${secs !== null ? `, retry in ${secs} s` : ''}${pos}`;
  }
  return `Voice server: ${host} · ${r.state === 'ok' ? 'ok' : r.state === 'down' ? 'down' : 'not checked yet'}${pos}`;
}
