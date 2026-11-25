import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ASSISTANT_NAME } from '../config/brand';
import { JourneyScreen } from '../components/Screen';
import { Button, Card, Icon, IconName, PressableScale, Text } from '../components/ui';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { zippyDock } from '../components/assistant/zippyStore';
import { colors, radius, space, touch } from '../theme/tokens';

type Faq = { q: string; a: string };

/** Dealer-floor FAQs, grouped by where the question comes up. Same answers Zippy gives in its help sheet. */
const GROUPS: { title: string; icon: IconName; faqs: Faq[] }[] = [
  {
    title: 'Starting a loan', icon: 'qrcode-scan', faqs: [
      { q: 'How do I start a new loan?', a: 'Tap Scan QR at the bottom of Home and scan the offer QR in the customer’s IDFC FIRST app. If they have no QR, tap “Search by mobile” and they get a consent OTP.' },
      { q: 'The QR won’t scan', a: 'Ask the customer to turn their screen brightness up, hold 15–20 cm away, or switch to search by mobile.' },
      { q: 'No offer found for the customer', a: 'Instant offers are only for existing IDFC FIRST customers with a pre-approved offer. Route others to a regular loan application.' },
    ],
  },
  {
    title: 'KYC, mandate and e-sign', icon: 'face-recognition', faqs: [
      { q: 'Face capture keeps failing', a: 'Ask the customer to remove glasses and cap, move to even light and hold the phone at eye level, then retry.' },
      { q: 'The AutoPay QR expired', a: 'Tap Refresh QR to raise a new AutoPay request, then ask the customer to scan it again with any UPI app.' },
      { q: 'The customer did not get the e-sign OTP', a: 'Wait for the timer, then tap Resend. The OTP and the KFS / agreement link are sent again together.' },
    ],
  },
  {
    title: 'Disbursal and payouts', icon: 'bank-transfer-in', faqs: [
      { q: 'When can I release the vehicle?', a: 'Only after the invoice, insurance and delivery photo are uploaded. Disbursal is then requested automatically.' },
      { q: 'When do I get my payout after claiming?', a: 'Claimed invoices are usually paid within 7 working days. The UTR shows on the invoice once paid.' },
      { q: 'How do I share a pending RC?', a: 'Home → Actions → RC pendency. Tap a case, snap the RC and the registration number is read for you.' },
    ],
  },
];

/** Help & support (from Profile): FAQs, then how to reach a person. */
export default function HelpSupportScreen() {
  const nav = useNavigation();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <JourneyScreen title="Help & support" titleInBody assistant="profile" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1" accessibilityRole="header">Help & support</Text>
        <ZippyAvoid weight="soft" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          <Text variant="body" color={colors.textSecondary}>Quick answers for the showroom floor.</Text>
        </ZippyAvoid>
      </View>

      {GROUPS.map((g) => (
        <View key={g.title} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name={g.icon} size={20} color={colors.primary} />
            <Text variant="label" color={colors.textSecondary}>{g.title.toUpperCase()}</Text>
          </View>
          <Card style={{ padding: 0 }}>
            {g.faqs.map((f, i) => {
              const on = open === f.q;
              return (
                <View key={f.q} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <PressableScale onPress={() => setOpen(on ? null : f.q)} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={f.q}
                    style={{ minHeight: touch.cta, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }}>{f.q}</Text>
                    <ZippyAvoid><Icon name={on ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} /></ZippyAvoid>
                  </PressableScale>
                  {on && <Text variant="body" color={colors.textSecondary} style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>{f.a}</Text>}
                </View>
              );
            })}
          </Card>
        </View>
      ))}

      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>STILL STUCK?</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="account-tie-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Your relationship manager</Text>
            <Text variant="caption" color={colors.textSecondary}>For dealer details, limits, staff access, payouts and anything this page does not cover.</Text>
          </View>
        </View>
        <ZippyAvoid>
          <Button label={`Ask ${ASSISTANT_NAME}`} variant="secondary" icon="chat-question-outline" onPress={() => zippyDock.requestSheet()}
            accessibilityHint="Opens quick help for this screen" />
        </ZippyAvoid>
        <Button label="Privacy & terms" variant="ghost" icon="shield-lock-outline" onPress={() => nav.navigate('PrivacyTerms')} />
      </Card>
    </JourneyScreen>
  );
}
