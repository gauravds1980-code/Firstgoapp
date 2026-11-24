# Zippy voice commands (push-to-talk)

Dealers hold the **header mic** — a standalone microphone button in the top header bar, next to (but separate
from) Zippy — say a command, and let go. The app records a short
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

## Where the mic lives (v1.2.8)

The mic is **`HeaderVoiceMic`** (`src/voice/HeaderVoiceMic.tsx`): a compact 44 dp icon button in its own header
slot, a sibling of Zippy's `HeaderDockSlot`. It is in every header that has a dock slot:

- Home: `BrandLockup | HeaderDockSlot (Zippy) | HeaderVoiceMic | bell | GP avatar`
- `BrandHeader` (journey + other main-stack screens): `[back]? | mark + title | [help]? | HeaderDockSlot | HeaderVoiceMic | [Home]`
- `AuthScaffold`: `lockup | [top]? | HeaderVoiceMic | HeaderDockSlot`
- Scan QR / Face e-KYC top bars: `close | (spacer) | title | HeaderDockSlot | HeaderVoiceMic`

Press-and-hold records; while listening the button turns solid and shows an elapsed timer (`0:03`); while the
request is in flight it shows a spinner and ignores new holds. Labels: "Hold to talk", "Listening, let go to send",
"Working it out". Shipped in release builds.

**Zippy and the mic are independent.** There is no mic on Zippy's docked face, on the floating orb, or in the
help sheet. The mic never opens the sheet, never docks / undocks Zippy and does not look at Zippy's dock phase;
`firstgo.zippy.float` only moves Zippy — the mic stays in the header. Voice no longer drives Zippy's mood or
lips (no listening / thinking / happy / cheer from a voice command); Zippy shows its route mood only.

One session: `VoiceHost` (mounted once in `RootNavigator`) owns `useVoiceCommand` → the only `expo-audio`
recorder, and publishes state through `src/voice/voiceSession.ts`. VoiceHost always draws the results itself —
"Listening…" pill, error / read-out banners, the auto-act toast + Undo, and the staged preview (Confirm /
clarify / say again) — whether or not the help sheet is open (when the sheet's Modal is up, the overlay is lifted
into its own transparent Modal so it stays on top). Heard transcripts are never added to the sheet thread, and
opening / closing the sheet never aborts a recording or a Piper read-out. The spoken "open Zippy" command still
opens the help sheet (`zippyDock.requestSheet()`); a raw mic press never does.

## Flow

| Step | What happens | Header mic |
| --- | --- | --- |
| Press & hold mic | Mic permission asked on first use, then recording (AAC .m4a, 16 kHz mono) | solid brand red + timer |
| Release < 250 ms | Treated as a tap; nothing is sent ("Hold the mic while you speak") | idle |
| Release | `POST ${EXPO_PUBLIC_STT_URL}/command` `{ audio: <base64>, mimeType: "audio/mp4", sessionId, screen, context: { route }, expect? }`, 45 s timeout. Recording file is deleted right after reading. | spinner |
| Response | Preview opens in VoiceHost's overlay (or auto-act + toast for high confidence) | idle |
| Confirm | `navigate` → `navRef.navigate(route)`; slots/filter saved to `voiceDraft`. `assistant` → answer shown as a banner and spoken with **Piper** (`POST /tts`) | idle |
| Cancel | Preview closes; nothing changes | idle |

Max hold is 15 s (auto-sends). `UNKNOWN` intents still show the preview, with Cancel only.

Errors are short banners under the header (VoiceHost), never crashes:
- permission denied → "Microphone permission is needed for voice commands. Enable it in Settings."
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
- `src/voice/VoiceHost.tsx` — owns the one session; pill / banners / toast / preview (always, sheet open or not).
- `src/voice/voiceSession.ts` — shared store + actions the header mic uses; sheet-visible flag only.
- `src/voice/HeaderVoiceMic.tsx` — the standalone header push-to-talk button (v1.2.8).
- `src/voice/VoicePreviewSheet.tsx` — preview UI (Confirm / clarify / say again).
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
  The header mic is a 44 dp target so the header doesn't grow.
- "help / explain screen" read-outs use the screen tip (the sheet's section-aware text is not used by voice).
- Use dummy customers only while prototyping; recordings aren't stored on the device.

## v1.2.6 contract and behaviour

- **Request**: every `/command`, `/tts` and `/tts/done` carries the in-memory `sessionId` (`src/voice/voiceContext.ts`).
  `/command` also sends `screen`, `context.route` and `expect` — `otp` on DealerOtp and on SearchMobile's OTP stage,
  `phone` on SearchMobile's number stage (SearchMobile mirrors its stage into route params for this).
- **Response** (all optional): `status` (`ok` / `clarify` / `retry` / `reprompt`), `candidates`, `normalizedFields`
  (real values — fill-on-Confirm only, never shown or logged), `normalizedFieldsDisplay` (OTP masked — what the UI shows),
  `readBack`, `reference`, `offerKeyboard`, `repromptCount`, `hasOtpField`. Parsing lives in `sttClient.parseResponse`;
  pure helpers in `voiceLogic.ts` (tested by `npm run test:voice`).
- **Read-back**: the preview plays the Piper WAV from the `/command` response (no second `/tts`). The mic ignores holds
  while a Piper read-out is playing ("Wait until the read-out finishes, then hold the mic."); playback end or stop posts `/tts/done`. HTTP 409 shows
  "Still speaking. Wait until the read-out finishes…".
- **Preview**: `clarify` → "Did you mean…?" with two candidate buttons; `retry` → "Sorry, say that again." with examples;
  `reprompt` → field error + "Type it instead" (prominent when `offerKeyboard` or `repromptCount >= 2`); a digit-only
  utterance → "Use this number / amount / OTP". OTP rows are always masked; typed OTPs use a secure input.
- **Fill**: Confirm writes PHONE → `mobileNumber`, AMOUNT → `downPayment`, OTP → `otp` into `voiceDraft`. SearchMobile fills the
  mobile field; SearchMobile (OTP stage) and DealerOtp fill the OTP boxes. Nothing is auto-submitted.
- **Streaming**: `EXPO_PUBLIC_VOICE_STREAMING=1` (default off) enables the HTTP chunked client (`/stream/{id}/start|chunk|end`),
  but the server's chunks must be raw s16le PCM and expo-audio records AAC, so today every clip still goes through
  whole-clip `/command`. No WebSockets (the Expo tunnel strips Upgrade).
