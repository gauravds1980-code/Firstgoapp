# Zippy voice commands

## v1.4.5 S2 — hands-off: ADVANCE, enhance limit, RC number, auto-advance, voice-confirm

Source: `/workspace/handsoff-sweep/FINDINGS.md`, contract `/workspace/v145-notes/CONTRACT.md` "S2 changes".
Pattern everywhere: the button stays visible and works; auto by default; a SPOKEN confirm (voice "yes", no tap) for
payments, final submits and destructive actions; typed values auto-advance 900 ms after the last edit
(`autoAdvance.ts`, AUTO_ADVANCE_MS), a complete valid voice value advances at once; an edit / drag / tap cancels the
countdown; one `isAdvancing` guard per step (AutoAdvancer) so a tap during the countdown never double-navigates;
invalid / below-min / over-cap values never auto-advance.

**ADVANCE** (`voiceStep.ts`): proceed / continue / next / go ahead / move ahead / carry on / aage chaliye / aage
chalie / aage chaliye ji / aage chalo / aage badho / आगे चलिए / आगे बढ़ो / आगे चलो (fillers please / ji / ok /
haan / now) — same grammar as the server's `advance.py`, decided on the phone at once (offline too). Each screen /
sheet registers what advance does with `useVoiceStep({route, sheet, step, cta: {id, label, destructive, enabled,
hint, press, confirmPrompt}, alts, extra})`; it is sent as `context.sheet / step / cta` (+ extras). Plain step →
the CTA's own press (toast "Continuing · Proceed"); destructive step → spoken confirm ("Send request?"; a voice yes,
"submit" or the button presses the CTA that is registered NOW); `enabled:false` → its hint; nothing registered →
"Nothing to continue here." Never Go home / Enhance / Change tenure ("go ahead" used to confirm Go home, "aage
badho" opened Enhance). "don't proceed" / "mat aage badho" → "Okay, staying here." A longer sentence the command
list matched to ADVANCE is "say again". Advance phrases never answer an open Confirm card. PRESS_CONTINUE removed
from DESTRUCTIVE_INTENTS; ADVANCE is not destructive by itself. Catalogue unchanged (server HEAD 47edad8 already
has ADVANCE / SET_RC_NUMBER / SET_DRAWDOWN_AMOUNT).

**Enhance my limit** (TaInfForms `EnhanceSheet`, `fieldResolver.resolveEnhance` = server `enhance.py`): "enhance my
limit" / "limit badhao" / "I need an enhancement of 15 lakhs" / "enhancement of 20 lakh" / "1.5 million" open the
sheet (ENHANCE_TA_LIMIT navigate `filter=enhance` + `amount` / `reason`; the app reads both, `sheetSlotsFor`). Two
steps: AMOUNT (slider + New limit field + a visible **Proceed**) → REASON (chips, docs, **Send request**, Change
amount). While open the sheet registers `enhance-amount` {min = sanctioned + ₹50,000, max = enhanceCap = 2 ×
sanctioned, step ₹50,000, value, current} — never `maxLoan()` — and the reason chips (`kind: 'reason'`). Explicit
phrase → filled at once with Undo (amount + reason + back to the amount step) and advances; bare "20 lakh" → "Set new
limit to ₹20,00,000?"; "15 lakh for more inventory" also picks the chip; "festive season" alone picks the chip;
"15" alone → "Say the full amount, like 15 lakh."; below current → "Must be above your current ₹25,00,000. Set
₹25,50,000?"; over cap → "₹25,00,000 is above the maximum of ₹20,00,000. Set ₹20,00,000?" (no fill, no advance).
Typed: auto-advance 900 ms after the last keystroke only for a valid value ("15" then "1500000" advances once);
a complete-looking invalid value is explained by voice. Voice "proceed" = Proceed (blocked with the reason when
invalid); "send request" / "proceed" on the reason step → "Send the request for a new limit of ₹15,00,000?" — a
spoken yes (or the button) sends it. A pending request → "An enhancement to ₹X is already pending."

**RC number** (RcPendency; `rcParse.ts` = server `rc_reg.parse`, `rcResolve.ts`): the screen sends `context.tab` and
`dealerState` (DealerProfile gains an optional `stateCode`; default MH). With a row's entry sheet open it sends sheet
`rc-entry`, the customer {name, lan}, the `vehicle-reg` field (typed value), `expect: 'reg'` and the Submit CTA.
Plates: "MH12BC1260", "RC number is M H 12 B C 1 2 6 0", "M H twelve B C one two six zero", "em ech twelve bee see
1260", "M for Mumbai H for Hotel 12 B C 1260", "Mike Hotel 12 Bravo Charlie 1260", "double one", "22 BH 1234 AA",
"एम एच 12 बी सी 1260" → shape = the typed `REG_REGEX` core, state code checked against the official list, STT
confusions snapped toward the dealer's state (KH → MH). The field is filled at once (toast "RC number MH 12 BC 1260"
+ Undo) and the app asks "M H twelve B C one two six zero. Submit MH12BC1260 for Vikram Rao?" — a spoken yes
submits; "submit" / "proceed" / "aage chaliye" after a number = the same spoken confirm; Submit stays a button. Bad
code → "X Q is not an Indian state code. Say the RC number again, like M H 12 A B 1234."; digits alone → "Say the
full RC number …" — spaced plate digits are never an OTP (an older server's NUMBER + OTP reading is replaced). A
plate said elsewhere → "RC number M H twelve …?" (Confirm). "I want to update Vikram Rao's RC" / "update Vikram
Rao's RC" open that row (never Start new loan); said on another screen → RcPendency opens the row by name.

