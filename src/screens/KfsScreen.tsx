import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Icon, ReadOnlyRow, Text } from '../components/ui';
import { termsFor } from '../config/products';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { charges, emi, inr } from '../utils/finance';
import { haptic } from '../utils/haptics';

/** Key Fact Statement review: loan, rate, EMI, itemised customer charges and net disbursal. */
export default function KfsScreen() {
  const nav = useNavigation();
  const { journey, product } = useApp();
  const t = termsFor(product, journey.condition);
  const c = charges(product, journey.loan);
  const monthly = emi(journey.loan, t.annualRate, journey.tenure);
  const totalPayable = monthly * journey.tenure;
  return (
    <JourneyScreen step="kfs" assistant="kfs" footer={<Button label="KFS explained · send e-sign OTP" icon="file-sign" onPress={() => { haptic.tap(); nav.navigate('Esign'); }} accessibilityHint="Confirms you explained the KFS and charges, then sends the agreement and OTP" />}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Key Fact Statement</Text>
        <Text variant="body" color={colors.textSecondary}>Review with the customer. The same KFS and agreement link is SMSed to them before the e-sign OTP.</Text>
      </View>

      <Card style={{ gap: space.xxs }}>
        <Text variant="label" color={colors.textSecondary}>LOAN</Text>
        <ReadOnlyRow label="Vehicle" value={`${journey.asset.model} ${journey.asset.variant}`} />
        <ReadOnlyRow label="Sanctioned loan amount" value={inr(journey.loan)} strong />
        <ReadOnlyRow label="Interest rate (indicative)" value={`${(t.annualRate * 100).toFixed(2)}% p.a. reducing${journey.condition === 'used' ? ' (used)' : ''}`} />
        <ReadOnlyRow label="Tenure" value={`${journey.tenure} months`} />
        <ReadOnlyRow label="EMI" value={inr(monthly, 2)} />
        <ReadOnlyRow label="Total amount payable" value={inr(totalPayable)} />
      </Card>

      <Card style={{ gap: space.xxs }}>
        <Text variant="label" color={colors.textSecondary}>CHARGES (DEDUCTED FROM LOAN)</Text>
        {c.lines.map((l) => <ReadOnlyRow key={l.label} label={l.label} value={`− ${inr(l.amount)}`} />)}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
        <ReadOnlyRow label="Total charges" value={`− ${inr(c.total)}`} />
      </Card>

      <View style={{ backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.md, gap: space.xxs }} accessibilityLabel={`Net disbursal to dealer ${inr(c.net)}`}>
        <Text variant="label" color="rgba(255,255,255,0.85)">NET DISBURSAL TO DEALER</Text>
        <Text variant="display" color={colors.onPrimary}>{inr(c.net)}</Text>
        <Text variant="caption" color="rgba(255,255,255,0.85)">{inr(journey.loan)} loan − {inr(c.total)} customer charges</Text>
      </View>

      <Banner tone="info" icon="message-text-lock-outline" title="Agreement link goes to the customer first" body="Contains the KFS, all charges and the loan agreement. The customer reads it, then shares the OTP." />

    </JourneyScreen>
  );
}
