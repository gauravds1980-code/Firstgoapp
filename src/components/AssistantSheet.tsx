import React, { useEffect, useState } from 'react';
import { APP_NAME, ASSISTANT_NAME } from '../config/brand';
import { ZippyCharacter } from './assistant/ZippyCharacter';
import { RIDE_EXTRA, ZippyRide } from './assistant/ZippyRide';
import { TIPS } from './assistant/tips';
import { Faq, SECTION_HELP } from './assistant/sectionHelp';
import { runPendingAction, useRouteHelp, ZippyPending } from './assistant/zippySection';
import type { ProductId } from '../config/products';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AssistantContext } from '../navigation/types';
import { colors, radius, space, touch, type } from '../theme/tokens';
import { Icon, PressableScale, Text } from './ui';

/**
 * PLACEHOLDER — assistant (chatbot layer for dealer staff who get stuck).
 * Canned, context-aware suggestions only. Wire to the real assistant backend later.
 */
const SUGGESTIONS: Record<AssistantContext, { q: string; a: string }[]> = {
  login: [
    { q: 'I didn’t get the OTP', a: 'Give it 30 seconds, then tap Resend. Make sure it’s the mobile registered with your relationship manager.' },
    { q: 'Who can sign in?', a: 'Dealer owners and staff registered with IDFC FIRST Bank for your dealership code.' },
  ],
  profile: [
    { q: 'How do I change my details?', a: 'Dealer details come from bank records. Ask your relationship manager to update them.' },
  ],
  payouts: [
    { q: 'When do I get paid after claiming?', a: 'Claimed invoices are usually paid within 7 working days. The UTR shows on the invoice once paid.' },
    { q: 'How is the payout worked out?', a: 'A % of each loan amount by product (example: 1.5% two-wheeler, 0.75% car, 0.6% commercial vehicle). Open an invoice to see every case.' },
  ],
  portfolio: [
    { q: 'What does DPD mean?', a: 'Days past due — how late the customer is on their EMI. 0 DPD means fully on time.' },
    { q: 'Why does POS matter?', a: 'Principal outstanding: what the customer still owes. Lower overdue POS keeps your dealer rating strong.' },
  ],
  cases: [
    { q: 'A case is missing', a: 'Cases appear after disbursal. Check the date range at the top, or look in Loans on Home.' },
  ],
  rc: [
    { q: 'Wrong number read from the RC', a: 'The field stays editable — just correct it before submitting.' },
    { q: 'What format is valid?', a: 'Like MH12AB1234 (state, RTO, series, number) or BH series like 22BH1234AA. Spaces are fine.' },
  ],
  tainf: [
    { q: 'How do I increase my limit?', a: 'Your relationship manager can review the limit based on usage and repayment history.' },
    { q: 'What happens if a due is missed?', a: 'Overdue amounts attract penal interest and can block new drawdowns. Pay before the due date.' },
  ],
  home: [
    { q: 'How do I start a new loan?', a: 'Tap “Scan Customer QR” (fastest) or “Search by mobile number” if the customer has no QR.' },
    { q: 'What do the badges on Actions mean?', a: 'They count items waiting on you — invoices to claim and RCs to share.' },
  ],
  scan: [
    { q: 'QR won’t scan', a: 'Increase screen brightness on the customer’s phone, hold 15–20 cm away, or switch to mobile-number search.' },
    { q: 'Customer has no QR', a: 'Use “Search by mobile number” — the customer will get a consent OTP.' },
  ],
  search: [
    { q: 'Customer didn’t get the OTP', a: 'Check the number is the one registered with the bank. Wait 30s and tap Resend.' },
    { q: 'No offer found — what now?', a: 'MVP 1 covers existing IDFC FIRST pre-approved customers only. Route to a regular loan application.' },
  ],
  offer: [
    { q: 'Can the offer amount be increased?', a: 'No — the pre-qualified amount is the ceiling. Final loan is also capped by LTV of the on-road price.' },
    { q: 'Offer belongs to a different person', a: 'Stop and go Home. Only proceed with the customer whose mobile received the consent OTP.' },
  ],
  asset: [
    { q: 'Why is the slider capped?', a: 'Loan max = lower of the pre-qualified offer and LTV % × on-road price.' },
    { q: 'EMI shows above ₹15,000', a: 'UPI AutoPay is capped at ₹15,000 EMI in MVP 1. Increase tenure or lower the loan amount, or use debit card / net banking (MVP 2).' },
  ],
  kyc: [
    { q: 'Face capture keeps failing', a: 'Ask the customer to remove glasses and cap, move to even light, and hold the phone at eye level. Fingerprint e-KYC arrives in MVP 2.' },
    { q: 'Face RD app not installed', a: 'Install “AadhaarFaceRD” from the Play Store, then retry.' },
  ],
  mandate: [
    { q: 'Customer didn’t get the UPI request', a: 'Confirm the UPI ID, ask them to open their UPI app’s pending mandates, or use the intent option.' },
    { q: 'What is a UMN?', a: 'Unique Mandate Number from NPCI — proof the AutoPay mandate is active.' },
    { q: 'What happens after the mandate?', a: 'E-sign opens next. The KFS goes to the customer with the e-sign link — there is no separate KFS screen for you.' },
  ],
  esign: [
    { q: 'Customer wants to see the KFS', a: 'The KFS with every charge is in the SMS link with the agreement, on their registered mobile. They read it there before sharing the OTP.' },
    { q: 'Why is disbursal lower than the loan?', a: 'Customer charges (processing fee, GST, stamp duty, documentation, insurance) are deducted from the loan. The breakdown is on the vehicle & EMI screen and in the customer’s KFS.' },
    { q: 'OTP expired', a: 'Tap Resend. The OTP and KFS / agreement link are re-sent together.' },
  ],
  docs: [
    { q: 'Which insurance copy is valid?', a: 'Upload the policy schedule showing IDFC FIRST Bank as hypothecation.' },
    { q: 'When can I release the vehicle?', a: 'Only after invoice, insurance and the delivery photo are uploaded.' },
  ],
  disbursal: [
    { q: 'Where is the money?', a: 'Credited to your dealer account; use the UTR to trace it with your bank.' },
    { q: 'RC still pending', a: 'Share it from Home → Actions → RC pendency once registration is done. Snap the RC and I’ll read the number.' },
  ],
};

