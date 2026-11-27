/**
 * v1.4.5 voice routes: route list (baked + fetched), failure classification, retry once then switch, /health
 * backoff, switch-back on recovery, fetched config validation / merge / caching. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bakedRouteList, classifyHttp, createRouteManager, mergeRoutes, parseRoutesConfig, probeDelayMs, routeStatusText, validRoute,
  ROUTES_CACHE_KEY, type RouteFetch, type RouteResponse,
} from '../voiceRoutes';
import { RouteFailureError, routeFailureKind } from '../sttClient';
import { VoiceError } from '../types';

const A = 'https://a.exp.direct/voice';
const B = 'https://b.trycloudflare.com/voice';
const C = 'https://c.example.com/voice';

/** Fake clock + timers: advance(ms) runs due timers in order. */
function clock() {
  let t = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h: unknown) => { timers.delete(h as number); },
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      t = end;
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

const json = (status: number, body: unknown): RouteResponse => ({
  status, ok: status >= 200 && status < 300, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body),
});
const html = (status: number): RouteResponse => ({
  status, ok: status >= 200 && status < 300, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) }, text: async () => '<!DOCTYPE html><html>ngrok ERR_NGROK_3200</html>',
});

/** Fetch double: per-base up/down switch; GET /health and /routes answered. */
function net(up: Record<string, boolean>, routesBody?: unknown) {
  const calls: string[] = [];
  const fetch: RouteFetch = async (url) => {
    calls.push(url);
    const base = Object.keys(up).find((b) => url.startsWith(b + '/'));
    if (!base || !up[base]) throw new TypeError('Network request failed');
    if (url.endsWith('/health')) return json(200, { ok: true });
    if (url.endsWith('/routes')) return routesBody === undefined ? json(404, { detail: 'Not Found' }) : json(200, routesBody);
    return json(200, {});
  };
  return { calls, fetch };
}

const memStore = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
};

test('baked list: STT_URL first, then STT_URLS; trailing slashes trimmed, duplicates and junk dropped, http allowed', () => {
  assert.deepEqual(bakedRouteList(`${A}/`, ` ${B}, ,${A}, http://127.0.0.1:8793 ,not a url`), [A, B, 'http://127.0.0.1:8793']);
  assert.deepEqual(bakedRouteList('', undefined), []);
  assert.deepEqual(bakedRouteList(A, undefined), [A]);
});

test('fetched config: version 1, https only, no trailing slash / query, max 5, de-duplicated', () => {
  assert.equal(validRoute(A), true);
  assert.equal(validRoute('http://a.example.com/voice'), false);
  assert.equal(validRoute(`${A}/`), false);
  assert.equal(validRoute(`${A}?x=1`), false);
  assert.equal(validRoute(' https://a.b'), false);
  assert.equal(validRoute(42), false);
  assert.equal(parseRoutesConfig({ routes: [A] }), null);
  assert.equal(parseRoutesConfig({ version: 2, routes: [A] }), null);
  assert.equal(parseRoutesConfig('nope'), null);
  const six = [1, 2, 3, 4, 5, 6].map((i) => `https://r${i}.example.com/voice`);
  assert.deepEqual(parseRoutesConfig({ version: 1, routes: [...six.slice(0, 2), six[0], 'http://x.y', `${A}/`, ...six.slice(2)], updatedAt: 'x' }), six.slice(0, 5));
});

test('merge: fetched first, baked always kept as fallback', () => {
  assert.deepEqual(mergeRoutes([B, A], [A, C]), [B, A, C]);
  assert.deepEqual(mergeRoutes([], [A]), [A]);
  assert.deepEqual(mergeRoutes(null, [A]), [A]);
});

test('classify: tunnel failures vs our server\'s own 4xx JSON', () => {
  assert.equal(classifyHttp(200, 'application/json', '{"ok":true}'), 'ok');
  assert.equal(classifyHttp(404, 'text/html', null), 'route'); // ngrok "endpoint offline"
  assert.equal(classifyHttp(404, null, null), 'route');
  assert.equal(classifyHttp(404, 'application/json', '{"detail":"Not Found"}'), 'app');
  for (const s of [502, 503, 504]) assert.equal(classifyHttp(s, 'application/json', '{}'), 'route');
  assert.equal(classifyHttp(200, 'text/html', null), 'route'); // captive portal / tunnel landing page
  assert.equal(classifyHttp(200, null, '<!DOCTYPE html>'), 'route');
  assert.equal(classifyHttp(400, 'application/json', '{"error":"bad"}'), 'app');
  assert.equal(classifyHttp(409, 'application/json', '{}'), 'app');
  assert.equal(classifyHttp(422, 'application/json', '{}'), 'app');
  assert.equal(classifyHttp(500, 'text/plain', 'proxy error'), 'route');
  assert.equal(classifyHttp(500, 'application/json', '{}'), 'app');
});

