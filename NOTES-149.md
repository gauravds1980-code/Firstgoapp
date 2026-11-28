# FIRSTgo v1.4.9 — Feature 5: Hinglish voice status checks (versionCode 26)

Spec: `/workspace/dealer-research/designs/05-hinglish-voice-status.md` (approved by Gaurav) + mockups
`05-hinglish-voice-clarify.png` / `05-hinglish-voice-answer.png` + design library `00-design-library.md`. Built on
v1.4.6 Money in flight, v1.4.7 alerts and v1.4.8 payout statement. Mock data only (demo "today" Tue 24 Nov 2026, 11:26).
No installs, no native modules, no eas.

## Gaurav's answers, as built
1. **Always speak status answers with Piper.** `voiceCues.replyModeFor('status', …)` is always `'speech'`;
   `piper.speakStatusAnswer()` is the one path that skips the "Spoken replies" flag (bundled clip, else local `/tts`;
   never Google TTS / expo-speech). Used for: file status, counts, commission / invoices, and Money-in-flight questions
   (summary / stuck / today / file / gated line / hybrid line). A Money-in-flight *query* request, alerts, payout
   statement and every other command keep the old flag (cue sounds by default). The VoiceAnswerCard still shows the
   answer on screen.
2. **Counts are speak-only and stay on the current screen** ("aaj kitne approve hue", "aaj kitne apply hue",
   "aaj kitna disburse hua"): a VoiceAnswerCard under the header, no navigation. TodayStatusSheet was therefore not built.
3. **No Google STT notice.** Nothing added; Google STT stays fallback-only (unchanged code path), Google TTS never used.
4. **New-TW file at a mixed dealer** (spec recommendation): a named money question Money in flight cannot answer opens
   that file's status sheet with the short line ("Priya Kulkarni new two-wheeler hai, money in flight isme nahi dikhta.
   Abhi e-sign pending hai."). v1.4.6 segment gating kept: default Hero (new TW only) gets the polite unavailable line for
   every money question (warning VoiceAnswerCard, nothing opens); status, counts and commission work.

## What shipped
- `src/services/loanStatus.ts` (pure): one list of the dealer's files = visible Money-in-flight files (journey KYC →
  Offer → Sanctioned → e-Sign → Mandate → MIF stages) + a mock applications list (new TW at any stage, not-yet-sanctioned
  applications, Ramesh Kale's older new-TW case); today's applied / approved / disbursed; Hinglish spoken lines;
  commission status (latest Not-claimed → Claimed → Paid invoice, +2 working days); invoices to claim; mobile masking.
- `src/voice/statusVoice.ts` (pure): parser (Hinglish, English, transliterated Devanagari), server-intent mapping,
  answers, hybrid money answer, ClarifySheet choice (vehicle / LAN tail / full name or surname / "pehla, dusra"),
  `statusUi` store, live context.
- `useVoiceCommand.ts`: ClarifySheet choice and status parse in `handleText` / `onDeviceFinal` / `deliver` (after OTP and
  ADVANCE, after payout + alerts, before Money in flight); hybrid line in the MIF branch; gated MIF line as a card;
  Whisper reconcile keeps a phone status answer when Whisper also heard a status question.
- Library: `VoiceAnswerCard`, `ClarifySheet`, `FileStatusSheet` (+ `answerTone` aliases, no new hex). `Sheet` gained
  `inline` (absolute overlay instead of a Modal) so the voice mic stays on top of the voice sheets.
- `src/voice/StatusVoiceLayer.tsx` (mounted by VoiceHost): card / clarify / file sheet; registers the ADVANCE step
  (Clarify: disabled "Choose a file" → "Pehle file choose karo."; file sheet: Remind customer, else Close); Android back
  closes; a route change closes it (not the card shown with a commission navigation).
- Home: Today tiles (Applied · Approved · Disbursed) and the Loans preview now come from the same list, so a spoken
  count always equals the tile.
- "What can I say" read-out adds the status examples.

## Demo logins (24 Nov 2026)
| Login | Today (Applied · Approved · Disbursed) | Status examples |
|---|---|---|
| 1111 Shree Auto Mall | 3 · 3 · ₹8.6L (₹8,63,500: Neha, Vikram, Rahul) | "Ramesh ka loan kahan tak pahuncha" → Which one? Ramesh Jadhav (used Swift CR-20424, approved today, e-Sign pending, in MIF) / Ramesh Kale (Activa TW-184210, disbursed 12 Oct). "Priya ka paisa aaya?" → Priya's new-TW sheet + hybrid line. "Pooja ka paisa aaya?" → MIF sheet (used Pulsar). "mera commission kab aayega" → Payouts INV/26-27/1196 ₹21,750, "Thursday tak". |
| 2222 Sai Motors | 1 · 0 · ₹5.7L (Meera) | Nikhil Joshi (Brezza, offer pending) — money question → "abhi sanction nahi hua" line. |
| 3333 Tata CV Hub | 1 · 0 · ₹5.1L (Manoj) | Prakash Shinde (Intra V30, KYC pending). |
| default Hero (new TW only) | 3 · 2 · ₹69.2K (Ganesh) | Rakesh More / Swati Kadam approved today; money questions → polite unavailable line; commission → INV/26-27/1199. |
| 0000 / 9999 | unchanged (no session) | |

## Deviations
- Spec data re-based on the v1.4.6 files: 1111's "Ramesh Jadhav" is the existing used-Swift MIF file (approved today,
  e-Sign pending), not a new-TW Splendor; Pooja Iyer is used (MIF), so her money question stays feature 1. The new-TW
  files at 1111 are Priya Kulkarni (TW-184401), Sneha Joshi (TW-184412) and Ramesh Kale (TW-184210). "aaj kitna disburse
  hua" equals "aaj kitna credit hua" at 1111 (all three of today's credits are in Money in flight after the re-base).
- Home Today tiles changed (the old static list gave 1111 6 · 5 · ₹9.9L). 2222 and 3333 now show 0 approved today: every
  sanctioned in-scope file is a Money-in-flight file and none was sanctioned today there; adding one would change
  feature-1 counts. The QuickList "Loans" (View all) is still the old static list.
- TodayStatusSheet not built (Gaurav #2). Help → "What can I say" chip group not built; the spoken "what can I say"
  answer lists the status examples instead.
- Amounts are spoken with the existing `spokenAmount` ("8.63 lakh", "21 thousand 750 rupees"), counts in Hindi
  ("teen files"); invoice numbers are spoken as the last part ("invoice 1196").
- Remind customer is a mock (button turns "Reminder sent"); no SMS.
- Server: `normalize.similarity` / `token_similarity` LRU caches raised 65536 → 262144. The 25 new phrases pushed the
  cue-sentence benchmark past the cache size (LRU thrash: 18 ms vs 2 ms per utterance, `test_keyword_path_stays_fast`).
