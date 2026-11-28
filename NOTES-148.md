# FIRSTgo v1.4.8 — Feature 3: Payout statement with short-pay checks (versionCode 25)

Spec: `/workspace/dealer-research/designs/03-payout-statement.md` (approved 28 Nov 2026) + Gaurav's four answers +
design library `00-design-library.md`. Built on v1.4.6 Money in flight and v1.4.7 alerts. Mock data only (demo "today"
24 Nov 2026). No installs, no native modules, no eas.

## Gaurav's answers, as built
1. **₹100 threshold** — `isShortPay(expected, paid)` = posted payment and `expected − paid >= 100` (`SHORT_PAY_MIN`).
   ₹99 is matched with a "₹99 rounding" caption; ₹100 is Short paid. Tested at ₹99 / ₹100.
2. **Default period = This month** — `services/period.ts` `DEFAULT_PRESET`; the shared date store starts there.
3. **Deductions are itemised, not short-pay** — lines carry `gross`, `deductions[]` and net `payout` (= expected).
   1111 CR-20354 (Kavya Nair): gross ₹8,400 − advance recovery ₹4,200 = expected ₹4,200, paid ₹4,200 → reconciles.
   The one real 1111 short-pay is **October, INV/26-27/1176 · CR-20320 Arjun Mehta, expected ₹5,100, paid ₹3,950,
   ₹1,150, Scheme cap** (payment posted 24 Nov). The v1.4.7 1111 short-pay alert is now this line (was ₹2,150
   CR-184133); tapping it opens Payouts on Last month with the CR-20320 line sheet.
4. **PAY- queue** — `services/queries.ts`: Money in flight stays `QRY-<LAN digits>-1` (RM desk); payout lines go to
   Payout operations, `PAY-<last 4 LAN digits>` (e.g. PAY-0320). `QuerySheet` gained `queue` (copy + voice prompt);
   reasons Short paid / Not received / Wrong rate / Deduction query / Other; Confirm before send; mock submit; toast;
   one open query per line.
- PDF: "Download PDF statement" button is shown **disabled** with the caption "PDF statement coming soon."

## What shipped
- `src/services/payoutStatement.ts` (pure, tested): explicit Nov + Oct statement per login (expected / paid /
  deductions / reason are fields, never loan × rate), older months generated + renumbered (INV/26-27/1150 down; Paid
  after 60 days, else Claimed); line / invoice figures, Short paid / 30+ days rules, filters, period summary + hero,
  Home card, spoken lines, query preselect.
- `src/services/period.ts` (pure): presets incl. **Last 3 months**, `rangeContaining`, labels. `state/stores.ts`
  re-exports it; `DateFilterBar` gained the Last 3 months chip (also on Portfolio / Cases — shared filter).
- Library: `StatementSummaryCard`, `PayoutLineRow` (+ `statementTone` aliases in `theme/library.ts`, no new hex).
- `PayoutsScreen` = commission statement: period bar, chips All · Short paid · Ready to claim · 30+ days · Paid
  (counts), summary card, disabled PDF, invoice cards with PayoutLineRows, Claim now, monthly chart and Advance payout
  (kept), line sheet (loan, rate, gross, itemised deductions, expected, paid, difference / rounding, reason, invoice,
  status, paid on, UTR copy) and QuerySheet. Deep links: `invoice` (+ `lan` → line sheet), `period`, `month`,
  `filter`, `query`.
- Home Payouts card: statement seed; danger caption with the latest short-pay (1111: "₹1,150 difference found · Oct
  statement", opens the line).
- Alerts: commission rows are built from the statement (1111 ready to claim is now INV/26-27/1196 ₹21,750; short-pay
  as above; Hero keeps its read ₹600 short-pay, now a statement line TW-184133 "Rate difference").
- Voice: `src/voice/payoutVoice.ts` + `useVoiceCommand` intercept (before alerts / MIF), server catalogue + regenerated
  client catalogue. See VOICE.md.

## Demo logins
| Login | This month (Nov) | Last month (Oct) |
|---|---|---|
| 1111 Shree Auto Mall | ₹21,750 ready to claim (INV/1196, 5 files incl. new TW) · Expected ₹32,775 · Paid ₹11,025 · Diff ₹0 · ₹4,200 advance recovery itemised (CR-20354) | ₹1,150 difference on 1 file (CR-20320, scheme cap) · Expected ₹19,200 · Paid ₹9,650 · INV/1162 Claimed 43 days (30+ days, ₹8,400) |
| 2222 Sai Motors | ₹13,200 ready (INV/1197) · Exp ₹34,650 · Paid ₹21,450 (INV/1194) | All caught up · Exp ₹19,575 · Paid ₹19,535 · ₹40 TDS rounding (not flagged) |
| 3333 Tata CV Hub | ₹8,760 ready (INV/1195) · Exp ₹31,680 · Paid ₹22,920 (INV/1194) | ₹5,640 claimed, awaiting payment (INV/1158, 30+ days) · Exp ₹12,930 · Paid ₹7,290 · ₹1,230 clawback itemised |
| default Hero (new TW) | ₹4,410 ready (INV/1199) + ₹600 difference on 1 file (TW-184133) · Exp ₹13,050 · Paid ₹8,040 | All caught up · Exp ₹4,665 · Paid ₹4,620 · ₹45 rounding |
| 0000 / 9999 | unchanged (no session) | |