test('sttClient error kinds: network / route = route, timeout = slow (no retry), others = app', () => {
  assert.equal(routeFailureKind(new RouteFailureError('network', 'route: HTTP 404')), 'route');
  assert.equal(routeFailureKind(new VoiceError('network')), 'route');
  assert.equal(routeFailureKind(new VoiceError('timeout')), 'slow');
  assert.equal(routeFailureKind(new VoiceError('http', 'HTTP 400')), 'app');
  assert.equal(routeFailureKind(new VoiceError('busy')), 'app');
  assert.equal(routeFailureKind(new VoiceError('no_speech')), 'app');
  assert.ok(new RouteFailureError('network') instanceof VoiceError);
});

test('backoff schedule: 1, 2, 4, 8, 16, 30, 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(probeDelayMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

const routeErr = () => new RouteFailureError('network', 'route: HTTP 404');

test("run 'same': retry once on the same route, then switch to the next route", async () => {
  const c = clock();
  const n = net({ [A]: false, [B]: true });
  const m = createRouteManager({ baked: [A, B], fetch: n.fetch, ...c });
  const seen: string[] = [];
  const v = await m.run(async (base) => { seen.push(base); if (base === A) throw routeErr(); return 'ok'; }, routeFailureKind, 'same');
  assert.equal(v, 'ok');
  assert.deepEqual(seen, [A, A, B]);
  assert.equal(m.current(), B, 'remembers the healthy route');
  assert.equal(m.snapshot().routes[0].state, 'down');
  m.stop();
});

test("run 'next' (/text): one quick retry on the next route; single route → same route once more", async () => {
  const c = clock();
  const m = createRouteManager({ baked: [A, B], fetch: net({ [A]: false, [B]: true }).fetch, ...c });
  const seen: string[] = [];
  assert.equal(await m.run(async (b) => { seen.push(b); if (b === A) throw routeErr(); return 1; }, routeFailureKind, 'next'), 1);
  assert.deepEqual(seen, [A, B]);
  assert.equal(m.current(), B);
  m.stop();

  const one = createRouteManager({ baked: [A], fetch: net({ [A]: false }).fetch, ...c });
  const s1: string[] = [];
  await assert.rejects(one.run(async (b) => { s1.push(b); throw routeErr(); }, routeFailureKind, 'next'), RouteFailureError);
  assert.deepEqual(s1, [A, A]);
  assert.equal(one.allDown(), true, 'two failures in a row mark the only route down');
  one.stop();
});

test("run 'none' (/command, /stream): no resend; the route is down and the NEXT turn uses the next route", async () => {
  const c = clock();
  const m = createRouteManager({ baked: [A, B], fetch: net({ [A]: false, [B]: true }).fetch, ...c });
  let calls = 0;
  await assert.rejects(m.run(async () => { calls++; throw routeErr(); }, routeFailureKind, 'none'));
  assert.equal(calls, 1, 'large audio is never resent');
  assert.equal(m.current(), B);
  m.stop();
});

test('timeouts are not retried; our server\'s 4xx is not a route failure', async () => {
  const c = clock();
  const m = createRouteManager({ baked: [A, B], fetch: net({ [A]: true, [B]: true }).fetch, ...c });
  let calls = 0;
  await assert.rejects(m.run(async () => { calls++; throw new VoiceError('timeout'); }, routeFailureKind, 'next'));
  assert.equal(calls, 1);
  assert.equal(m.current(), B);
  m.stop();

  const m2 = createRouteManager({ baked: [A, B], fetch: net({ [A]: true, [B]: true }).fetch, ...c });
  let k = 0;
  await assert.rejects(m2.run(async () => { k++; throw new VoiceError('http', 'HTTP 400'); }, routeFailureKind, 'same'));
  assert.equal(k, 1);
  assert.equal(m2.current(), A);
  assert.equal(m2.snapshot().routes[0].state, 'ok');
  m2.stop();
});

test('down route is probed on /health with backoff 1, 2, 4, 8, 16, 30 s and the primary wins back on recovery', async () => {
  const c = clock();
  const up = { [A]: false, [B]: true };
  const n = net(up);
  const m = createRouteManager({ baked: [A, B], fetch: n.fetch, ...c });
  const recovered: string[] = [];
  m.onRecover((u) => recovered.push(u));
  m.markFail(A, { down: true });
  assert.equal(m.current(), B);
  const probeTimes: number[] = [];
  const t0 = c.now();
  for (let i = 0; i < 7; i++) {
    const before = n.calls.filter((u) => u === `${A}/health`).length;
    await c.advance(c.pending()[0]);
    if (n.calls.filter((u) => u === `${A}/health`).length > before) probeTimes.push((c.now() - t0) / 1000);
  }
  assert.deepEqual(probeTimes, [1, 3, 7, 15, 31, 61, 91]);
  up[A] = true;
  await c.advance(30_000);
  assert.equal(m.current(), A, 'switched back to the primary');
  assert.deepEqual(recovered, [A]);
  assert.equal(m.allDown(), false);
  assert.deepEqual(c.pending(), [], 'no probe left once it is up');
  m.stop();
});

test('a later route recovering does not steal the current healthy primary', async () => {
  const c = clock();
  const up = { [A]: true, [B]: false };
  const m = createRouteManager({ baked: [A, B], fetch: net(up).fetch, ...c });
  m.markFail(B, { down: true });
  assert.equal(m.current(), A);
  up[B] = true;
  await c.advance(1000);
  assert.equal(m.snapshot().routes[1].state, 'ok');
  assert.equal(m.current(), A);
  m.stop();
});

test('all routes down: allDown, round robin, status text; one recovers → used', async () => {
  const c = clock();
  const up = { [A]: false, [B]: false };
  const m = createRouteManager({ baked: [A, B], fetch: net(up).fetch, ...c });
  m.markFail(A, { down: true });
  m.markFail(B, { down: true });
  assert.equal(m.allDown(), true);
  assert.match(routeStatusText(m.snapshot(), c.now()), /no connection, retry in 1 s/);
  up[B] = true;
  await c.advance(1000);
  assert.equal(m.allDown(), false);
  assert.equal(m.current(), B);
  assert.match(routeStatusText(m.snapshot(), c.now()), /b\.trycloudflare\.com\/voice · ok \(route 2 of 2\)/);
  m.stop();
});

test('fetched config: applied in front of baked, cached, loaded from cache at start; never drops baked', async () => {
  const c = clock();
  const store = memStore();
  const n = net({ [A]: true, [B]: true, [C]: true }, { version: 1, routes: [B, C], updatedAt: '2026-11-27T10:00:00Z' });
  const m = createRouteManager({ baked: [A], fetch: n.fetch, ...c });
  await m.start(store);
  assert.deepEqual(m.routes(), [B, C, A]);
  assert.equal(m.current(), B);
  assert.equal(m.snapshot().source, 'fetched');
  assert.deepEqual(JSON.parse(store.m.get(ROUTES_CACHE_KEY)!).routes, [B, C]);
  m.stop();

  // Next app start, every route offline: the cached list is still used, baked last.
  const m2 = createRouteManager({ baked: [A], fetch: net({}).fetch, ...c });
  await m2.start(store);
  assert.deepEqual(m2.routes(), [B, C, A]);
  m2.stop();

  // A config listing nothing valid keeps the baked routes.
  const m3 = createRouteManager({ baked: [A], fetch: net({ [A]: true }, { version: 1, routes: ['http://insecure.example.com'] }).fetch, ...c });
  await m3.start(memStore());
  assert.deepEqual(m3.routes(), [A]);
  m3.stop();

  // Old server without /routes (404 JSON): nothing changes.
  const m4 = createRouteManager({ baked: [A, B], fetch: net({ [A]: true, [B]: true }).fetch, ...c });
  await m4.start(memStore());
  assert.deepEqual(m4.routes(), [A, B]);
  m4.stop();
});

test('config is refetched when a route recovers (a changed tunnel URL needs no new APK)', async () => {
  const c = clock();
  const up = { [A]: false, [C]: true };
  const NEW = 'https://new.trycloudflare.com/voice';
  const n = net({ [A]: true, [C]: true, [NEW]: true }, { version: 1, routes: [NEW] });
  const fetch: RouteFetch = (u, i) => (u.startsWith(A) && !up[A] ? Promise.reject(new TypeError('down')) : n.fetch(u, i));
  const m = createRouteManager({ baked: [A, C], fetch, ...c });
  m.markFail(A, { down: true });
  up[A] = true;
  await c.advance(1000);
  assert.deepEqual(m.routes(), [NEW, A, C]);
  assert.ok(n.calls.includes(`${A}/routes`));
  m.stop();
});

test('ngrok HTML 404 on /health keeps the route down', async () => {
  const c = clock();
  const fetch: RouteFetch = async (u) => (u.startsWith(A) ? html(404) : json(200, {}));
  const m = createRouteManager({ baked: [A, B], fetch, ...c });
  m.markFail(A, { down: true });
  await c.advance(1000);
  assert.equal(m.snapshot().routes[0].state, 'down');
  assert.equal(m.snapshot().routes[0].probeStep, 1);
  m.stop();
});