**Asset "Confirm & start KYC"** (also "… set up mandate" / "… go to e-sign"): registered as the screen's
destructive CTA (enabled only under the UPI cap; the hint says which tenure fixes it). After a voice loan amount the
app asks "Loan amount ₹1,00,000, EMI ₹4,700 a month. Confirm and start KYC?" — a spoken yes presses the same
button (it stays); "proceed" / "confirm" / "start KYC" / "aage chaliye" ask the same question. Undo of the amount
withdraws the question; leaving the screen withdraws it too.

**TA drawdown** (DisburseSheet, `fieldResolver.resolveDrawdown` = server `drawdown.py`): the amount step registers
`drawdown-amount` {min ₹50,000, max = available, step ₹10,000}. "2 lakh" / "disburse 2 lakh" / "draw 200000" fill it
(toast "Drawdown ₹2,00,000" + Undo) and move on to the confirm step at once; typed / slider / chip values move on 900
ms after the last change when valid; over available → "₹5,00,000 is above your available ₹4,50,000. Set
₹4,50,000?"; a complete-looking invalid typed value is explained. Voice "continue" = Continue (guarded). The confirm
step asks "Disburse ₹2,00,000? Say yes to disburse." — a spoken yes presses "Confirm · disburse ₹X" (stays; Change
amount goes back). **TA repay Pay** (A1, verified): the voice plan asks "Pay ₹80,000 now? Say yes to pay."; the open
repay sheet is now also the voice step (repay-pay, destructive), so "pay" / "haan" / "proceed" there ask the same.

**Auto-send OTP** (SearchMobile "Send consent OTP", DealerLogin "Get OTP"): a valid 10-digit mobile — typed or
spoken (server S2.6 fill + `sendOtp`, or the phone's PHONE fill; DealerLogin now expects 'phone') — sends the OTP 900
ms after the last edit; any edit (or a voice Undo) cancels the countdown; a partial number or the dealer's own
number never sends; one send per number (a tap during the countdown sends once; a failed send re-arms). The buttons
stay; voice "proceed" / "send OTP" press them. Consent / login OTP stays fill-only.

**Cases / Portfolio rows** (`components/CaseDetailSheet.tsx` `useCaseRows`): rows are tappable and open the loan
in a detail sheet (product, amount, disbursed on, POS, DPD, status — there is no separate case screen). The rows
on screen (Portfolio: the selected DPD bucket) are registered as `kind: 'customer'` options with the same matcher
as RcPendency: "open Rahul Sharma" opens the row like a tap (toast + Undo closes it), two rows with one name →
"Priya Kulkarni, Hero Splendor+ or Priya Kulkarni, TVS Jupiter?", unknown → "Sanjay Pawar is not on this list."
Offline, a sure command ("open TA", "open payouts") is never turned into "… is not on this list."

An advance phrase also answers an open spoken question as yes ("Confirm and start KYC?" → "aage chaliye"), like the
server's voice-confirm; "don't proceed" answers no. Tests: `advance`, `enhance`, `rcNumber`, `handsoff` (+ the
AutoAdvancer debounce / cancel / tap-during-countdown cases). Not tried on a device yet.