type Msg = { from: 'bot' | 'user'; text: string };

const CONTEXT_LABEL: Record<AssistantContext, string> = {
  login: 'sign-in', home: 'Home', profile: 'your profile', scan: 'QR scan', search: 'customer search', offer: 'the offer', asset: 'vehicle & EMI',
  kyc: 'Face KYC', mandate: 'AutoPay mandate', esign: 'KFS consent & e-sign', docs: 'documents', disbursal: 'disbursal',
  payouts: 'Payouts', portfolio: 'Portfolio', cases: 'Cases done', rc: 'RC pendency', tainf: 'TA / INF',
};

/**
 * FIRST.AI-style thread: lavender assistant bubbles, indigo (#434377) user bubbles and suggestion chips.
 * v1.2.2: section-aware — FAQs for the section in view come first, and anything on the screen that
 * still needs the dealer is shown as a nudge with a quick action (see zippySection.ts).
 */
export function AssistantSheet({ visible, onClose, context, route, product }: { visible: boolean; onClose: () => void; context: AssistantContext; route?: string; product?: ProductId }) {
  const insets = useSafeAreaInsets();
  const { section, pending } = useRouteHelp(route);
  const sec = section ? SECTION_HELP[context]?.[section] : undefined;
  const nudge = pending[0];
  const greetingText = `Hi, ${ASSISTANT_NAME} here — your ${APP_NAME} co-pilot. ${nudge ? `Still needed here: ${nudge.label}.` : TIPS[context]}`;
  const greeting: Msg = { from: 'bot', text: greetingText };
  const [thread, setThread] = useState<Msg[]>([greeting]);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { if (!visible) return; setSpeaking(true); const t = setTimeout(() => setSpeaking(false), 1400); return () => clearTimeout(t); }, [visible, thread.length]);
  const seen = new Set<string>();
  const sugs: Faq[] = [...(sec?.faqs ?? []), ...SUGGESTIONS[context]].filter((f) => (seen.has(f.q) ? false : (seen.add(f.q), true))).slice(0, 4);
  const asked = new Set(thread.filter((m) => m.from === 'user').map((m) => m.text));
  const ask = (f: Faq) => setThread((t) => [...t, { from: 'user', text: f.q }, { from: 'bot', text: f.a }]);
  const act = (p: ZippyPending) => { if (!route) return; onClose(); setTimeout(() => runPendingAction(route, p.id), 250); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={() => setThread([greeting])}>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="Close assistant" />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, maxHeight: '85%', gap: space.md }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 52, height: product ? 52 * (1 + RIDE_EXTRA) : 52 }}>
            {product ? <ZippyRide size={52} product={product} speaking={speaking} /> : <ZippyCharacter size={52} speaking={speaking} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="h3">{ASSISTANT_NAME}</Text>
            <Text variant="caption" color={colors.textSecondary}>Quick help for {CONTEXT_LABEL[context]}{sec ? ` · ${sec.label}` : ''}</Text>
          </View>
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={24} color={colors.text} />
          </PressableScale>
        </View>
        <ScrollView contentContainerStyle={{ gap: space.sm }}>
          {pending.length > 0 && (
            <View style={{ gap: space.xs, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.cta, backgroundColor: colors.ctaTint }} accessibilityRole="summary">
              <Text variant="label" color={colors.ctaDark}>STILL NEEDED ON THIS SCREEN</Text>
              {pending.slice(0, 3).map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Icon name="alert-circle-outline" size={18} color={colors.ctaDark} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{p.label}</Text>
                    {p.detail ? <Text variant="caption" color={colors.textSecondary}>{p.detail}</Text> : null}
                  </View>
                  {p.actionLabel && p.onAction ? (
                    <PressableScale onPress={() => act(p)} accessibilityRole="button" accessibilityLabel={p.actionLabel}
                      style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.cta }}>
                      <Text variant="label" color={colors.onCta} numberOfLines={1}>{p.actionLabel}</Text>
                    </PressableScale>
                  ) : null}
                </View>
              ))}
            </View>
          )}
          {thread.map((m, i) => (
            <View key={i} style={{ alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', backgroundColor: m.from === 'user' ? colors.aiUser : colors.aiThread,
              paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: m.from === 'user' ? 4 : radius.lg, borderBottomLeftRadius: m.from === 'bot' ? 4 : radius.lg }}>
              <Text variant="body" color={m.from === 'user' ? colors.onPrimary : colors.text}>{m.text}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'flex-end', marginTop: space.xs }}>
            {sugs.map((sug) => asked.has(sug.q) ? null : (
              <PressableScale key={sug.q} onPress={() => ask(sug)} accessibilityRole="button" accessibilityLabel={`Ask: ${sug.q}`}
                style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.aiUser, backgroundColor: colors.surface }}>
                <Text variant="label" color={colors.aiUser}>{sug.q}</Text>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, backgroundColor: colors.surfaceMuted }}>
          <TextInput editable={false} placeholder="Typing coming soon (placeholder)" placeholderTextColor={colors.textMuted}
            style={[type.body, { flex: 1, height: touch.cta }, { outlineStyle: 'none' } as object]} accessibilityLabel="Chat input, disabled placeholder" />
          <Icon name="microphone-outline" size={22} color={colors.borderStrong} />
          <Icon name="send" size={22} color={colors.borderStrong} />
        </View>
        <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Prototype: canned answers, assistant backend not connected yet.</Text>
      </View>
    </Modal>
  );
}
