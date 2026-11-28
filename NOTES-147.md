# FIRSTgo v1.4.7 — Feature 2: Credit and payout alerts (versionCode 24)

Spec: `/workspace/dealer-research/designs/02-credit-payout-alerts.md` (approved 28 Nov 2026) + Gaurav's four answers +
design library `00-design-library.md`. Built on v1.4.6 Money in flight. Mock data only (demo "today" 24 Nov 2026, 11:26).
In-app only: no expo-notifications, no push token, no native module, no installs.

## What shipped
- **Logic** `src/services/alerts.ts` (pure, tested): 7 transactional types (`loan.credited / disbursalInitiated /
  blocker / overdue`, `payout.paid / readyToClaim / shortPaid`), tones, inbox titles, lock-screen copy (first name + LAN
  / invoice), Hinglish readout sentences, deep-link targets.
  - **Quiet hours** (default 9:00 PM – 8:00 AM, IST computed from the instant, never the phone's timezone): `inQuietHours`
    (start inclusive, end exclusive), `pushReleaseAt` (held → 8:00 AM IST), `planPush`, `batchPushes` (a night's burst =
    one "N updates waiting" push), `readoutAllowed`. **No breakthrough** for any type. The inbox row is added at once and
    marked "Push held until 8:00 AM"; the automatic Zippy nudge / Piper readout does not fire in the window.
  - **Dedupe**: event id = `type:subject:IST day`; a refresh / replay never adds a second row.
  - **Segment gating**: loan types only with `isMoneyInFlightEnabled`; never for a new-TW file. Hero (new TW only) gets
    commission alerts only.
  - **Short-pay** (`payout.shortPaid`, "difference found"): expected = the Payouts invoice line, paid = expected − short.
  - **Prefs + consent**: per-type switches (default on), push, quiet window, promotional consent = checkbox + ISO timestamp;
    withdraw records the time, locks and turns all promo switches off. `canSendPromotional` is always false.
- **Stores** (`state/stores.ts`): `alertsStore` (read marks + arrived rows) and `alertPrefsStore`, **keyed by dealer id**
  (one shared inbox per dealership), persisted to secureStorage, hydrated in `hydrateDealerStores`. `state/useAlerts.ts`.
- **Library**: `PreferenceSwitch`, `ConsentCheckbox`, `BellBadge` (new); `AlertCard` gained `variant="row"` (inbox row:
  white, tinted icon well, unread dot) and `note`; aliases `preferenceTone` / `inboxTone` in `theme/library.ts`.
  `JourneyScreen` / `BrandHeader` gained one `headerAction` slot (the inbox gear). No new hex.
- **Screens**: `Alerts` (`boom://alerts`): Mark all as read, chips All / Loan money / Payouts with unread counts (no Loan
  money chip for gated dealers), Today / Earlier, tap → mark read + Money in flight sheet (overdue → Overdue filter) or
  Payouts invoice; demo card (dev UI) "Arrives now / Arrives tonight (11:30 PM)". `AlertSettings`
  (`boom://alerts/settings`): info Banner "Live push needs a development build. The inbox still works.", push, quiet
  hours + hour-chip Sheet, transactional block, promotional block (locked until consent).
- **Home**: bell = live unread count (was a static 2), opens the inbox; Zippy nudge "N new alerts" (not in quiet hours).
- **Profile** → Notification settings opens `AlertSettings` (was ComingSoon).
- **Payouts**: `invoice` / `lan` params expand that invoice (date range moved to include it, filter All); short-paid line
  shows Expected / Paid, "₹X difference found", `Pill` Short paid, plus a Banner when opened from the alert.
- **Voice**: SHOW_ALERTS / READ_ALERTS / OPEN_ALERT_SETTINGS (see VOICE.md), on the phone + server catalogue; catalogue
  regenerated with `export_commands.py`; 3 new bundled Piper clips (only the new ones copied, old clips untouched).

## Demo logins (unread = Home bell)
| Login | Unread | Rows |
|---|---|---|
| 1111 Shree Auto Mall | 3 (Loan 1, Payouts 2) | Today: Rahul ₹1,35,000 credited (TW-184392, used, read), Vikram ₹66,500 (TW-184388, read), **Neha ₹6,62,000 CR-20409**, **₹13,995 payout ready INV/26-27/1199**, **₹2,150 difference found INV/26-27/1192 · CR-184133** (expected ₹8,325, paid ₹6,175), Amit's file overdue, PDD hold CR-20417 (6:30 AM → push held till 8:00). Earlier: Bank a/c mismatch on Rohan's file (yesterday 6:02 PM), Pooja's file overdue, RC copy pending TW-184408 (22 Nov), ₹5,46,000 disbursal started for Rohan (21 Nov) |
| 2222 Sai Motors | 1 | **Meera ₹5,72,000 credited CR-20418**; Arjun's file overdue, PDD hold CR-20430 (23 Nov); ₹21,450 commission credited INV/26-27/1194 (read) |
| 3333 Tata CV Hub | 2 | **Manoj ₹5,12,000 credited CV-30218**; ₹22,920 commission credited INV/26-27/1194 (yesterday, read); **Ritu's file overdue, Insurance pending CV-30222** (21 Nov) |
| default Hero (new TW) | 1 | **₹4,410 payout ready INV/26-27/1199**; ₹600 difference found INV/26-27/1192 · TW-184133 (read); ₹5,640 commission credited INV/26-27/1194 (read). No loan alerts |
| 0000 / 9999 | — | unchanged (no session) |
