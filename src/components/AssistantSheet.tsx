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
import { SHOW_DEV_UI } from '../config/devFlags';
import { voiceSession } from '../voice/voiceSession';
import { navRef } from '../navigation/navRef';
import { tutorialForScreen } from '../tutorial/manifest';
import { formatShortLength } from '../tutorial/stuckDetector';
import { setNudgeSuppressed, tutorials } from '../tutorial/tutorialStore';

/** Help & tutorials is a main-stack screen: reachable once signed in. */
const canOpenHelp = () => navRef.isReady() && ((navRef.getRootState()?.routeNames as string[] | undefined) ?? []).includes('Help');

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
    { q: 'No offer found — what now?', a: 'Right now, instant offers are only for existing IDFC FIRST customers with a pre-approved offer. Route others to a regular loan application.' },
  ],
  offer: [
    { q: 'Can the offer amount be increased?', a: 'No — the pre-qualified amount is the ceiling. Final loan is also capped by LTV of the on-road price.' },
    { q: 'Offer belongs to a different person', a: 'Stop and go Home. Only proceed with the customer whose mobile received the consent OTP.' },
  ],
  asset: [
    { q: 'Why is the slider capped?', a: 'Loan max = lower of the pre-qualified offer and LTV % × on-road price.' },
    { q: 'EMI shows above ₹15,000', a: 'UPI AutoPay is capped at ₹15,000 EMI. Increase the tenure or lower the loan amount.' },
  ],
  kyc: [
    { q: 'Face capture keeps failing', a: 'Ask the customer to remove glasses and cap, move to even light, and hold the phone at eye level. Fingerprint e-KYC is coming soon.' },
    { q: 'What does the customer do on the camera?', a: 'Line their face up inside the oval and blink once when it says “Okay, blink”. The tick shows and the mandate step opens by itself.' },
    { q: 'Camera access is off', a: 'Open Settings → FIRSTgo → Camera, turn it on, then tap Try again. The same camera is used for QR, RC and face e-KYC.' },
    { q: 'Face RD app not installed', a: 'Install “AadhaarFaceRD” from the Play Store, then retry.' },
  ],
  mandate: [
    { q: 'How does the AutoPay QR work?', a: 'The QR is ready as soon as the screen opens. The customer scans it with any UPI app (or you tap Open UPI app on their phone), checks the EMI and max amount, and approves with their UPI PIN. The app waits by itself; the mandate is created and e-sign opens.' },
    { q: 'Open UPI app says no UPI app found', a: 'This phone has no UPI app. Ask the customer to scan the QR from their own phone.' },
    { q: 'The QR expired or failed', a: 'Tap Refresh QR to raise a new AutoPay request, then ask the customer to scan again.' },
    { q: 'What is a UMRN?', a: 'Unique Mandate Reference Number from NPCI — proof the AutoPay mandate is active. Customers get a pre-debit notification 24 hours before each EMI.' },
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
  help: [
    { q: 'Do the videos use mobile data?', a: 'No. They ship inside the app and play offline.' },
    { q: 'Can I stop the how-to pop-ups?', a: 'Tap “Don’t show again here” on a pop-up, or turn off Tutorial nudges in Profile.' },
  ],
  disbursal: [
    { q: 'Where is the money?', a: 'Credited to your dealer account; use the UTR to trace it with your bank.' },
    { q: 'RC still pending', a: 'Share it from Home → Actions → RC pendency once registration is done. Snap the RC and I’ll read the number.' },
  ],
};

type Msg = { from: 'bot' | 'user'; text: string };

/** Short screen names for the sheet subtitle ("Help for Home"), so it stays on one line at 360dp. */
const CONTEXT_LABEL: Record<AssistantContext, string> = {
  login: 'sign-in', home: 'Home', profile: 'Profile', scan: 'Scan QR', search: 'search', offer: 'the offer', asset: 'Vehicle & EMI',
  kyc: 'Face KYC', mandate: 'Mandate', esign: 'e\u2011sign', docs: 'Documents', disbursal: 'Disbursal',
  payouts: 'Payouts', portfolio: 'Portfolio', cases: 'Cases done', rc: 'RC pendency', tainf: 'TA / INF', help: 'tutorials',
};

/**
 * v1.3.0 brand thread: cream assistant bubbles with ink text, maroon user bubbles, and suggestion chips
 * with a maroon outline and maroon text (no off-brand indigo / lavender).
 * v1.2.2: section-aware — FAQs for the section in view come first, and anything on the screen that
 * still needs the dealer is shown as a nudge with a quick action (see zippySection.ts).
 */