## v1.4.5 — amounts, loan amount, TA repay, hands-off e-sign OTP, RC rows by name

Server contract: `/workspace/v145-notes/CONTRACT.md` (server branch v145). The phone mirrors each server rule so the
same answer comes back when the tunnel is down (`optionResolver.resolveOnPhone`, the offline reading), and
`guardAnswer` runs on every delivered answer (server, Whisper check, phone).

**Amounts** (`amountParse.ts`, mirror of the server's `amounts.find_amount`): 1 lakh / one lakh / ek lakh / एक लाख,
1.2 lakh = ₹1,20,000, dedh / sava / dhai / saade / paune lakh, 95k, 80 hazaar, 2.5L, 1 lakh 20 thousand,
1,10,000 (comma grouping is always money, never a PIN code). Tenures ("24 months"), model numbers ("Xtreme 125R")
and 10-digit runs are not amounts. An amount phrase never navigates (no START_NEW_LOAN / "Want a loan" / any
journey) unless a start verb was said ("start a new loan of 1 lakh"); "pay …" never suggests Auto pay.

**Fields** (`voiceOptions.setVoiceFields`, sent as `fields`): Asset `loan-amount` {min = product minLoan, max =
maxLoan(), step = loanStep, value, emi, tenure}; TaInf `ta-repay` {utilised}. Route-scoped, cleared on blur.

**Loan amount** (SET_LOAN_AMOUNT, `fieldResolver.resolveLoanAmount`): "loan amount 1 lakh" / "loan 1 lakh" /
"set loan amount to 80000" / "1 lakh ka loan" set the slider at once (toast "Loan amount ₹1,00,000" + Undo);
a bare amount ("one lakh", "95 thousand", "1,10,000") asks "Set loan amount to ₹…?" first; rounded to the step;
over / under the range: "₹2,00,000 is above the limit of ₹1,50,000. Set ₹1,50,000?" (one-tap). Off the vehicle
screen: "You can set the loan amount on the vehicle screen." Never Continue, never a down payment.

**TA repay** (TA_REPAY, `fieldResolver.resolveTaRepay`, `business.planRepay` / `applyRepayAmount`): "pay 80000",
"repay 80k", "pay full", "80 hazaar jama karo", "poora chuka do" → ALWAYS the Confirm card "Repay ₹80,000 on Trade
Advance?" → the repay sheet opens pre-filled with the plan (overdue / oldest first, the last tranche part-paid and
shown) and asks by voice "Pay ₹80,000 now? Say yes to pay." A spoken yes runs the same code as the Pay button (still
there); no / cancel closes. Over utilised → "Repay the full ₹4,50,000?"; nothing utilised → "Nothing to repay.";
"pay" alone → "How much?" (the next turn on TaInf is sent with expect `amount`). "auto pay" is still the mandate.
"enhance my limit" / "limit badhao" opens the Enhance sheet (submit stays a tap).

**Spoken yes / no** (`voiceAsk.ts`, generic, reuse it for any final submit): a screen calls
`askVoiceConfirm({ prompt, onYes, onNo })`; the hook shows + reads the prompt (Piper with spoken replies on, else
the confirm cue) and reads the dealer's next turn first — yes / haan / ok / "yes pay" → onYes, no / nahi / cancel →
onNo, anything else is a normal command. The same yes / no answers a voice Confirm card that was open at press.
`voiceSay(text)` makes the session say a line (OTP retry).

