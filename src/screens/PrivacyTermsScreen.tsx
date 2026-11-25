import React from 'react';
import { View } from 'react-native';
import { APP_NAME } from '../config/brand';
import { JourneyScreen } from '../components/Screen';
import { Card, Icon, IconName, Text } from '../components/ui';
import { colors, space } from '../theme/tokens';

/** Plain-language summary for dealer staff; the dealer agreement with the bank is the binding text. */
const SECTIONS: { icon: IconName; title: string; body: string[] }[] = [
  {
    icon: 'account-lock-outline', title: 'Your login', body: [
      `${APP_NAME} is for authorised dealer staff only. Sign in with your own registered dealer mobile; never share your OTP or use a customer’s number.`,
      'Log out from Profile when a shared phone changes hands.',
    ],
  },
  {
    icon: 'card-account-details-outline', title: 'Customer data', body: [
      'Use a customer’s details only for the loan they asked for, with them present.',
      'The customer must read every OTP (consent, e-sign) to you themselves. Never type an OTP the customer has not seen.',
      'The KFS and loan agreement go straight to the customer’s registered mobile; they read and consent there.',
    ],
  },
  {
    icon: 'camera-outline', title: 'Camera and photos', body: [
      `${APP_NAME} uses the camera only to read the offer QR, photograph RCs and documents, and run face e-KYC. Face e-KYC is verified by UIDAI for IDFC FIRST Bank; nothing from it is stored on this phone.`,
    ],
  },
  {
    icon: 'microphone-outline', title: 'Voice commands', body: [
      'The header mic records only while you hold it. The recording is turned into a command and is not kept on this phone.',
    ],
  },
  {
    icon: 'file-document-outline', title: 'Terms', body: [
      'Loan offers, rates and charges are indicative until the customer’s KFS. Terms and eligibility conditions apply.',
      'Your dealer agreement with IDFC FIRST Bank sets the full terms of use, payouts and data handling. Ask your relationship manager for a copy.',
    ],
  },
];

export default function PrivacyTermsScreen() {
  return (
    <JourneyScreen title="Privacy & terms" titleInBody assistant="profile" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1" accessibilityRole="header">Privacy & terms</Text>
        <Text variant="body" color={colors.textSecondary}>A plain-language summary for dealer staff.</Text>
      </View>
      {SECTIONS.map((s) => (
        <Card key={s.title} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name={s.icon} size={20} color={colors.primary} />
            <Text variant="h3" accessibilityRole="header" style={{ flex: 1 }}>{s.title}</Text>
          </View>
          {s.body.map((p) => <Text key={p} variant="body" color={colors.text}>{p}</Text>)}
        </Card>
      ))}
    </JourneyScreen>
  );
}
