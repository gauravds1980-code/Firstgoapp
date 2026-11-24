import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Slider } from '../components/Slider';
import { Banner, Button, Card, Icon, Pill, PressableScale, Text } from '../components/ui';
import { UPI_MANDATE_EMI_CAP } from '../config/phases';
import { CONDITION_LABEL, PRODUCTS, termsFor } from '../config/products';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { emi, inr, maxLoan, maskMobile } from '../utils/finance';
import { haptic } from '../utils/haptics';

export default function AssetScreen() {
  const nav = useNavigation();
  const { journey, product, update, features, catalogue, profile } = useApp();
  const p = PRODUCTS[product];
  const t = termsFor(product, journey.condition);
  const used = journey.condition === 'used';
  const max = maxLoan(product, journey.offer.amount, journey.asset.onRoadPrice, journey.condition);
  const min = Math.min(p.minLoan, max);
  const loan = Math.min(journey.loan, max);
  const monthly = emi(loan, t.annualRate, journey.tenure);
  const overCap = monthly > UPI_MANDATE_EMI_CAP;
  const mvp2Available = features.debitCardMandate || features.netBankingMandate;
  const offerBinds = journey.offer.amount < t.ltv * journey.asset.onRoadPrice;

  useEffect(() => { if (journey.loan > max) update({ loan: max }); }, [max, journey.loan, update]);

  // Shortest tenure that brings EMI under the UPI cap, to suggest a fix
  const fixTenure = p.tenureOptions.find((tn) => tn > journey.tenure && emi(loan, t.annualRate, tn) <= UPI_MANDATE_EMI_CAP);

  return (
    <JourneyScreen step="asset" assistant="asset" footer={
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="caption" color={colors.textSecondary}>EMI · {journey.tenure} months</Text>
          <Text variant="h2" color={overCap ? colors.warning : colors.text}>{inr(monthly)}<Text variant="caption" color={colors.textSecondary}> /month</Text></Text>
        </View>
 {overCap && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: mvp2Available ? colors.warningSoft : colors.dangerSoft, borderRadius: radius.md, padding: space.xs }} accessibilityRole="alert">
            <Icon name="alert-circle-outline" size={18} color={mvp2Available ? colors.warning : colors.danger} />
            <Text variant="caption" color={mvp2Available ? colors.warning : colors.danger} style={{ flex: 1, fontFamily: 'Inter_600SemiBold' }}>
              {mvp2Available ? `Above ${inr(UPI_MANDATE_EMI_CAP)} UPI cap — debit card / net banking mandate will be used` : `Above ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay cap — needs an MVP 2 mandate (debit card / net banking)${fixTenure ? `. Try ${fixTenure}+ months` : ''}`}
            </Text>
          </View>
        )}
        <Button label="Verify and Continue" iconRight="arrow-right" onPress={() => nav.navigate('FaceKyc')} disabled={overCap && !mvp2Available}
          accessibilityHint={overCap && !mvp2Available ? 'Disabled: EMI is above the UPI mandate cap' : undefined} />
      </View>}>
      {/* Offer summary (merged from the Offer screen to save a tap) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: 'rgba(0,160,122,0.25)' }}
        accessibilityLabel={`Pre-qualified offer for ${journey.offer.customerName}, up to ${inr(journey.offer.amount)}`}>
        <Icon name="check-decagram" size={32} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{journey.offer.customerName} · up to {inr(journey.offer.amount)}</Text>
          <Text variant="caption" color={colors.textSecondary}>ETB pre-approved · {maskMobile(journey.offer.registeredMobile)} · LAN {journey.offer.loanApplicationNumber}</Text>
          {(journey.offer.waivers.kycOnFile || journey.offer.waivers.mandateOnFile) && (
            <Text variant="caption" color={colors.success} style={{ fontFamily: 'Inter_600SemiBold' }}>
              On file: {[journey.offer.waivers.kycOnFile && 'KYC', journey.offer.waivers.mandateOnFile && 'AutoPay mandate'].filter(Boolean).join(' + ')} · those steps will be skipped
            </Text>
          )}
        </View>
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Select the {used ? 'used ' : ''}{p.label.toLowerCase()}</Text>
        <Text variant="body" color={colors.textSecondary}>Pick the model the customer is buying, then set tenure and amount.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {used && <Pill label={`${CONDITION_LABEL[journey.condition].toUpperCase()} VEHICLE`} tone="warning" />}
          <Pill label={profile && profile.type !== 'multiBrand' && profile.oem ? `${profile.oem.toUpperCase()} MODELS` : 'ALL BRANDS'} tone="neutral" />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {catalogue.map((a) => {
          const on = a.id === journey.asset.id;
          return (
            <PressableScale key={a.id} onPress={() => update({ asset: a, loan: maxLoan(product, journey.offer.amount, a.onRoadPrice, journey.condition) })}
              accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${a.brand} ${a.model} ${a.variant}, on-road ${inr(a.onRoadPrice)}`}
              style={{ width: 168, minHeight: 112, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface, padding: space.sm, gap: space.xxs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Icon name={p.icon} size={28} color={on ? colors.primary : colors.textSecondary} />
                {on && <Icon name="check-circle" size={20} color={colors.primary} />}
              </View>
              <Text variant="bodyStrong" numberOfLines={1}>{a.model}</Text>
              <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{a.variant}</Text>
              <Text variant="label">{inr(a.onRoadPrice)}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <Card style={{ gap: space.xs }}>
        <Row label="Brand" value={journey.asset.brand} />
        <Row label="Model" value={`${journey.asset.model} ${journey.asset.variant}`.toUpperCase()} />
        <Row label={used ? 'Valuation (used)' : 'On-road price'} value={inr(journey.asset.onRoadPrice)} />
      </Card>

      <View style={{ gap: space.xs }}>
        <Text variant="label">Tenure (months)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
          {p.tenureOptions.map((t) => {
            const on = t === journey.tenure;
            return (
              <PressableScale key={t} onPress={() => { haptic.select(); update({ tenure: t }); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t} months`}
                style={{ minWidth: 56, height: touch.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm }}>
                <Text variant="bodyStrong" color={on ? colors.onPrimary : colors.text}>{t}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      <Card style={{ gap: space.xs }}>
        <Text variant="label" color={colors.textSecondary}>Desired loan amount</Text>
        <Text variant="display" color={colors.primary}>{inr(loan)}</Text>
        <Slider label="Loan amount" value={loan} min={min} max={max} step={p.loanStep} onChange={(v) => update({ loan: v })} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color={colors.textSecondary}>{inr(min)}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption" style={{ fontFamily: 'Inter_600SemiBold' }}>{inr(max)}</Text>
            <Text variant="caption" color={colors.textSecondary}>{offerBinds ? 'Pre-qualified offer limit' : `${Math.round(t.ltv * 100)}% of ${used ? 'valuation' : 'on-road price'}`}</Text>
          </View>
        </View>
      </Card>

      {overCap ? (
        mvp2Available ? (
          <Banner tone="warning" title={`EMI above ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay cap`} body="UPI mandate isn't available for this EMI. You'll set up a debit card or net banking mandate in the mandate step." />
        ) : (
          <Banner tone="danger" title={`EMI above ${inr(UPI_MANDATE_EMI_CAP)} — UPI AutoPay can't be used`}
            body={`MVP 1 only supports UPI mandates up to ${inr(UPI_MANDATE_EMI_CAP)}/month. ${fixTenure ? `Choose ${fixTenure} months or more, or ` : ''}lower the loan amount. Higher EMIs need a debit card / net banking mandate (coming in MVP 2).`} />
        )
      ) : (
        <Banner tone="success" title="Eligible for UPI AutoPay" body={`EMI is within the ${inr(UPI_MANDATE_EMI_CAP)} UPI mandate cap.`} />
      )}
      <Text variant="caption" color={colors.textSecondary}>Indicative EMI at {(t.annualRate * 100).toFixed(1)}% p.a. reducing{used ? ` · used ${p.label.toLowerCase()}: ${Math.round(t.ltv * 100)}% LTV (example values)` : ''}. Final rate and charges are shown in the KFS before e-sign.</Text>
    </JourneyScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color={colors.textSecondary}>{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}
