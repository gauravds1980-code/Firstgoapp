# Tutorial videos (v1.3.0) — streamed, never bundled

The app ships **no** tutorial videos or posters. Everything streams from `TUTORIAL_BASE_URL`
(`src/tutorial/config.ts`), set with `EXPO_PUBLIC_TUTORIAL_BASE_URL` at build time (default:
`https://yl0nisu-anonymous-8081.exp.direct/tutorial`, which serves `/workspace/boom-rn/public/tutorial`).

## Files on the server (per short id; names are fixed)

| file | use |
| --- | --- |
| `<id>.mp4` | 720x1280 H.264 main, faststart. Web, and native fallback when HLS fails |
| `hls/<id>/master.m3u8` | 480p + 720p adaptive HLS. Native first choice |
| `posters/<id>.jpg` | 720x1280 poster, shown instantly in the feed |
| `posters/<id>-thumb.jpg` | 360x640 thumbnail (Help grid, Zippy bubble) |
| `<id>.vtt` / `<id>.srt` | captions (videos also have burned-in captions) |
| `manifest.json` | `{ version, items: [{ id, title, durationSec, mp4, hls, poster, thumb, vtt, … }] }` |

Ids: `full, login, scan-offer, vehicle-emi, ekyc, mandate, esign, docs-disbursal, payouts-utr,
portfolio-cases-rc, tainf, zippy-voice` (screen mapping in `shortMap.ts`).

## Adding / replacing a video
Upload the files above with the short's id and list it in `manifest.json` — no app release needed.
The app reads the manifest at launch (4 s timeout, cached), marks listed shorts available, and takes
their durations / paths from it. Unlisted shorts show "Coming soon". New ids in the manifest (not
`promo-*` / `sample-*` / `draft-*`) are appended to the feed.

`ASSET_ALIAS` in `catalog.ts` can point a short at another server file while its own render is
missing. It is empty: every short, `scan-offer` included, now streams under its own id. Without a
readable manifest (offline, or web with no CORS on the tunnel), `BUILTIN_AVAILABLE_ASSETS` (all 12
rendered shorts) decides what is tried.

## Playback
- Native: HLS, one automatic swap to the MP4 on error or a 12 s load stall; web: MP4.
- All sources failed → probe: offline → "You're offline" + Retry; otherwise "coming soon".
- expo-video disk cache 100 MB (`setVideoCacheSizeAsync`, MP4 everywhere native, HLS on Android only).
- Preload: Help preloads the first unwatched short; a Zippy nudge preloads its short; the feed keeps
  players for the active short + the next two (max 3).
