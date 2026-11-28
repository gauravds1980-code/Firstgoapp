import React, { useState } from 'react';
import { logout } from '../services/auth';
import { Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import type { IconName } from '../components/ui';
import { JourneyScreen } from '../components/Screen';
import { Button, Card, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { featuresFor, Phase, PHASE_LABELS } from '../config/phases';
import { brandSource, colors, radius, space, touch } from '../theme/tokens';
import { useApp } from '../state/AppState';
import { DEALER_PRODUCTS } from '../config/products';
import { DEALER_TYPE_LABEL, initials } from '../services/dealer';
import { maskMobile } from '../utils/finance';
import { SHOW_DEV_UI } from '../config/devFlags';
import { setAskBeforeActing, useAskBeforeActing } from '../voice/voiceSettings';
import { VoiceSettingsPanel } from '../voice/VoiceSettingsPanel';
import { tutorials, useTutorialState } from '../tutorial/tutorialStore';

/** Dealer profile & settings (reached from the Home header avatar). The rollout-phase panel is tester-only (SHOW_DEV_UI). */
export default function ProfileScreen() {
  const { phase, setPhase, session, signOut, profile } = useApp();
  const [out, setOut] = useState(false);
  const doLogout = async () => { setOut(true); await logout(session); await signOut(); /* auth gate swaps to DealerLogin */ };
  const f = featuresFor(phase);
  const askFirst = useAskBeforeActing();
  const nav = useNavigation();
  const { nudgesEnabled } = useTutorialState();
  // Every row with a chevron opens a real screen (tutorials, FAQs, Privacy) or an honest coming-soon screen.
  const rows: { icon: IconName; label: string; go: () => void }[] = [
    { icon: 'account-group-outline', label: 'Manage staff logins', go: () => nav.navigate('ComingSoon', { kind: 'staff' }) },
    { icon: 'bell-outline', label: 'Notification settings', go: () => nav.navigate('AlertSettings') },
    { icon: 'play-box-multiple-outline', label: 'Help & tutorials', go: () => nav.navigate('Help') },
    { icon: 'lifebuoy', label: 'FAQs & support', go: () => nav.navigate('HelpSupport') },
    { icon: 'shield-lock-outline', label: 'Privacy & terms', go: () => nav.navigate('PrivacyTerms') },
  ];
  return (
    <JourneyScreen title="Profile" assistant="profile" showTerms={false} footer={<Button label="Log out" variant="secondary" icon="logout" onPress={doLogout} loading={out} />}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h2" color={colors.onPrimary}>{initials(session?.name ?? 'Dealer')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{session?.name ?? 'ABC Motors'}</Text>
          {/* Code and location on their own lines (no dangling "·" when the line wraps). */}
          <Text variant="caption" color={colors.textSecondary}>Dealer code {session?.dealerId ?? '—'}</Text>
          {profile?.branch ? <Text variant="caption" color={colors.textSecondary}>{profile.branch}</Text> : null}
          <Text variant="caption" color={colors.textSecondary}>Signed in as {session ? maskMobile(session.mobile) : '—'}</Text>
        </View>
      </Card>
      {profile && (
        <Card style={{ gap: space.sm }}>
          {/* The type is in the "Dealer type" row below, so no duplicate badge here. */}
          <Text variant="label" color={colors.textSecondary}>DEALER PROFILE</Text>
          <ReadOnlyRow label="Dealer type" value={DEALER_TYPE_LABEL[profile.type]} />
          <ReadOnlyRow label="Manufacturer (OEM)" value={profile.type === 'multiBrand' ? 'All brands (multi-brand)' : profile.oem ?? '—'} />
          <View style={{ gap: space.xs }}>
            <Text variant="caption" color={colors.textSecondary}>Products enabled</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }} accessibilityLabel={`Products enabled: ${DEALER_PRODUCTS.filter((d) => profile.products.includes(d.key)).map((d) => d.label).join(', ')}`}>
              {DEALER_PRODUCTS.map((d) => {
                const on = profile.products.includes(d.key);
                return (
                  <View key={d.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, minHeight: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.successBright : colors.border, backgroundColor: on ? colors.successSoft : colors.surfaceMuted }}>
                    <Icon name={on ? 'check-circle' : 'minus-circle-outline'} size={16} color={on ? colors.success : colors.textMuted} />
                    <Text variant="label" color={on ? colors.success : colors.textMuted}>{d.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
          <Text variant="caption" color={colors.textMuted}>Set by IDFC FIRST at dealer onboarding. Contact your relationship manager to change it.</Text>
        </Card>
      )}
      <Card style={{ gap: space.xxs }}>
        <Text variant="label" color={colors.textSecondary}>SETTLEMENT ACCOUNT</Text>
        <ReadOnlyRow label="Bank" value="IDFC FIRST Bank" />
        <ReadOnlyRow label="Account" value="••••4321 (Current)" />
        <ReadOnlyRow label="IFSC" value="IDFB0040101" />
      </Card>
      <View style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
        <Icon name="microphone-message" size={22} color={colors.primary} />
        {/* v1.3.0: worded in the positive, so the label matches the switch's on state. Same setting (askBeforeActing = !on). */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Let Zippy act without asking</Text>
          <Text variant="caption" color={colors.textSecondary}>When on, Zippy acts on high-confidence voice commands and shows an Undo toast. When off, it asks you to confirm first.</Text>
        </View>
        <ZippyAvoid>
          <Switch value={!askFirst} onValueChange={(on) => setAskBeforeActing(!on)} accessibilityLabel="Let Zippy act without asking"
            accessibilityHint="When on, Zippy acts on clear voice commands straight away and offers Undo"
            trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
        </ZippyAvoid>
      </View>
      {/* v1.4.0: talk mode, language, the phone's recognizer and voice speed stats. */}
      <VoiceSettingsPanel />
      {/* v1.3.0: Zippy offers a screen's how-to short on the first visit and when the dealer seems stuck. */}
      <View style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
        <Icon name="play-circle-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Tutorial nudges</Text>
          <Text variant="caption" color={colors.textSecondary}>Zippy offers a short how-to video on a new screen, or when you seem stuck.</Text>
        </View>
        <ZippyAvoid>
          <Switch value={nudgesEnabled} onValueChange={tutorials.setNudgesEnabled} accessibilityLabel="Tutorial nudges" {...({ activeThumbColor: colors.surface } as object)}
            accessibilityHint="When on, Zippy offers a short how-to video on new screens and when you seem stuck"
            trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
        </ZippyAvoid>
      </View>
      {rows.map((r) => (
        <PressableScale key={r.label} onPress={r.go} accessibilityRole="button" accessibilityLabel={r.label} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
          <Icon name={r.icon} size={22} color={colors.primary} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>{r.label}</Text>
          {/* Trailing chevron column: floating Zippy keeps off it. */}
          <ZippyAvoid><Icon name="chevron-right" size={22} color={colors.textSecondary} /></ZippyAvoid>
        </PressableScale>
      ))}
      {SHOW_DEV_UI && (
      <Card style={{ gap: space.sm, borderStyle: 'dashed', borderColor: colors.borderStrong }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Icon name="flask-outline" size={20} color={colors.primary} />
          <Text variant="h3" style={{ flex: 1 }}>Developer · rollout phase</Text>
          <Pill label={`MVP ${phase}`} tone="brand" />
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup">
          {([1, 2, 3, 5] as Phase[]).map((ph) => (
            <PressableScale key={ph} onPress={() => setPhase(ph)} accessibilityRole="radio" accessibilityState={{ selected: ph === phase }} accessibilityLabel={PHASE_LABELS[ph]}
              style={{ flex: 1, height: touch.min, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: ph === phase ? colors.primary : colors.surfaceMuted }}>
              <Text variant="label" color={ph === phase ? colors.onPrimary : colors.text}>MVP {ph}</Text>
            </PressableScale>
          ))}
        </View>
        <Text variant="caption" color={colors.textSecondary}>{PHASE_LABELS[phase]}</Text>
        <Text variant="caption" color={colors.textSecondary}>
          Fingerprint KYC {f.fingerprintKyc ? 'on' : 'off'} · Debit card / net banking mandate {f.debitCardMandate ? 'on' : 'off'} · Self-serve link {f.selfServeLink ? 'on' : 'off'} · Cross-sell shelf placeholder only
        </Text>
        <Text variant="caption" color={colors.textMuted}>Brand tokens: {brandSource}</Text>
      </Card>
      )}
    </JourneyScreen>
  );
}