**E-sign OTP — fully hands-off** (requirement change, Gaurav; `otpParse.ts`): Esign is an OTP screen
(`expectFor` = 'otp'): pill / sheet / transcript masked (••••••), no Whisper second check, no parallel stream, no
/log, nothing in the offline queue in clear. Exactly 6 digits in one turn (digits, spaced, words, double / triple,
Hinglish, Devanagari words + numerals, pairs "12 34 56" / "twelve thirty four fifty six"), from the server or the
phone's own parse (offline works) → the boxes are filled and verified at once through the screen's own verify():
no Confirm card, no "Did you mean", no tap; only "OTP entered, verifying" is shown / spoken. Verify fails → the boxes
are cleared and "That OTP didn't work. Say the 6 digits again." Fewer / more digits → "Say all 6 digits or type
them." and nothing is filled. DealerOtp / SearchMobile (OTP stage) keep fill-only (toast + Undo, the dealer taps
Verify) with the same parser and exact-6 rule.

**RC pendency rows** (`customerMatch.ts`, `optionResolver.resolveCustomer`): RcPendency registers its rows as
`kind: 'customer'` options {name, loanNo, vehicle, status, regNo}. "update Vikram Rao", "Vikram Rao RC",
"update Vikram Rau" (fuzzy surname within the same first name), "upload RC for Vikram Rao" open that row exactly like
a tap ("Open Vikram Rao's RC?", Undo closes it; upload / submit stay taps). Two Vikrams → "Vikram Rao or Vikram
Singh?"; "update Sanjay Pawar" → "Sanjay Pawar is not in pending RCs." (v1.4.5 S2: Cases / Portfolio rows are now
tappable and registered too — see the S2 section.)

Tests: `amountParse`, `loanAmount`, `taRepay`, `otpParse`, `rcPendency`, `v145Regression` (every RCA phrase through
the server-answer and offline paths), `services/repayPlan`. The command catalogue is regenerated with
`wt-v145-server/scripts/export_commands.py <app>` from the server's committed tree.

## v1.4.5 — voice routes, retry, offline /log queue

- **Routes** (`src/voice/voiceRoutes.ts`, pure; singleton `voiceRoutes` in `config.ts`). Baked: `EXPO_PUBLIC_STT_URL` (primary)
  then the optional comma-separated `EXPO_PUBLIC_STT_URLS`. Fetched: `GET {route}/routes` →
  `{"version":1,"routes":[url,…],"updatedAt":…}`, asked at app start and whenever a route recovers, from a working route. Validated
  (https only, at most 5, no trailing slash / query), cached (secure storage `firstgo.voice.routes.v1`, used at the next start even
  offline) and merged **fetched first, baked as fallback** — the baked routes are never removed. A changed tunnel URL therefore needs
  no new APK as long as one route still answers. An older server without `/routes` (404 JSON) changes nothing.
- **Every voice URL goes through the current route**: `/command`, `/text`, `/tts`, `/tts/done`, `/log`, `/stream/{id}/…`
  (`commandUrl()` … in `config.ts`, `streamBaseUrl()`). Tutorial videos keep their own `EXPO_PUBLIC_TUTORIAL_BASE_URL` (bundled first,
  not a voice route).
