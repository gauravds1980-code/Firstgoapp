/**
 * Tutorial catalogue helpers (v1.3.0, bundled playback v1.3.2). PURE (no React Native) so they are
 * unit-tested in Node.
 *
 * The 12 catalogue shorts are bundled in the native app (bundledVideos.native.ts / bundledPosters.ts)
 * and served same-origin from /tutorial on web. TUTORIAL_BASE_URL is the remote fallback, and the only
 * source for new remote-only ids from manifest.json. Server-side names (produced by the render pipeline):
 *   <asset>.mp4                 720x1280 H.264 main, faststart (fallback + web)
 *   hls/<asset>/master.m3u8     480p + 720p adaptive HLS (native)
 *   posters/<asset>.jpg         720x1280 poster
 *   posters/<asset>-thumb.jpg   360x640 thumbnail
 *   <asset>.vtt / <asset>.srt   captions (the videos also have burned-in captions)
 *   manifest.json               { version, items: [{ id, title, durationSec, mp4, hls, poster, thumb, vtt, … }] }
 * `<asset>` is the short id, unless ASSET_ALIAS points it at another file.
 */
import { SHORT_IDS, SHORT_INFO, type ShortId } from './shortMap';

/**
 * App short id → server asset id, for shorts whose final render is not there yet. ONE place to edit:
 * delete a line once `<id>.mp4` exists on the server under its own name.
 */
export const ASSET_ALIAS: Readonly<Partial<Record<string, string>>> = {};

/**
 * Assets known to exist when the remote manifest can't be read (offline, timeout, the tunnel's HTML
 * fallback). Everything else is "coming soon" until manifest.json lists it (or the app bundles it).
 */
export const BUILTIN_AVAILABLE_ASSETS: ReadonlySet<string> = new Set<string>(SHORT_IDS);

/** Remote manifest items with these prefixes are drafts / samples, never shown as new shorts. */
const HIDDEN_REMOTE = /^(promo|sample|draft)([-_]|$)/i;

export const assetIdFor = (id: string): string => ASSET_ALIAS[id] ?? id;

/** Trim and drop trailing slashes; '' stays ''. */
export const normalizeBase = (base: string): string => base.trim().replace(/\/+$/, '');

