import React from 'react';
import { View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Button, Card, Icon, IconName, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { colors, space } from '../theme/tokens';

const COPY: Record<RootStackParamList['ComingSoon']['kind'], { title: string; icon: IconName; body: string; meanwhile: string }> = {
  staff: {
    title: 'Manage staff logins', icon: 'account-group-outline',
    body: 'Soon you will add and remove the staff who can sign in for your dealership, right here.',
    meanwhile: 'Until then, ask your relationship manager to add or remove a staff login.',
  },
  notifications: {
    title: 'Notification settings', icon: 'bell-outline',
    body: 'Soon you will choose which alerts you get, such as disbursals, payouts and RC reminders.',
    meanwhile: 'Until then, alerts follow your phone’s notification settings for this app.',
  },
};

/** Honest placeholder for Profile rows that are not built yet (never a silent no-op). */
export default function ComingSoonScreen() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ComingSoon'>>();
  const c = COPY[params?.kind ?? 'staff'] ?? COPY.staff;
  return (
    <JourneyScreen title={c.title} titleInBody assistant="profile" showTerms={false}>
      <Text variant="h1" accessibilityRole="header">{c.title}</Text>
      <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={c.icon} size={32} color={colors.primary} />
        </View>
        <Text variant="h3" style={{ textAlign: 'center' }}>Coming soon</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>{c.body}</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>{c.meanwhile}</Text>
      </Card>
      <Button label="Back to profile" variant="secondary" icon="arrow-left" onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('Profile'))} />
    </JourneyScreen>
  );
}