export function AssistantSheet({ visible, onClose, context, route, product, docked = true, onToggleDock }: {
  visible: boolean; onClose: () => void; context: AssistantContext; route?: string; product?: ProductId;
  /** Zippy's dock state, for the menu option that hides (docks) or floats it. */
  docked?: boolean; onToggleDock?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { section, pending } = useRouteHelp(route);
  const sec = section ? SECTION_HELP[context]?.[section] : undefined;
  const nudge = pending[0];
  const greetingText = `Hi, ${ASSISTANT_NAME} here — your ${APP_NAME} co-pilot. ${nudge ? `Still needed here: ${nudge.label}.` : TIPS[context]}`;
  const greeting: Msg = { from: 'bot', text: greetingText };
  const [thread, setThread] = useState<Msg[]>([greeting]);
  const [speaking, setSpeaking] = useState(false);
  // v1.3.0: this screen's how-to short opens the shorts feed (full screen) at that short.
  const short = tutorialForScreen(route);
  const watchHowTo = () => { if (!short) return; onClose(); setTimeout(() => tutorials.openShorts(short.id), 250); };
  const openHelp = () => { onClose(); setTimeout(() => { if (canOpenHelp()) navRef.navigate('Help'); }, 250); };
  useEffect(() => { if (!visible) return; tutorials.dismissNudge(); setNudgeSuppressed('assistant-sheet', true); return () => setNudgeSuppressed('assistant-sheet', false); }, [visible]);
  useEffect(() => { if (!visible) return; setSpeaking(true); const t = setTimeout(() => setSpeaking(false), 1400); return () => clearTimeout(t); }, [visible, thread.length]);
  const seen = new Set<string>();
  const sugs: Faq[] = [...(sec?.faqs ?? []), ...SUGGESTIONS[context]].filter((f) => (seen.has(f.q) ? false : (seen.add(f.q), true))).slice(0, 4);
  const asked = new Set(thread.filter((m) => m.from === 'user').map((m) => m.text));
  const ask = (f: Faq) => setThread((t) => [...t, { from: 'user', text: f.q }, { from: 'bot', text: f.a }]);
  const act = (p: ZippyPending) => { if (!route) return; onClose(); setTimeout(() => runPendingAction(route, p.id), 250); };
  // Voice is separate (header mic + VoiceHost): the sheet has no mic, gets no transcripts / previews, and
  // voice never drives this Zippy's mood or lips. It only tells VoiceHost it is visible, so voice results
  // can be drawn above this Modal. Opening / closing never aborts a recording or a Piper read-out.
  useEffect(() => { if (!visible) return; voiceSession.setSheetOpen(true); return () => voiceSession.setSheetOpen(false); }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={() => setThread([greeting])}>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="Close assistant" />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md + insets.bottom, maxHeight: '85%', gap: space.md }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 52, height: product ? 52 * (1 + RIDE_EXTRA) : 52 }}>
            {product ? <ZippyRide size={52} product={product} mood="idle" speaking={speaking} /> : <ZippyCharacter size={52} mood="idle" speaking={speaking} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="h3">{ASSISTANT_NAME}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>Help for {CONTEXT_LABEL[context]}</Text>
          </View>
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={24} color={colors.text} />
          </PressableScale>
        </View>
        {/* v1.3.0: how-to videos — this screen's short inline, or the whole Help & tutorials list. */}
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {short && (
            <PressableScale onPress={watchHowTo} accessibilityRole="button"
              accessibilityLabel={`Watch a how-to for this screen, ${formatShortLength(short.durationSec)}`}
              style={{ flex: 1.4, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.primary }}>
              <Icon name="play-circle" size={20} color={colors.onPrimary} />
              <Text variant="label" color={colors.onPrimary} numberOfLines={2} style={{ flexShrink: 1 }}>Watch a how-to for this screen</Text>
            </PressableScale>
          )}
          {canOpenHelp() && (
            <PressableScale onPress={openHelp} accessibilityRole="button" accessibilityLabel="All tutorials"
              style={{ flex: 1, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface }}>
              <Icon name="play-box-multiple-outline" size={20} color={colors.primary} />
              <Text variant="label" color={colors.primary} numberOfLines={1}>All tutorials</Text>
            </PressableScale>
          )}
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
            <View key={i} style={{ alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', backgroundColor: m.from === 'user' ? colors.primary : colors.bg,
              borderWidth: m.from === 'user' ? 0 : 1, borderColor: colors.border,
              paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: m.from === 'user' ? 4 : radius.lg, borderBottomLeftRadius: m.from === 'bot' ? 4 : radius.lg }}>
              <Text variant="body" color={m.from === 'user' ? colors.onPrimary : colors.text}>{m.text}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'flex-end', marginTop: space.xs }}>
            {sugs.map((sug) => asked.has(sug.q) ? null : (
              <PressableScale key={sug.q} onPress={() => ask(sug)} accessibilityRole="button" accessibilityLabel={`Ask: ${sug.q}`}
                style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface }}>
                <Text variant="label" color={colors.primary}>{sug.q}</Text>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
        {/* Menu option: the single way (besides dragging or long-press) to dock Zippy into the header or float it back out. */}
        {onToggleDock && (
          <PressableScale onPress={onToggleDock} accessibilityRole="button" accessibilityLabel={docked ? `Float ${ASSISTANT_NAME} on screen` : `Dock ${ASSISTANT_NAME} to the header`}
            style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
            <Icon name={docked ? 'arrow-expand-down' : 'arrow-collapse-up'} size={18} color={colors.primary} />
            <Text variant="label" color={colors.primary}>{docked ? `Float ${ASSISTANT_NAME} on screen` : `Dock ${ASSISTANT_NAME} to the header`}</Text>
          </PressableScale>
        )}
        {/* Prototype chrome (disabled chat box, "canned answers" note): tester builds only. */}
        {SHOW_DEV_UI && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, backgroundColor: colors.surfaceMuted }}>
              <TextInput editable={false} placeholder="Typing coming soon (placeholder)" placeholderTextColor={colors.textMuted}
                style={[type.body, { flex: 1, height: touch.cta }, { outlineStyle: 'none' } as object]} accessibilityLabel="Chat input, disabled placeholder" />
              <Icon name="send" size={22} color={colors.borderStrong} />
            </View>
            <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Prototype: canned answers; voice commands use the STT proxy.</Text>
          </>
        )}
      </View>
    </Modal>
  );
}
