# Zippy voice commands

## v1.4.0 — fast, live, correctable

**Two talk modes** (Profile → *Talking to Zippy* → Talk mode; `src/voice/voiceSettings.ts`):
- **Hold to talk** (default): press and hold the header mic, release ends the turn. No silence wait after release.
- **Tap to talk** (hands-free): tap once and speak; the turn ends at the recognizer's end-of-speech (15 s cap). Tap again to cancel.
  On the server fallback path the end of the turn comes from expo-audio input metering (`createEndpointer`, ~700 ms of silence after speech).

**Primary path: the phone's recognizer** (`expo-speech-recognition` 58.0.1, `src/voice/deviceAsr.ts`). Live partial words in the pill while
the dealer speaks; `en-IN` by default, `hi-IN` or *Auto* in settings (Devanagari is transliterated before matching); on-device / offline
when the phone has the model for the locale (`supportsOnDeviceRecognition`, Android `getSupportedLocales().installedLocales`); biased with
the dealer glossary + on-screen labels (`contextualStrings`, `voiceMode.DEALER_GLOSSARY`, never digit runs). Its final text goes straight to
the **on-device keyword/fuzzy matcher** (`intentMatcher.ts`, p95 ≈ 2 ms) and acts without any server call. Utterances with slots / numbers,
OTP / phone screens and screens with tappable options use the server's **text path** (`POST /command {transcript, skipTts}`: no audio upload).
The same audio is recorded in parallel (`recordingOptions.persist`, Android 13+ / iOS) and sent to Whisper on 8793 in the background as an
accurate **second check** (never for OTP screens).
- Whisper agrees → nothing changes. Whisper disagrees (score ≥ 0.65) and the preview is still open → re-staged as *"Did you mean: …?"*.
  An auto-act already ran → it stays; the toast offers **Undo** and *"Did you mean …? Yes"*. Never a silent flip.
- **Fallback** to the old record → `POST /command` path, automatically: web, Expo Go / builds without the module, no recognition service,
  speech permission refused, `service-not-allowed` / `language-not-supported` (off for the rest of the session), or two recognizer errors in
  a row. Feature flag: *Use the phone's speech recognizer* (`voice.onDeviceAsr`, default ON on native, OFF on web).

**Intent: keyword first.** The command list lives in firstgo-voice-local (`commands.md`, `src/commands.py`, `confidence.py`,
`normalize.py`) and is exported into the app by `scripts/export_commands.py` → `src/voice/commandCatalog.generated.ts` (do not edit). Known
confusions are synonyms there: TA↔DA, payouts↔layouts, dikhao↔decal, "Hi, I'm"↔"Hi and", Hinglish verbs (dikhao, kholo, batao, chalo).
Bands: score ≥ 0.80 with a 0.08 margin → act; 0.60–0.80 or a near tie → *"Did you mean"*; lower → server text path (LaBSE) → say again.
The server does the same: keyword match first, LaBSE only when unsure, on a warmed worker with a 400 ms budget (`LABSE_BUDGET_MS`), falling
back to a *clarify* with the keyword candidates on timeout.

**Draft transcript.** The preview shows *Did you mean: "Open payouts"?* with a one-tap **Yes** (that tap is the confirm), up to two
alternatives and **Say again**; the heard text has a pencil to correct it and match again. Destructive / money-moving commands (e-sign,
mandate, confirm offer, upload, UPI app, submit/verify) never auto-act and a one-tap pick only stages them — Confirm is still required.

**Act on screen first, speak after.** The app sends `skipTts: true`; navigation happens as soon as the intent is known, then the reply plays:
a **bundled Piper clip** (`assets/voice-replies/*.m4a`, 53 lines, 466 KiB, made by `firstgo-voice-local/scripts/make_reply_clips.py`,
lookup `replyClips.generated.ts`) or Piper `/tts` for dynamic lines (cached on the server by text + voice). Clips can be cut off by the next
press; Piper read-outs still block the mic until they finish.

**No spinner.** The mic disc lights up and a haptic fires in the press handler itself; after release the pill shows the final (or draft) text
with a small *checking* dot, and the mic stays pressable.

**Latency metrics** (`src/voice/voiceMetrics.ts`): press → feedback, release/end-of-speech → text, → action, → reply audio, → Whisper check;
tagged by path (device / server / device+text) and matcher (keyword / fuzzy / labse / server). Last 50 turns, p50/p95 in Profile →
*Voice speed stats*; one `[voice-metrics]` console line per turn in dev builds or with the dev log switch. No transcript is ever stored;
digits in notes are masked. Web harness: `globalThis.__voiceMetrics`. Server: `latencyMs` has `decodeMs`, `asrMs`, `keywordMs`,
`labseMs`, `selectMs`, `ttsMs` per request (also in `logs/requests.jsonl`).

**Native setup.** `app.json` adds the `expo-speech-recognition` plugin (iOS `NSSpeechRecognitionUsageDescription`, Android `RECORD_AUDIO`
+ `<queries>` for `android.speech.RecognitionService`). Needs a new dev build (not in Expo Go — there it falls back to the server path).

**Still needs a real phone:** recognizer latency/accuracy per model, Hinglish quality, offline model availability, real 4G upload time
for the Whisper check. Web has no on-device recognizer, so web measures the server path only.

---

## Earlier behaviour (v1.2.x–v1.3.x, still the fallback path)

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

Press-and-hold records; while listening the button turns solid and shows an elapsed timer (`0:03`). v1.4.0: no spinner —
while the server checks, a small dot shows on the mic and a new press starts a new turn. Labels: "Hold to talk" / "Tap to talk",
"Listening, let go to send", "Checking what you said". Shipped in release builds.

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
| Release | `POST ${EXPO_PUBLIC_STT_URL}/command` `{ audio: <base64>, mimeType: "audio/mp4", sessionId, screen, context: { route }, expect?, skipTts: true }`, 45 s timeout. Recording file is deleted right after reading. (Web reads the blob URL — fixed in v1.4.0.) | checking dot |
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
- Server path has no partial transcripts (the phone recognizer path does, v1.4.0).
- Screen-reader users: use *Tap to talk* (v1.4.0) instead of the hold gesture.
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
