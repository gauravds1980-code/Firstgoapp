/** Shared dispersed-cue test sentences (same list as firstgo-voice-local/tests/cue_sentences.json). */
export type CueCase = { t: string; e: string; w: 'auto' | 'confirm' | 'clarify' | 'not_auto' | 'any'; route?: string; asset?: string | null; ambig?: string[] };
export const CUE_CASES: CueCase[] = [
 {
  "t": "let's start a QR journey on the device",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "can you please start for me the new customer QR wala journey",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "QR se journey start karo",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "QR को चलाओ",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "क्यूआर चालू करो",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "कयूआर चालू करो",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "QR शुरू करो",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "bhai jaldi se customer ke liye QR wali journey chalu kar do",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "okay so now I want you to open the QR thing for this customer",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "please scan the customer's QR code and start the journey",
  "e": "START_QR_JOURNEY",
  "w": "auto"
 },
 {
  "t": "start QR journey for Xtreme 125R",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Payouts"
 },
 {
  "t": "QR journey shuru karo",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Payouts"
 },
 {
  "t": "क्यूआर चालू करो",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Portfolio"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Cases"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "TaInf"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Home"
 },
 {
  "t": "start QR",
  "e": "START_QR_JOURNEY",
  "w": "auto",
  "route": "Asset"
 },
 {
  "t": "can you show me all of my payouts for this month",
  "e": "OPEN_PAYOUTS",
  "w": "auto"
 },
 {
  "t": "payout दिखाओ is month ka",
  "e": "OPEN_PAYOUTS",
  "w": "auto"
 },
 {
  "t": "पेआउट खोलो",
  "e": "OPEN_PAYOUTS",
  "w": "auto"
 },
 {
  "t": "mere saare cases ek baar dikhao",
  "e": "OPEN_CASES",
  "w": "auto"
 },
 {
  "t": "केस दिखाओ",
  "e": "OPEN_CASES",
  "w": "auto"
 },
 {
  "t": "मेरे केसेस दिखाओ",
  "e": "OPEN_CASES",
  "w": "auto"
 },
 {
  "t": "please open the trade advance screen for me",
  "e": "OPEN_TA_INF",
  "w": "auto"
 },
 {
  "t": "TA wala screen kholo bhai",
  "e": "OPEN_TA_INF",
  "w": "auto"
 },
 {
  "t": "पोर्टफोलियो खोलो",
  "e": "OPEN_PORTFOLIO",
  "w": "auto"
 },
 {
  "t": "portfolio batao",
  "e": "OPEN_PORTFOLIO",
  "w": "auto"
 },
 {
  "t": "could you open up my whole portfolio page",
  "e": "OPEN_PORTFOLIO",
  "w": "auto"
 },
 {
  "t": "can you open the help videos for me",
  "e": "OPEN_HELP",
  "w": "auto"
 },
 {
  "t": "show me the cases where disbursal is still pending",
  "e": "SHOW_PENDING_DISBURSALS",
  "w": "auto"
 },
 {
  "t": "jo disbursal pending hai woh sab dikhao",
  "e": "SHOW_PENDING_DISBURSALS",
  "w": "auto"
 },
 {
  "t": "which cases are overdue right now, show them to me",
  "e": "SHOW_OVERDUE_CASES",
  "w": "auto"
 },
 {
  "t": "ओवरड्यू केस दिखाओ",
  "e": "SHOW_OVERDUE_CASES",
  "w": "auto"
 },
 {
  "t": "I want to start the mobile number journey for this customer",
  "e": "START_MOBILE_JOURNEY",
  "w": "auto"
 },
 {
  "t": "customer ke liye naya loan shuru karo",
  "e": "LOAN",
  "w": "auto"
 },
 {
  "t": "customer ka KYC shuru karo",
  "e": "START_KYC",
  "w": "auto"
 },
 {
  "t": "please start the face KYC for this customer",
  "e": "START_FACE_KYC",
  "w": "auto"
 },
 {
  "t": "aadhaar card scan karna hai customer ka",
  "e": "SCAN_AADHAAR",
  "w": "auto"
 },
 {
  "t": "customer ka PAN card scan kar do",
  "e": "SCAN_PAN",
  "w": "auto"
 },
 {
  "t": "EMI kitna hoga dikhao",
  "e": "SHOW_EMI",
  "w": "auto"
 },
 {
  "t": "go ahead and start the e-sign for the customer",
  "e": "START_ESIGN",
  "w": "confirm"
 },
 {
  "t": "customer ka UPI mandate set up kar do",
  "e": "SETUP_UPI_MANDATE",
  "w": "confirm"
 },
 {
  "t": "RC upload karna hai is case ka",
  "e": "UPLOAD_RC",
  "w": "confirm"
 },
 {
  "t": "okay confirm the offer for this customer",
  "e": "CONFIRM_OFFER",
  "w": "confirm"
 },
 {
  "t": "What is a QR code?",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "QR kya hota hai",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "QR code ka matlab kya hai",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "क्यूआर कोड क्या है",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "what is the QR journey",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "how do I start a QR journey?",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "don't start QR",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "QR mat chalao",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "QR journey start mat karo",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "abhi QR nahi",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "do not open payouts",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "QR मत चलाओ",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "नहीं",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "start the car engine",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "the shop opens at ten",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "my bike won't start",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "open the window please",
  "e": "-",
  "w": "not_auto"
 },
 {
  "t": "Xtreme 125R ka loan karna hai",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "new loan for extreme 125 R",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "new loan for xtreme one twenty five R",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "एक्सट्रीम 125R का लोन करना है",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "एक्सट्रीम वन ट्वेंटी फाइव आर के लिए लोन चाहिए",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-xtreme"
 },
 {
  "t": "splender plus ka loan chahiye",
  "e": "LOAN",
  "w": "auto",
  "asset": "hero-splendor"
 },
 {
  "t": "start QR journey for Xtreme",
  "e": "START_QR_JOURNEY",
  "w": "clarify",
  "ambig": [
   "hero-xtreme",
   "hero-xtreme-160r"
  ]
 },
 {
  "t": "Apache ka loan chahiye",
  "e": "LOAN",
  "w": "clarify",
  "ambig": [
   "tvs-apache",
   "tvs-apache-200"
  ]
 },
 {
  "t": "loan for a Hayabusa",
  "e": "LOAN",
  "w": "any",
  "asset": null
 }
];
