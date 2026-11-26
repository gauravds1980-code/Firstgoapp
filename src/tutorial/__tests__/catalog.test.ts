/**
 * Tutorial catalogue: URL building, (empty) alias table, remote manifest merge, bundled-first source
 * order and fallback, probe, and failure → Retry (never "coming soon"). Pure Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_ALIAS, BUILTIN_AVAILABLE_ASSETS, assetIdFor, buildCatalog, classifyProbe, condenseManifest, failureFromProbe,
  isCatalogComingSoon, joinUrl, nextSourceIndex, normalizeBase, parseRemoteManifest, sourcesFor, tutorialPaths, tutorialUrls,
} from '../catalog';

const BASE = 'https://example.test/tutorial';

test('URLs: base + relative paths with the server-side names', () => {
  assert.equal(normalizeBase(' https://x.test/tutorial/// '), 'https://x.test/tutorial');
  assert.equal(joinUrl(`${BASE}/`, '/posters/a.jpg'), `${BASE}/posters/a.jpg`);
  assert.equal(joinUrl(BASE, 'https://cdn.test/a.mp4'), 'https://cdn.test/a.mp4');
  assert.deepEqual(tutorialUrls(BASE, 'mandate'), {
    hls: `${BASE}/hls/mandate/master.m3u8`, mp4: `${BASE}/mandate.mp4`, poster: `${BASE}/posters/mandate.jpg`,
    thumb: `${BASE}/posters/mandate-thumb.jpg`, vtt: `${BASE}/mandate.vtt`,
  });
  // Web default base is same-origin: relative, or the page origin + /tutorial.
  assert.equal(joinUrl('/tutorial', 'scan-offer.mp4'), '/tutorial/scan-offer.mp4');
  assert.equal(joinUrl('/tutorial/', '/posters/scan-offer.jpg'), '/tutorial/posters/scan-offer.jpg');
  assert.equal(joinUrl('http://localhost:8091/tutorial', 'manifest.json'), 'http://localhost:8091/tutorial/manifest.json');
  assert.equal(tutorialUrls('/tutorial', 'ekyc').hls, '/tutorial/hls/ekyc/master.m3u8');
});

test('no alias: scan-offer streams its own render (not sample-scan-qr)', () => {
  assert.equal(ASSET_ALIAS['scan-offer'], undefined);
  assert.equal(assetIdFor('scan-offer'), 'scan-offer');
  assert.equal(assetIdFor('mandate'), 'mandate');
  assert.equal(tutorialPaths('scan-offer').mp4, 'scan-offer.mp4');
  assert.equal(tutorialPaths('scan-offer').hls, 'hls/scan-offer/master.m3u8');
  assert.equal(tutorialPaths('scan-offer').thumb, 'posters/scan-offer-thumb.jpg');
});

test('no manifest: the built-in rendered shorts are available', () => {
  const c = buildCatalog(null);
  assert.equal(c.length, 12);
  assert.ok(c.every((i) => i.availability === 'available'));
  assert.ok(BUILTIN_AVAILABLE_ASSETS.has('scan-offer'));
  assert.ok(!BUILTIN_AVAILABLE_ASSETS.has('sample-scan-qr'));
  assert.ok(c.every((i) => i.builtin));
});

test('manifest: parses JSON, rejects the tunnel HTML fallback and bad shapes', () => {
  assert.equal(parseRemoteManifest('<!doctype html><html>…', 'text/html'), null);
  assert.equal(parseRemoteManifest('<!doctype html>'), null);
  assert.equal(parseRemoteManifest('{"items": 3}'), null);
  assert.equal(parseRemoteManifest('{nope'), null);
  const m = parseRemoteManifest(JSON.stringify({ version: 2, items: [{ id: 'mandate', durationSec: 17.2, mp4: 'mandate.mp4' }, { id: 5 }, { title: 'x' }] }), 'application/json');
  assert.deepEqual(m, { version: 2, items: [{ id: 'mandate', title: undefined, durationSec: 17.2, mp4: 'mandate.mp4', hls: undefined, poster: undefined, thumb: undefined, vtt: undefined }] });
});

test('manifest merge: availability, durations and paths from the server; new shorts appended; drafts hidden', () => {
  const m = parseRemoteManifest(JSON.stringify({ items: [
    { id: 'sample-scan-qr', durationSec: 21, title: 'Sample' },
    { id: 'scan-offer', durationSec: 20.4 },
    { id: 'promo-draft', durationSec: 40 },
    { id: 'mandate', durationSec: 17, poster: 'posters/mandate-v2.jpg' },
    { id: 'rc-upload', title: 'RC upload', durationSec: 12 },
  ] }))!;
  const c = buildCatalog(m);
  const byId = Object.fromEntries(c.map((i) => [i.id, i]));
  assert.equal(byId.mandate!.availability, 'available');
  assert.equal(byId.mandate!.durationSec, 17);
  assert.equal(byId.mandate!.paths.poster, 'posters/mandate-v2.jpg');
  assert.equal(byId['scan-offer']!.availability, 'available');
  assert.equal(byId['scan-offer']!.durationSec, 20.4, 'its own render, not the sample');
  assert.equal(byId.esign!.durationSec, 19, 'unlisted: catalogue length');
  assert.equal(byId.esign!.availability, 'missing', 'listed nowhere → coming soon');
  assert.equal(byId['promo-draft'], undefined);
  assert.equal(byId['sample-scan-qr'], undefined, 'sample-* drafts are hidden');
  assert.equal(byId['rc-upload']!.builtin, false);
  assert.equal(byId['rc-upload']!.paths.mp4, 'rc-upload.mp4');
  assert.ok(condenseManifest(m).length < 2048, 'cached copy fits secure storage');
});

test('sources: HLS then MP4 on native (cache where supported), MP4 only on web', () => {
  const urls = { hls: `${BASE}/hls/a/master.m3u8`, mp4: `${BASE}/a.mp4` };
  assert.deepEqual(sourcesFor(urls, 'android').map((s) => [s.kind, s.useCaching]), [['hls', true], ['mp4', true]]);
  assert.deepEqual(sourcesFor(urls, 'ios').map((s) => [s.kind, s.useCaching]), [['hls', false], ['mp4', true]]);
  assert.deepEqual(sourcesFor(urls, 'web').map((s) => s.kind), ['mp4']);
  assert.equal(nextSourceIndex(0, 2), 1, 'HLS failed → MP4');
  assert.equal(nextSourceIndex(1, 2), null, 'MP4 failed → give up (probe decides)');
  assert.equal(nextSourceIndex(0, 1), null);
});

test('sources: a bundled MP4 goes first on native (then HLS, then MP4); web never gets one', () => {
  const urls = { hls: `${BASE}/hls/a/master.m3u8`, mp4: `${BASE}/a.mp4` };
  const android = sourcesFor(urls, 'android', { assetId: 42 });
  assert.deepEqual(android.map((s) => [s.kind, s.useCaching]), [['bundled', false], ['hls', true], ['mp4', true]]);
  assert.deepEqual(android[0], { kind: 'bundled', assetId: 42, useCaching: false });
  assert.equal('uri' in android[0]!, false, 'no uri on a bundled source (it would override assetId)');
  assert.deepEqual(sourcesFor(urls, 'ios', { assetId: 7 }).map((s) => s.kind), ['bundled', 'hls', 'mp4']);
  assert.deepEqual(sourcesFor(urls, 'web', { assetId: 7 }).map((s) => s.kind), ['mp4'], 'web: same-origin MP4 only');
  assert.deepEqual(sourcesFor(urls, 'android', {}).map((s) => s.kind), ['hls', 'mp4'], 'remote-only short');
  assert.deepEqual(sourcesFor(urls, 'android', { assetId: undefined }).map((s) => s.kind), ['hls', 'mp4']);
  assert.equal(nextSourceIndex(0, 3), 1, 'bundled failed → HLS');
  assert.equal(nextSourceIndex(1, 3), 2, 'HLS failed → MP4');
  assert.equal(nextSourceIndex(2, 3), null);
});

test('failure: a catalogue short that failed to play is retryable, never coming soon', () => {
  const item = buildCatalog(null).find((i) => i.id === 'scan-offer')!;
  assert.equal(isCatalogComingSoon(item), false);
  // Tunnel 404 / HTML fallback, timeouts, 5xx, CORS: all "Couldn't load" + Retry, never "missing".
  for (const p of [
    { ok: false, status: 404 }, { ok: true, status: 200, contentType: 'text/html' }, { ok: false, status: 503 },
    { error: 'cors' as const }, { ok: true, status: 206, contentType: 'video/mp4' },
  ]) assert.equal(failureFromProbe(classifyProbe(p)), 'error', JSON.stringify(p));
  assert.equal(failureFromProbe(classifyProbe({ error: 'timeout' })), 'offline');
  assert.equal(failureFromProbe(classifyProbe({ error: 'network' })), 'offline');
  assert.equal(failureFromProbe(null), 'error');
  assert.equal(isCatalogComingSoon(item), false, 'still available after the failure');
  // Coming soon comes from the catalogue alone.
  assert.equal(isCatalogComingSoon(undefined), true);
  assert.equal(isCatalogComingSoon({ availability: 'missing' }), true);
});

test('bundled shorts stay available even when a manifest does not list them', () => {
  const m = parseRemoteManifest(JSON.stringify({ items: [{ id: 'mandate' }, { id: 'promo' }, { id: 'sample-scan-qr' }] }))!;
  const byId = Object.fromEntries(buildCatalog(m, new Set(['esign'])).map((i) => [i.id, i]));
  assert.equal(byId.esign!.availability, 'available', 'packed in the app');
  assert.equal(byId.mandate!.availability, 'available');
  assert.equal(byId.ekyc!.availability, 'missing', 'neither packed nor listed');
  assert.equal(byId.promo, undefined, 'bare promo is hidden like promo-*');
  assert.equal(byId['sample-scan-qr'], undefined);
});

test('probe: HTML / 404 = not a video, network / timeout = offline, video types = video', () => {
  assert.equal(classifyProbe({ ok: true, status: 200, contentType: 'text/html; charset=utf-8' }), 'missing');
  assert.equal(classifyProbe({ ok: false, status: 404 }), 'missing');
  assert.equal(classifyProbe({ error: 'network' }), 'offline');
  assert.equal(classifyProbe({ error: 'timeout' }), 'offline');
  assert.equal(classifyProbe({ error: 'cors' }), 'unknown');
  assert.equal(classifyProbe({ ok: true, status: 206, contentType: 'video/mp4' }), 'video');
  assert.equal(classifyProbe({ ok: true, status: 200, contentType: 'application/vnd.apple.mpegurl' }), 'video');
  assert.equal(classifyProbe({ ok: true, status: 206, contentType: 'application/octet-stream' }), 'video');
  assert.equal(classifyProbe({ ok: false, status: 503 }), 'unknown');
});
