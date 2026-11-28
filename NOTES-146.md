# FIRSTgo v1.4.6 — Feature 1: Money in flight (versionCode 23)

Spec: `/workspace/dealer-research/designs/01-money-in-flight.md` (approved 28 Nov 2026) + design library
`00-design-library.md`. Mock data only (demo "today" 24 Nov 2026, clock 11:26).

## What shipped
- **Design library**: `src/theme/library.ts` (semantic aliases over `tokens.ts`; pure tone names in `libraryTones.ts`),
  `src/components/library/` — StageChip, AgeingPill, BlockerCaption, Timeline, SearchBar, HomeSummaryCard, InFlightRow,
  AlertCard, QuerySheet. The info-pill hex pair moved into tokens (`colors.info` / `infoSoft`); `Pill` gained a `cta`
  tone; `Field` gained `hideLabel` / `leading`; Phosphor `moneyInFlight` glyph. No new colours.
- **Logic** `src/services/moneyInFlight.ts` (pure, tested): stages, closed blocker list with owners, ageing = calendar
  days in the current stage (0–1 On time, 2–3 Ageing, 4+ Overdue, every product), credited files kept 3 days (credit
  day = day 1), totals, filters (All / Sanctioned / Docs pending / Disbursal initiated / Credited / Overdue / Stuck),
  search (name, first / last, 10-digit mobile, last 4), sheet CTAs, alerts, spoken lines.
- **Segment gating** `isMoneyInFlightEnabled(profile)` = any segment other than NEW_TW (`DealerProfile.segments`,
  backfilled for saved sessions). Gates the Home card, the route (polite not-available state on deep link / voice),
  voice replies, Zippy / AlertCard events. Gated dealers keep the old Home Payouts loan-credit block.
- **Home**: Money in flight card after Today, before Loans (in flight, files, overdue, stuck, credited today, latest
  credit AlertCard, two urgent rows). For enabled dealers the Payouts tile / block (and `list/payouts`) are commission
  only.
- **MoneyInFlight** route (`boom://money`): stats, Updated-ago stamp, pull to refresh (+ demo failed-refresh switch →
  stale banner + Retry), SearchBar, chips with counts, rows → case sheet (amounts, expected net, ••4321, masked mobile,
  stage banner, blocker + what you can do, Timeline, UTR copy, short-credit warning). Primary CTA: Upload RC copy (mock
  upload → "RC copy under review"), Remind customer, View settlement account, else Raise a query. QuerySheet: reason
  (Amount not received / Short credit / Stuck at stage / Wrong account / Other) + note → **explicit Confirm step** →
  mock ticket `QRY-<lan>-1` (toast + banner); a second query on the file is refused.
- **Voice**: SHOW_MONEY_IN_FLIGHT, SHOW_STUCK_FILES, SHOW_TODAYS_CREDITS, SHOW_FILE_MONEY_STATUS, RAISE_QUERY (see
  VOICE.md). Decided on the phone (`src/voice/moneyVoice.ts`) — no server restart needed; also in the server catalogue.

## Demo logins
| Login | Feature | In flight | Notes |
|---|---|---|---|
| 1111 Shree Auto Mall | shown | ₹22.9L · 5 files · 2 overdue · ₹8.6L credited today (3) | used TW + new/used car only; Ramesh Jadhav file; 4-day-old credit dropped |
| 2222 Sai Motors (Maruti) | shown | ₹18.2L · 3 · 1 overdue · ₹5.7L today | Suresh RC copy pending (Upload RC); Divya 2-day-old short credit |
| 3333 Tata CV Hub | shown | ₹46.9L · 5 · 2 overdue · ₹5.1L today | Suresh used Ace RC copy pending; Anita credited yesterday |
| default (Hero, new TW) | hidden | — | old Payouts block; voice: "Money in flight is not available for new two-wheeler dealers yet." |
| 0000 / 9999 | unchanged | — | not a dealer / network error |