- **Failure = route failure** only for: network error, timeout, HTTP 404 / 502 / 503 / 504, a non-JSON 5xx, or an HTML body (ngrok /
  Cloudflare error page). A 4xx JSON from our server (400, 409 busy, 422, FastAPI's JSON 404) is the server's answer, not the route's.
- **Retry**: small requests retry once on the same route, then the next route. `/text` retries once quickly (on the next route if there
  is one, else the same) before the phone's own reading is used; timeouts are never retried. `/command` and `/stream` never resend the
  audio a second time (the stream keeps its one `/command` fallback): a route failure marks the route down so the **next** turn uses the
  next route. `/tts` network errors count towards switching.
- **Health**: the last route that worked is remembered. A down route is probed with `GET {route}/health` after 1, 2, 4, 8, 16, 30, 30 … s;
  when it answers it is up again and, if it comes earlier in the list (the primary), the app switches back to it.
- **Offline /log queue** (`src/voice/voiceLogQueue.ts`, file `firstgo.voice.logQueue.v1.json` in the document directory). A `/log`
  post that fails on the route is kept (max 200 entries / 1 day, oldest dropped) and resent in order — after the next successful
  `/log`, when a route recovers, and at app start; queued bodies carry `queued: true` and `queuedAgeMs`. An entry the server refuses
  (4xx JSON) is dropped. **Audio is never persisted**. OTP turns are still never posted; if an OTP-flagged body (otp flag, expect=otp,
  Esign / DealerOtp / consent-OTP screen) ever reaches the queue only a masked transcript (••••••) is kept, and every text field has runs
  of 4+ spaced digits or digit words (English / Hindi) masked before it is written. The file is re-sanitised on load.
- **No connection**: when every route is down and the phone is not sure on its own (say again, clarify, a fuzzy "Did you mean"), the
  pill says **"No connection — try again or tap it"** (`/log` reason `no_connection`) instead of a guess. Confident phone results
  (keyword auto-act, an on-screen chip match, a sure money/sign command that needs Confirm anyway) still work as before.
- **Diagnostics**: Profile → *Talking to Zippy* shows the current route and its state (ok / down / no connection, retry in N s,
  route k of n, fetched list).

## v1.4.5 — listening bubble = mic disc (one state)

- **One source of truth** (`src/voice/micFlow.ts`): VoiceHost derives `micView(phase)` once and passes the same `live` flag and the
  same elapsed timer to the mic disc (VoiceMic) and the "Listening…" bubble (`bubbleFor`, which now also shows the m:ss timer). VoiceMic
  no longer has a local "pressed" flag, so a finger on the disc never paints a recording state the session isn't in.
- **Recogniser sessions** (`src/voice/asrSession.ts`, used by `deviceAsr.ts`): one session is open from `start()` until its own `'end'`.
  A new turn first awaits `prepareDeviceAsr()`: the still-open session is aborted (once) and its `'end'` awaited, bounded at 400 ms,
  before the new listeners are registered and `start()` is called. If that `'end'` never came in time it is owed as stale debt: the new
  session swallows an `'end'` / `'aborted'` error / `'audioend'` only until it sees an event of its own (nothing is gated on `'start'`,
  so a permission / language error that preempts it is still delivered). A stale handle's `stop()` / `abort()` never touch a newer session.
- **Self-end while held**: the recogniser ending (or reporting no-speech) while the finger is still down is restarted once, transparently
  (listening and the timer stay on; heard words are finalised instead). A second self-end shows "Didn't catch that — hold and speak
  again" (`/log` reason `asr_ended`). Hands-free end-of-speech with nothing heard is `no_speech`. The 15 s cap now behaves like letting go.
- **Barge-in**: pressing while Zippy (Piper) reads out stops the read-out and listens (metric note `barge-in`); the old
  "Wait until the read-out finishes" refusal is gone.
- **Previous turn on a new press**: logged `cancelled` only when it was really still recording; `superseded` when it was waiting for its
  final after release, `asr_ended` when its recogniser had already ended, nothing when it was already handled.

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
- **Read-back**: the preview plays the Piper WAV from the `/command` response (no second `/tts`). Since v1.4.5 a hold
  during a Piper read-out stops it and listens (barge-in); playback end or stop posts `/tts/done`. HTTP 409 shows
  "Still speaking. Wait until the read-out finishes…".
- **Preview**: `clarify` → "Did you mean…?" with two candidate buttons; `retry` → "Sorry, say that again." with examples;
  `reprompt` → field error + "Type it instead" (prominent when `offerKeyboard` or `repromptCount >= 2`); a digit-only
  utterance → "Use this number / amount / OTP". OTP rows are always masked; typed OTPs use a secure input.
- **Fill**: Confirm writes PHONE → `mobileNumber`, AMOUNT → `downPayment`, OTP → `otp` into `voiceDraft`. SearchMobile fills the
  mobile field; SearchMobile (OTP stage) and DealerOtp fill the OTP boxes. Nothing is auto-submitted.
- **Streaming**: `EXPO_PUBLIC_VOICE_STREAMING=1` (default off) enables the HTTP chunked client (`/stream/{id}/start|chunk|end`),
  but the server's chunks must be raw s16le PCM and expo-audio records AAC, so today every clip still goes through
  whole-clip `/command`. No WebSockets (the Expo tunnel strips Upgrade).
