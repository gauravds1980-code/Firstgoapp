# Tutorial videos (v1.3.2) — bundled first, remote fallback

The 12 catalogue shorts ship **in the app**, so Help & tutorials and the shorts feed work offline and
never depend on the Expo dev tunnel:

| platform | video | poster / thumbnail |
| --- | --- | --- |
| native | `assets/tutorial/<id>.mp4` via `bundledVideos.native.ts` (expo-video `{ assetId }`) | `assets/tutorial/posters/*.jpg` via `bundledPosters.ts` |
| web | same-origin `/tutorial/<id>.mp4` (`public/tutorial`, hardlinks of the same files) | bundled (`bundledPosters.ts`) |

`bundledVideos.web.ts` is empty on purpose: a shared `require()` of the MP4s would put ~34 MB of
video into the web bundle. `bundledAssets.ts` looks up the packed files for a short.

`TUTORIAL_BASE_URL` (`src/tutorial/config.ts`, `EXPO_PUBLIC_TUTORIAL_BASE_URL` at build time) is the
remote fallback, the source of `manifest.json`, and the only source for new remote-only shorts.
Default: native → `https://yl0nisu-anonymous-8081.exp.direct/tutorial` (dev tunnel, serves
`/workspace/boom-rn/public/tutorial`); web → same-origin `/tutorial`.

## Files (per short id; names are fixed)

| file | use |
| --- | --- |
| `<id>.mp4` | 720x1280 H.264 main, faststart. Bundled on native; what web plays; remote fallback |
| `hls/<id>/master.m3u8` | 480p + 720p adaptive HLS. Native remote fallback |
| `posters/<id>.jpg` | 720x1280 poster, shown instantly in the feed |
| `posters/<id>-thumb.jpg` | 360x640 thumbnail (Help grid, Zippy bubble) |
| `<id>.vtt` / `<id>.srt` | captions (videos also have burned-in captions) |
| `manifest.json` | `{ version, items: [{ id, title, durationSec, mp4, hls, poster, thumb, vtt, … }] }` |

Ids: `full, login, scan-offer, vehicle-emi, ekyc, mandate, esign, docs-disbursal, payouts-utr,
portfolio-cases-rc, tainf, zippy-voice` (screen mapping in `shortMap.ts`). `promo`, `sample-*`,
`draft-*` are never shown or bundled.

## Adding / replacing a video
- Re-render of a catalogue short: replace `assets/tutorial/<id>.mp4` (and the posters) in place and
  ship a release; `public/tutorial` holds hardlinks of the same files for web.
- Without a release: upload the files to the server and list them in `manifest.json`. A manifest item
  whose `mp4` / `poster` / `thumb` path differs from the default (e.g. `posters/mandate-v2.jpg`) uses
  the remote file instead of the bundled one. New ids (not `promo` / `sample-*` / `draft-*`) are
  appended to the feed and stream from `TUTORIAL_BASE_URL`.

The app reads the manifest at launch (4 s timeout, cached). Bundled shorts are always available;
other built-ins are available when the manifest lists them (or, without a readable manifest,
`BUILTIN_AVAILABLE_ASSETS`). Only shorts that are not available show "Coming soon".

`ASSET_ALIAS` in `catalog.ts` can point a short at another server file while its own render is
missing. It is empty.

## Playback
- Native: bundled MP4 → remote HLS → remote MP4; a source that errors or does not load in 12 s moves
  to the next. Web: the same-origin MP4.
- All sources failed → "You're offline" (probe says offline) or "Couldn't load this how-to", both with
  Retry (starts again at the bundled file). A failed play never turns a short into "coming soon".
- Web autoplay with sound is often blocked: if the active page is not playing after 1.5 s and the
  dealer did not pause it, the play button shows; one tap starts it with sound.
- expo-video disk cache 100 MB for streamed fallbacks (MP4 everywhere native, HLS on Android only).
- Preload: Help preloads the first unwatched short; a Zippy nudge preloads its short; the feed keeps
  players for the active short + the next two (max 3).
- `metro.config.js` adds `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=86400`
  to successful `/tutorial/*` responses (takes effect the next time Metro starts).
