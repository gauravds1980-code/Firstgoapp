# Zippy voice commands (push-to-talk)

Dealers hold the mic — the small badge on Zippy's docked header face (or on the floating Zippy), or the
large mic in the assistant sheet — say a command, and let go. The app records a short
clip, sends it to the **FIRSTgo STT proxy**, and shows a **staged preview** (what Zippy heard, the
matched intent, the score and any details). Nothing happens until the dealer taps **Confirm**.

## Setup

1. Run the **local** voice pipeline (`firstgo-voice-local` on port **8793**: Whisper STT + LaBSE intent + Piper TTS).
   The app defaults to `http://127.0.0.1:8793`. That server may call Google Speech-to-Text itself as a
   last-resort fallback; the app must **not** point at the Google proxy (`firstgo-stt-proxy`, port 8792)
   by default, because that costs money. Spoken replies always use **Piper** (`POST /tts` or the WAV
   already attached to a `/command` response) — never Google TTS, never expo-speech.
2. Copy `.env.example` to `.env.local` if you need to override the URL. `EXPO_PUBLIC_STT_URL` is a base
   URL with no trailing path (the app POSTs to `<url>/command` and `<url>/tts`):
     - `EXPO_PUBLIC_STT_URL=http://127.0.0.1:8793` — local pipeline (**default**, even if the env var is unset)
     - `EXPO_PUBLIC_STT_URL=http://127.0.0.1:8792` — Google proxy (avoid; billed per request)

     - `EXPO_PUBLIC_STT_URL=https://yl0nisu-anonymous-8081.exp.direct/voice` — public test URL through the Expo tunnel
       (**set this for release APKs**; no trailing slash)

     `127.0.0.1` works for web / iOS simulator on the same box (Android emulator: `10.0.2.2`); developers here can
     leave the env unset. A physical phone reaches the pipeline through the **existing Expo tunnel**: `metro.config.js`
     adds a dev-server middleware that proxies `/voice` and `/voice/*` → `http://127.0.0.1:8793`, stripping the
     prefix (`/voice/health` → `/health`, `/voice/command` → `/command`, `/voice/tts` → `/tts`). Bodies are streamed,
     CORS is open (`*`, `GET,POST,OPTIONS`, `content-type`), and if 8793 is down it answers `502 {"error":"voice proxy unavailable"}`.
     This only works while `npx expo start --tunnel` runs on this box (cloudflared / localtunnel / a second ngrok
     tunnel aren't available here). Spoken replies still come from Piper on 8793.
   - `EXPO_PUBLIC_STT_PROVIDER` — `google` means "HTTP /command client" (including the 8793 stack). `sarvam` is a stub that fails with
     "Sarvam voice is not configured yet" until it's implemented in `src/voice/sttClient.ts`.
3. Restart Metro (`npx expo start -c`) after changing env vars — `EXPO_PUBLIC_*` are inlined at build time.
4. Mic recording is native (`expo-audio`), so use a **development build** (`npx expo run:ios|android` or
   `eas build --profile development`) after pulling this change. `app.json` now enables the microphone:
   iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` (camera / image-picker / expo-audio plugins all
   carry the same string — image-picker's old `microphonePermission: false` would have *blocked* RECORD_AUDIO).

**Secrets stay on the proxy.** The app only knows the proxy URL. Never add a Google service account,
API key or Sarvam key to the app, `app.json`, or any `EXPO_PUBLIC_*` variable (those ship in the bundle).

## Where the mic lives

- **Docked Zippy (default)** — a 20 px mic badge on the lower-right of the header slot (`HeaderDockSlot`).
  It sits on top of the face as a separate control: tapping the face still opens the help sheet and
  long-pressing it still floats Zippy; only presses on the badge record.
- **Floating Zippy** — the same badge on the orb's inward lower corner (stays visible when Zippy peeks).
  Tap = sheet / drag / long-press = dock still belong to the orb.
- **Assistant sheet** — the large `VoiceMicButton`.

All three drive **one** session: `VoiceHost` (mounted once next to `ZippyBubble` in `RootNavigator`) owns
`useVoiceCommand` → the only `expo-audio` recorder, and publishes state through `src/voice/voiceSession.ts`.
With the sheet closed, VoiceHost shows a "Listening…" pill under the header, short error / read-out banners,
and the staged preview. With the sheet open, the sheet attaches (`voiceSession.attachSheet`) and shows errors,
transcript bubbles and the preview itself; closing the sheet aborts anything in flight. The voice mood
overrides the route mood on the docked face and the floating orb.

## Flow

| Step | What happens | Zippy mood |
| --- | --- | --- |
| Press & hold mic | Mic permission asked on first use, then recording (AAC .m4a, 16 kHz mono) | `thinking` (mic turns brand red) |
| Release < 250 ms | Treated as a tap; nothing is sent ("Hold the mic while you speak") | idle |
| Release | `POST ${EXPO_PUBLIC_STT_URL}/command` `{ audio: <base64>, mimeType: "audio/mp4" }`, 15 s timeout. Recording file is deleted right after reading. | `thinking` |
| Response | Transcript appended as a user bubble; preview sheet opens | `happy` |
| Confirm | `navigate` → sheet closes and `navRef.navigate(route)`; slots/filter saved to `voiceDraft`. `assistant` → answer added to the thread and spoken with **Piper** (`POST /tts`) | `cheer` |
| Cancel | Preview closes; nothing changes | idle |

Max hold is 15 s (auto-sends). `UNKNOWN` intents still show the preview, with Cancel only.

Errors are short messages (inline in the sheet, or a banner under the header when it's closed), never crashes:
- permission denied → "Microphone permission is needed to talk to Zippy. Enable it in Settings."
- `EXPO_PUBLIC_STT_URL` explicitly set to empty → "Voice is not configured on this build yet." (unset defaults to `http://127.0.0.1:8793`)
- network / timeout / non-2xx → "Could not reach the voice service. Check your connection and try again."
- `no_speech` / empty transcript → "I didn't catch that. Try again."

## Web screenshots (dev only)

In a `__DEV__` web build, open the app with `?voiceDemo=1` or run `window.__voiceDemo()` in the console to stage
the preview with a sample command ("New loan for Ramesh, Activa 125, down payment 15,000." →
`NEW_TWO_WHEELER_LOAN` → ScanQr) so Confirm is visible. It never navigates by itself; it's a no-op in release
and on native (`src/voice/voiceDemo.ts`).

## Files

- `metro.config.js` — dev-server `/voice/*` → `127.0.0.1:8793` proxy (bundling unchanged).

- `src/voice/config.ts` — env (URL defaults to 8793, provider), timeouts, hold threshold.
- `src/voice/piper.ts` — spoken replies via Piper `/tts` (no Google TTS, no expo-speech).
- `src/voice/sttClient.ts` — `postToCommand()`, response parsing, provider switch (`google` | `sarvam` stub).
- `src/voice/permissions.ts` — mic permission helpers.
- `src/voice/usePushToTalk.ts` — press-in / press-out recorder hook.
- `src/voice/useVoiceCommand.ts` — the whole voice flow (record → send → preview → confirm).
- `src/voice/VoiceHost.tsx` — owns the one session; pill / banners / preview when the sheet is closed.
- `src/voice/voiceSession.ts` — shared store + actions every mic uses; sheet attach/detach.
- `src/voice/VoiceMicBadge.tsx` — compact PTT badge on docked / floating Zippy.
- `src/voice/VoiceMicButton.tsx`, `src/voice/VoicePreviewSheet.tsx` — sheet mic and preview UI.
- `src/voice/applyCommand.ts` — plan / apply a confirmed command, read-outs, slot formatting.
- `src/voice/voiceDraft.ts` — in-memory draft of spoken slots (see below).
- `src/navigation/navRef.ts` — `navRef` moved here (still re-exported from `RootNavigator`) to avoid a require cycle.

## Voice draft (slots)

"New loan for Ramesh, Activa 125, down payment 15,000, 24 months" → on Confirm the app navigates to the
proxy's route (e.g. `ScanQr`) and stores:

```ts
{ intent, transcript, route, filter?, slots: { customerName?, vehicle?, vehicleCategory?, downPayment?, tenureMonths?, mobileNumber? }, createdAt }
```

No screen reads it yet (SearchMobile / Offer / Asset have no form-state hook). To use it, call
`useVoiceDraft()` or `voiceDraft.consume()` on mount and pre-fill what applies. It's memory-only and expires
after 10 minutes. The proxy's `filter` hints (`overdue`, `pending_disbursal`, `tenure`…) land in the same
draft; Cases / Offer don't apply them yet.

## Not done yet

- Screens don't consume `voiceDraft` / `filter` yet.
- No streaming / partial transcripts (the proxy does batch recognize).
- Screen-reader users: hold-to-talk needs a hold gesture; a tap-to-toggle mode would help VoiceOver/TalkBack.
  The header badge is small (20 px + hit slop) by design so the header doesn't grow; the sheet mic is the large target.
- Sheet closed + "help / explain screen" read-outs use the screen tip (the sheet's section-aware text needs it open).
- Use dummy customers only while prototyping; recordings aren't stored on the device.