/** base + relative path (absolute http(s) paths are kept as they are). */
export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normalizeBase(base)}/${path.replace(/^\/+/, '')}`;
}

export type TutorialPaths = { hls: string; mp4: string; poster: string; thumb: string; vtt: string };

/** Relative paths for an app short id (alias applied). */
export function tutorialPaths(id: string): TutorialPaths {
  const a = assetIdFor(id);
  return { hls: `hls/${a}/master.m3u8`, mp4: `${a}.mp4`, poster: `posters/${a}.jpg`, thumb: `posters/${a}-thumb.jpg`, vtt: `${a}.vtt` };
}

/** Absolute URLs for an app short id. */
export function tutorialUrls(base: string, id: string, paths: TutorialPaths = tutorialPaths(id)): TutorialPaths {
  return {
    hls: joinUrl(base, paths.hls), mp4: joinUrl(base, paths.mp4), poster: joinUrl(base, paths.poster),
    thumb: joinUrl(base, paths.thumb), vtt: joinUrl(base, paths.vtt),
  };
}

// ---- remote manifest -----------------------------------------------------------------------------

export type RemoteItem = { id: string; title?: string; durationSec?: number; mp4?: string; hls?: string; poster?: string; thumb?: string; vtt?: string };
export type RemoteManifest = { version?: string | number; items: RemoteItem[] };

/** Parse manifest.json text; null for HTML fallbacks, invalid JSON or a wrong shape. */
export function parseRemoteManifest(text: string, contentType?: string | null): RemoteManifest | null {
  if (contentType && /text\/html/i.test(contentType)) return null;
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const raw = JSON.parse(t) as { version?: unknown; items?: unknown };
    if (!raw || !Array.isArray(raw.items)) return null;
    const items: RemoteItem[] = [];
    for (const it of raw.items as Record<string, unknown>[]) {
      if (!it || typeof it.id !== 'string' || !it.id) continue;
      const str = (k: string) => (typeof it[k] === 'string' && it[k] ? (it[k] as string) : undefined);
      const d = typeof it.durationSec === 'number' && Number.isFinite(it.durationSec) && it.durationSec > 0 ? it.durationSec : undefined;
      items.push({ id: it.id, title: str('title'), durationSec: d, mp4: str('mp4'), hls: str('hls'), poster: str('poster'), thumb: str('thumb'), vtt: str('vtt') });
    }
    const version = typeof raw.version === 'string' || typeof raw.version === 'number' ? raw.version : undefined;
    return { version, items };
  } catch { return null; }
}

export type CatalogItem = {
  id: string;
  assetId: string;
  title: string;
  subtitle: string;
  durationSec: number;
  paths: TutorialPaths;
  /**
   * 'available' = shipped / worth trying to play; 'missing' = coming soon. Only the catalogue decides
   * this: a failed play is a load error with Retry, never "coming soon" (see failureFromProbe).
   */
  availability: 'available' | 'missing';
  /** Built into the app (has a screen mapping, copy) vs. picked up from the remote manifest. */
  builtin: boolean;
};

/**
 * Built-in list + optional remote manifest → catalogue. With a manifest, an item is available iff the
 * manifest lists its asset (and its paths / duration win) or `bundled` (short ids packed in the app)
 * has it; without one, BUILTIN_AVAILABLE_ASSETS decides. New remote ids (not built in, not drafts /
 * samples, not alias targets) are appended as extra shorts.
 */
export function buildCatalog(remote: RemoteManifest | null, bundled: ReadonlySet<string> = new Set()): CatalogItem[] {
  const byAsset = new Map((remote?.items ?? []).map((i) => [i.id, i] as const));
  const out: CatalogItem[] = SHORT_IDS.map((id: ShortId) => {
    const info = SHORT_INFO[id];
    const assetId = assetIdFor(id);
    const r = byAsset.get(assetId);
    const base = tutorialPaths(id);
    const paths: TutorialPaths = r ? { hls: r.hls ?? base.hls, mp4: r.mp4 ?? base.mp4, poster: r.poster ?? base.poster, thumb: r.thumb ?? base.thumb, vtt: r.vtt ?? base.vtt } : base;
    const available = bundled.has(id) || (remote ? !!r : BUILTIN_AVAILABLE_ASSETS.has(assetId));
    return {
      id, assetId, title: info.title, subtitle: info.subtitle,
      // The length of what actually plays (also for an aliased stand-in), else the planned length.
      durationSec: r?.durationSec ?? info.durationSec,
      paths, availability: available ? 'available' : 'missing', builtin: true,
    };
  });
  const used = new Set(out.map((o) => o.assetId));
  for (const r of remote?.items ?? []) {
    if (used.has(r.id) || HIDDEN_REMOTE.test(r.id) || (SHORT_IDS as readonly string[]).includes(r.id)) continue;
    const base = tutorialPaths(r.id);
    out.push({
      id: r.id, assetId: r.id, title: r.title ?? r.id.replace(/[-_]/g, ' '), subtitle: '', durationSec: r.durationSec ?? 15,
      paths: { hls: r.hls ?? base.hls, mp4: r.mp4 ?? base.mp4, poster: r.poster ?? base.poster, thumb: r.thumb ?? base.thumb, vtt: r.vtt ?? base.vtt },
      availability: 'available', builtin: false,
    });
  }
  return out;
}

/** Small persisted copy of the remote manifest (fits secure storage): ids, titles, durations, paths. */
export function condenseManifest(m: RemoteManifest): string {
  return JSON.stringify({ version: m.version, items: m.items.map(({ id, title, durationSec, mp4, hls, poster, thumb, vtt }) => ({ id, title, durationSec, mp4, hls, poster, thumb, vtt })) });
}

// ---- sources & fallback --------------------------------------------------------------------------

export type SourceKind = 'bundled' | 'hls' | 'mp4';
export type PlannedSource =
  | { kind: 'bundled'; assetId: number; useCaching: false }
  | { kind: 'hls' | 'mp4'; uri: string; useCaching: boolean };

/**
 * Ordered sources to try. Native: the MP4 packed in the app (when `bundled.assetId` is given), then
 * adaptive HLS, then the faststart MP4. Web: the (same-origin) MP4 only (Chrome has no native HLS, and
 * web never gets a packed MP4). Caching: expo-video's disk cache for remote MP4 everywhere native and
 * for HLS on Android (iOS can't cache HLS); a packed file needs none.
 */
export function sourcesFor(
  urls: Pick<TutorialPaths, 'hls' | 'mp4'>, platform: 'ios' | 'android' | 'web' | string, bundled: { assetId?: number } = {},
): PlannedSource[] {
  if (platform === 'web') return [{ kind: 'mp4', uri: urls.mp4, useCaching: false }];
  const remote: PlannedSource[] = [
    { kind: 'hls', uri: urls.hls, useCaching: platform === 'android' },
    { kind: 'mp4', uri: urls.mp4, useCaching: true },
  ];
  return bundled.assetId != null ? [{ kind: 'bundled', assetId: bundled.assetId, useCaching: false }, ...remote] : remote;
}

/** After source `failedIndex` errored: the next one to try, or null when everything failed. */
export function nextSourceIndex(failedIndex: number, total: number): number | null {
  return failedIndex + 1 < total ? failedIndex + 1 : null;
}

export type ProbeResult = { ok?: boolean; status?: number; contentType?: string | null; error?: 'network' | 'timeout' | 'cors' | null };
export type ProbeVerdict = 'video' | 'missing' | 'offline' | 'unknown';

/**
 * Classify a small Range request for a video URL. The tunnel answers missing files with its SPA's
 * HTML (200 text/html), so content type matters more than the status code.
 */
export function classifyProbe(p: ProbeResult): ProbeVerdict {
  if (p.error === 'network' || p.error === 'timeout') return 'offline';
  if (p.error === 'cors') return 'unknown';
  if (p.status === 404 || p.status === 410) return 'missing';
  const ct = (p.contentType ?? '').toLowerCase();
  if (/text\/html|application\/json|text\/plain/.test(ct)) return 'missing';
  if (p.ok && (/^video\/|mpegurl|octet-stream|mp2t/.test(ct) || ct === '')) return 'video';
  if (p.status && p.status >= 500) return 'unknown';
  return p.ok ? 'unknown' : 'missing';
}

/** Why playback gave up: 'offline' → "You're offline" + Retry; 'error' → "Couldn't load" + Retry. */
export type PlaybackFailure = 'offline' | 'error';

/**
 * Every source failed → what to tell the dealer. Never "coming soon": a 404 / HTML fallback / timeout
 * from the tunnel is often transient, and a short in the catalogue is one we ship. Always retryable.
 */
export const failureFromProbe = (v: ProbeVerdict | null | undefined): PlaybackFailure => (v === 'offline' ? 'offline' : 'error');

/** "Coming soon" comes from the catalogue alone (not listed / not shipped), never from a failed play. */
export const isCatalogComingSoon = (item: Pick<CatalogItem, 'availability'> | undefined | null): boolean =>
  !item || item.availability === 'missing';
