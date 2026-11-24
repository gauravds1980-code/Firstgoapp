import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Button, Card, Icon, Pill, ReadOnlyRow, Text } from '../components/ui';
import { CONDITION_LABEL, PRODUCTS, termsFor } from '../config/products';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { inr, maskMobile } from '../utils/finance';

export default function OfferScreen() {
  const nav = useNavigation();
  const { journey, product } = useApp();
  const o = journey.offer;
  const t = termsFor(product, journey.condition);
  const used = journey.condition === 'used';
  return (
    <JourneyScreen step="offer" assistant="offer" footer={<Button label="Select vehicle" iconRight="arrow-right" onPress={() => nav.navigate('Asset')} />}>
      <View style={{ alignItems: 'center', gap: space.xs, paddingTop: space.sm }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check-decagram" size={52} color={colors.success} />
        </View>
        <Text variant="h2" style={{ textAlign: 'center' }}>Congratulations, {o.customerName.split(' ')[0]}!</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Pre-qualified {used ? 'used ' : ''}{PRODUCTS[product].label.toLowerCase()} offer up to</Text>
        <Text variant="display" color={colors.primary} style={{ textAlign: 'center' }} accessibilityLabel={`Offer amount ${inr(o.amount)}`}>{inr(o.amount)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs }}>
          <Pill label="ETB · PRE-APPROVED" tone="success" />
          <Pill label={`VALID TILL ${new Date(o.validTill).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}`} tone="neutral" />
        </View>
      </View>
      <Card style={{ gap: space.xxs }}>
        <Text variant="label" color={colors.textSecondary}>APPLICATION DETAILS</Text>
        <ReadOnlyRow label="Customer" value={o.customerName} />
        <ReadOnlyRow label="Registered mobile" value={maskMobile(o.registeredMobile)} />
        <ReadOnlyRow label="Loan application no." value={o.loanApplicationNumber} />
        <ReadOnlyRow label="Product" value={used ? `${CONDITION_LABEL[journey.condition]} ${PRODUCTS[product].label}` : PRODUCTS[product].label} />
        {(o.waivers.kycOnFile || o.waivers.mandateOnFile) && (
          <ReadOnlyRow label="On file with bank" value={[o.waivers.kycOnFile && 'KYC', o.waivers.mandateOnFile && 'AutoPay mandate'].filter(Boolean).join(' + ')} />
        )}
      </Card>
      <View style={{ backgroundColor: colors.primaryTint, borderRadius: radius.md, padding: space.sm, flexDirection: 'row', gap: space.xs }}>
        <Icon name="information-outline" size={18} color={colors.primary} />
        <Text variant="caption" style={{ flex: 1 }}>Final loan is the lower of this offer and {Math.round(t.ltv * 100)}% of the vehicle's {used ? 'valuation' : 'on-road price'}.{used ? ' Used-vehicle LTV and rate are example values.' : ''}</Text>
      </View>
    </JourneyScreen>
  );
}
