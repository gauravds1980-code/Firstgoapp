# FIRSTgo v1.2.2 — dealer tap counts (KFS step removed)

Counted from the actual screens in `src/screens/*` at 89a03ae (before) and the v1.2.2 working tree (after).

**Rules used**
- A *tap* is a deliberate dealer button press that is required to move the loan forward.
- Typing (customer mobile, OTP digits) is data entry, not a tap. Both OTP screens auto-submit at the 6th digit, so their Verify buttons are not needed.
- Auto-advances are not taps: Face KYC success → Mandate (900 ms), mandate created → next step (1.1 s), waiver animations (`WaiverMotion` → `onDone`), e-sign OTP verified → Docs, 3rd document uploaded → disbursal requested → Disbursal screen.
- Optional taps are excluded: picking a different vehicle (the first catalogue model is preselected), changing tenure, dragging the slider, and switching product on a multi-brand dealer.
- The **Home** entry tap ("Search by Mobile Number") is shown on its own line, so the counts can be compared with or without it.

## (a) Normal search path — customer with no waivers (e.g. 99123 45677)

| # | Screen | Before (v1.2.1) | After (v1.2.2) |
|---|--------|-----------------|----------------|
| 0 | Home | "Search by Mobile Number" | "Search by Mobile Number" |
| 1 | Search · enter | "Proceed to check offers" | "Send consent OTP" |
| – | Search · OTP | auto-submit at 6th digit → Asset | auto-submit at 6th digit → Asset |
| 2 | Asset (offer + vehicle + EMI) | "Verify and Continue" | "Confirm & start KYC" |
| 3 | Face KYC | "Customer consents · start face capture" | "Start face capture" |
| – | Face KYC | auto-advance → Mandate | auto-advance → Mandate |
| 4 | Mandate | "Send UPI AutoPay request" | "Send UPI AutoPay request" |
| – | Mandate | auto-advance → **KFS** | auto-advance → **E-sign** |
| 5 | KFS (dealer screen) | "KFS explained · send e-sign OTP" | — *screen removed; KFS goes to the customer with the e-sign link* |
| – | E-sign | OTP auto-submit → Docs | OTP auto-submit → Docs |
| 6–8 | Docs | Upload invoice, insurance, delivery photo (3) | Upload invoice, insurance, delivery photo (3) |
| – | Docs | 3rd upload → disbursal requested → Disbursal | same |

| Count | Before | After |
|-------|--------|-------|
| From the Search screen (excl. Home entry tap) | **8** | **7** |
| Including the Home entry tap | 9 | 8 |
| Excluding the 3 document uploads (from Search) | 5 | 4 |

## (b) Fully waived customer — mobile ending 7777 (KYC + mandate on file)

| # | Screen | Before (v1.2.1) | After (v1.2.2) |
|---|--------|-----------------|----------------|
| 0 | Home | "Search by Mobile Number" | "Search by Mobile Number" |
| 1 | Search · enter | "Proceed to check offers" | "Send consent OTP" |
| – | Search · OTP | auto-submit → Asset | auto-submit → Asset |
| 2 | Asset | "Verify and Continue" | "Confirm & start KYC" |
| – | Face KYC (combined KYC + mandate waiver beat) | auto-advance → **KFS** (mandate skipped) | auto-advance → **E-sign** (mandate skipped) |
| 3 | KFS | "KFS explained · send e-sign OTP" | — *removed* |
| – | E-sign | OTP auto-submit → Docs | OTP auto-submit → Docs |
| 4–6 | Docs | 3 uploads | 3 uploads |

| Count | Before | After |
|-------|--------|-------|
| From the Search screen (excl. Home entry tap) | **7** | **6** |
| Including the Home entry tap | 8 | 7 |
| Excluding the 3 document uploads (from Search) | 4 | 3 |

## Check against the prior estimate

- **Waived 7777 — prior "~6 → 5 (search + asset + 3 doc uploads)".** The *after* path does match "search + asset + 3 uploads", but the search step needs two taps (Home "Search by Mobile Number" + "Send consent OTP"). If "search" means just the Search screen tap (Home entry not counted), the real count is **7 → 6**; with the Home entry tap it is 8 → 7. Either way the saving is the **one** KFS tap.
- **Normal — prior "~7 → 6".** That is one lower than the actual count. From the Search screen it is **8 → 7**: Send OTP, Asset, Face capture, UPI request, (KFS), and 3 uploads. With the Home entry tap it is 9 → 8. The saving is again **−1 tap**.
- QR path (for reference): "Scan QR" on Home with an auto-scan replaces both search taps (the Home tap and "Send consent OTP"). Including the Scan QR tap, QR normal goes **8 → 7** (Scan, Asset, Face capture, UPI request, [KFS], 3 uploads) and QR waived goes **6 → 5** (Scan, Asset, [KFS], 3 uploads).

The waived path now goes Asset → (KYC + mandate waiver beat, no tap) → E-sign, with mandate still skipped. The E-sign screen shows the chip "KFS sent to customer on +91 XXXXX X7777 · awaiting consent".
