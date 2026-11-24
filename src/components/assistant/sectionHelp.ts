import type { AssistantContext } from '../../navigation/types';

export type Faq = { q: string; a: string };

/**
 * Section-level help (v1.2.2). Keyed by assistant context, then by the section id a screen reports
 * through useSectionTracker. The sheet shows these first, then the screen-wide FAQs.
 */
export const SECTION_HELP: Partial<Record<AssistantContext, Record<string, { label: string; faqs: Faq[] }>>> = {
  home: {
    start: { label: 'starting a loan', faqs: [
      { q: 'Scan QR or search?', a: 'Scan QR is fastest — one scan opens the offer. Search by mobile when the customer has no QR; they get a consent OTP.' },
      { q: 'Why can’t I switch product?', a: 'You only see the products your dealership is onboarded for. Ask your relationship manager to enable more.' },
    ] },
    today: { label: 'today’s numbers', faqs: [{ q: 'When do these update?', a: 'Pull down on Home to refresh. Disbursed counts loans credited to your account today.' }] },
    loans: { label: 'recent loans', faqs: [{ q: 'A loan shows Pending', a: 'Pending usually means the customer hasn’t e-signed yet. Open View all for the step it is waiting on.' }] },
    actions: { label: 'actions', faqs: [{ q: 'What do the badges mean?', a: 'They count items waiting on you — invoices to claim and RCs to share.' }] },
    payouts: { label: 'payouts', faqs: [{ q: 'Where is today’s money?', a: 'Credited to your settlement account. Each row has the UTR to trace it with your bank.' }] },
  },
  search: {
    mobile: { label: 'customer mobile', faqs: [{ q: 'Which number do I enter?', a: 'The customer’s own bank-registered mobile — never your dealer login number.' }] },
    otp: { label: 'consent OTP', faqs: [{ q: 'OTP not arriving', a: 'Wait for the 30s timer, then Resend. Check the number is the one registered with the bank.' }] },
  },
  asset: {
    vehicle: { label: 'vehicle', faqs: [
      { q: 'Model not in the list', a: 'The list shows models your dealership sells. Pick the closest variant — the on-road price can be corrected by your RM.' },
      { q: 'Why did the amount change?', a: 'Changing the vehicle resets the loan to the new maximum: the lower of the offer and LTV × on-road price.' },
    ] },
    emi: { label: 'EMI & tenure', faqs: [
      { q: 'EMI is above ₹15,000', a: 'UPI AutoPay is capped at ₹15,000. Pick a longer tenure or lower the amount. Debit card / net banking mandates are coming soon.' },
      { q: 'Why is the slider capped?', a: 'Loan max = lower of the pre-qualified offer and LTV % × on-road price.' },
    ] },
    charges: { label: 'charges', faqs: [
      { q: 'Why is disbursal lower than the loan?', a: 'Customer charges (processing fee, GST, stamp duty, documentation, insurance) are deducted from the loan amount.' },
      { q: 'Does the customer see these charges?', a: 'Yes — the KFS with every charge goes to their registered mobile with the e-sign link. They consent there.' },
    ] },
  },
  kyc: {
    method: { label: 'KYC method', faqs: [{ q: 'Fingerprint is greyed out', a: 'Fingerprint e-KYC with an RD device is coming soon. Use face e-KYC today.' }] },
    capture: { label: 'face capture', faqs: [{ q: 'Liveness keeps failing', a: 'Even light, no cap or mask, phone at eye level, about an arm’s length away. Face inside the oval, then one clear blink.' }] },
  },
  mandate: {
    mode: { label: 'mandate type', faqs: [{ q: 'Which mandate should I pick?', a: 'UPI AutoPay for EMIs up to ₹15,000. Debit card and net banking e-mandates for higher EMIs are coming soon.' }] },
    details: { label: 'Scan & Setup', faqs: [
      { q: 'How does the customer approve?', a: 'They scan the AutoPay QR with any UPI app (or you tap Open UPI app) and approve with their UPI PIN.' },
      { q: 'Why is max debit higher than the EMI?', a: 'It is a ceiling with headroom for rate changes. Only the actual EMI is debited each month.' },
    ] },
  },
  esign: {
    kfs: { label: 'KFS on customer’s phone', faqs: [
      { q: 'Where is the KFS?', a: 'It goes to the customer’s registered mobile with the agreement link. They read the KFS and charges there before sharing the OTP.' },
      { q: 'Customer didn’t get the link', a: 'Wait for the timer, then Resend OTP & KFS link. It goes only to the bank-registered number.' },
    ] },
    otp: { label: 'e-sign OTP', faqs: [{ q: 'Can I enter the OTP for the customer?', a: 'Only after they have read the KFS and agreement and read the OTP to you themselves.' }] },
  },
  docs: {
    invoice: { label: 'invoice', faqs: [{ q: 'Which invoice?', a: 'The vehicle tax invoice in the customer’s name, with IDFC FIRST Bank as hypothecation.' }] },
    insurance: { label: 'insurance', faqs: [{ q: 'Which insurance copy is valid?', a: 'The policy schedule showing IDFC FIRST Bank as hypothecation and the correct chassis number.' }] },
    deliveryPhoto: { label: 'delivery photo', faqs: [{ q: 'What should the photo show?', a: 'The customer with the vehicle, number plate or chassis area visible, at your showroom.' }] },
  },
  disbursal: {
    receipt: { label: 'credit receipt', faqs: [{ q: 'How do I trace the money?', a: 'Use the UTR with your bank. It usually reflects within minutes.' }] },
    timeline: { label: 'timeline', faqs: [{ q: 'Why is a step marked skipped?', a: 'KYC or mandate was already on file with the bank, so the customer didn’t need to repeat it.' }] },
  },
  payouts: {
    summary: { label: 'payout summary', faqs: [{ q: 'How is the payout worked out?', a: 'A % of each loan amount by product (example: 1.5% two-wheeler, 0.75% car, 0.6% commercial vehicle).' }] },
    invoices: { label: 'invoices', faqs: [{ q: 'When do I get paid after claiming?', a: 'Claimed invoices are usually paid within 7 working days. The UTR shows on the invoice once paid.' }] },
  },
  rc: {
    list: { label: 'pending RCs', faqs: [{ q: 'Can I share several at once?', a: 'Yes — tick the boxes (or long-press a case), then tap Share at the bottom.' }] },
  },
};
