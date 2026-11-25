import React, { useCallback, useEffect, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Slider } from '../components/Slider';
import { Banner, Button, Card, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { UPI_MANDATE_EMI_CAP } from '../config/phases';
import { CONDITION_LABEL, PRODUCTS, termsFor } from '../config/products';
import { useApp } from '../state/AppState';
import { colors, fontScaleCap, radius, space, touch, type } from '../theme/tokens';
import { charges, emi, inr, maxLoan } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';
import { waiverPlan } from '../utils/waivers';
import { NB_HYPHEN } from '../navigation/types';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { clearVoiceOptions, matchVehicleRow, setVoiceOptions, vehicleLabel } from '../voice/voiceOptions';
import { useUndoSource } from '../voice/voiceUndo';

export default function AssetScreen() {
  const nav = useNavigation();
  const { journey, product, update, catalogue, profile } = useApp();
  const p = PRODUCTS[product];
  const t = termsFor(product, journey.condition);
  const used = journey.condition === 'used';
  const max = maxLoan(product, journey.offer.amount, journey.asset.onRoadPrice, journey.condition);
  const min = Math.min(p.minLoan, max);
  const loan = Math.min(journey.loan, max);
  const monthly = emi(loan, t.annualRate, journey.tenure);
  const overCap = monthly > UPI_MANDATE_EMI_CAP;
  // v1.3.0: each time the EMI crosses above the UPI cap counts as a validation error (two in a minute → Zippy offers the how-to).
  React.useEffect(() => { if (overCap) reportValidationError('Asset'); }, [overCap]);
  const offerBinds = journey.offer.amount < t.ltv * journey.asset.onRoadPrice;

  useEffect(() => { if (journey.loan > max) update({ loan: max }); }, [max, journey.loan, update]);

  // Voice: tell /command which chips are on screen while this screen is focused (cleared on blur,
  // so a later screen never sends stale Vehicle chips).
  const tenureOptions = p.tenureOptions;
  useFocusEffect(useCallback(() => {
    const token = setVoiceOptions([
      ...catalogue.map((a) => ({ id: a.id, kind: 'vehicle_model', label: vehicleLabel(a), brand: a.brand, model: a.model, variant: a.variant, value: a.id })),
      ...tenureOptions.map((tn) => ({ id: `tenure-${tn}`, kind: 'tenure', label: `${tn} months`, value: String(tn) })),
    ], 'Asset');
    return () => clearVoiceOptions(token);
  }, [catalogue, tenureOptions]));

  // Voice: a CONFIRMED select ("Select Xtreme 125R", "24 months") does exactly what the chip press
  // does. Only the slots used here are taken; Continue is never pressed for the dealer.
  const draft = useVoiceDraft();
  const focused = useIsFocused();
  useEffect(() => {
    if (!draft || !focused) return;
    const s = draft.slots;
    const row = (s.assetId ? catalogue.find((a) => a.id === s.assetId) : undefined)
      ?? matchVehicleRow(s.vehicle, catalogue) ?? matchVehicleRow(s.model, catalogue);
    if (row) {
      if (row.id !== journey.asset.id) update({ asset: row, loan: maxLoan(product, journey.offer.amount, row.onRoadPrice, journey.condition) });
      voiceDraft.take('assetId'); voiceDraft.take('vehicle'); voiceDraft.take('model'); voiceDraft.take('brand');
      haptic.select();
    }
    if (s.tenureMonths !== undefined && tenureOptions.includes(s.tenureMonths)) {
      const tn = voiceDraft.take('tenureMonths');
      if (tn !== undefined) { update({ tenure: tn }); haptic.select(); }
    }
  }, [draft, focused, catalogue, tenureOptions, journey.asset.id, journey.offer.amount, journey.condition, product, update]);

  // Voice Undo (auto-acted select): restore the previous model / tenure the same way a chip press does.
  useUndoSource('asset', () => journey.asset, (a) => update({ asset: a, loan: maxLoan(product, journey.offer.amount, a.onRoadPrice, journey.condition) }), focused);
  useUndoSource('tenure', () => journey.tenure, (tn) => update({ tenure: tn }), focused);

  // Shortest tenure that brings EMI under the UPI cap, to suggest a fix
  const fixTenure = p.tenureOptions.find((tn) => tn > journey.tenure && emi(loan, t.annualRate, tn) <= UPI_MANDATE_EMI_CAP);
  // v1.2.9: UPI AutoPay is the only mandate method, so an EMI above the cap always blocks.
  const blocked = overCap;
  const c = charges(product, loan);
  const [showCharges, setShowCharges] = useState(false);
  const [breakdown, setBreakdown] = useState(false);
  // Model carousel: a right-edge fade shows there is more to scroll, until the last tile is in view.
  const [moreRight, setMoreRight] = useState(true);
  const onCarousel = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    setMoreRight(contentOffset.x + layoutMeasurement.width < contentSize.width - 4);
  };
  const ratePct = `${(t.annualRate * 100).toFixed(1)}%`;
  // Skip path: name the real next step. KYC / mandate on file are skipped after a short
  // "Checking bank records" beat, so the CTA never says "start KYC" when KYC won't happen.
  const plan = waiverPlan(journey, product);
  const cta = !plan.kyc ? 'Confirm & start KYC' : !plan.mandate ? 'Confirm & set up mandate' : `Confirm & go to e${NB_HYPHEN}sign`;

  // Section-aware Zippy help + what still needs the dealer here.
  const sec = useSectionTracker<'vehicle' | 'emi' | 'charges'>('vehicle');
  useZippyPending(blocked ? [{
    id: 'emiCap', label: `EMI ${inr(monthly)} is above the ${inr(UPI_MANDATE_EMI_CAP)} UPI cap`,
    detail: fixTenure ? `${fixTenure} months brings it under the cap.` : 'Lower the loan amount to bring it under the cap.',
    actionLabel: fixTenure ? `Set ${fixTenure} months` : undefined, onAction: fixTenure ? () => update({ tenure: fixTenure }) : undefined,
  }] : []);

  return (
    <JourneyScreen step="asset" assistant="asset" onScroll={sec.onScroll} footer={
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <View style={{ flexShrink: 1 }}>
            <Text variant="label" color={colors.textSecondary}>EMI · {journey.tenure} months · {ratePct} p.a.</Text>
            {/* v1.3.0: say who gets the money; tap for the loan − charges breakdown. */}
            <PressableScale onPress={() => setBreakdown(true)} accessibilityRole="button" haptics={false}
              accessibilityLabel={`Dealer receives ${inr(c.net)}. Show breakdown`} hitSlop={{ top: 10, bottom: 10 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
              <Text variant="caption" color={colors.primary} style={{ fontFamily: 'Inter_600SemiBold' }}>Dealer receives {inr(c.net)}</Text>
              <Icon name="information-outline" size={14} color={colors.primary} />
            </PressableScale>
          </View>
          <Text variant="h1" color={overCap ? colors.warning : colors.primary} style={{ fontVariant: ['tabular-nums'] }}>{inr(monthly)}<Text variant="caption" color={colors.textSecondary} style={{ lineHeight: type.h1.lineHeight }}> /mo</Text></Text>
        </View>
        {overCap && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.xs }} accessibilityRole="alert">
            <Icon name="alert-circle-outline" size={18} color={colors.danger} />
            <Text variant="caption" color={colors.danger} style={{ flex: 1, fontFamily: 'Inter_600SemiBold' }}>
              {`Above the ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay cap${fixTenure ? `. Try ${fixTenure}+ months` : ' — lower the amount'}`}
            </Text>
          </View>
        )}
        <Button label={cta} iconRight="arrow-right" onPress={() => nav.navigate('FaceKyc')} disabled={blocked}
          accessibilityHint={blocked ? 'Disabled: EMI is above the UPI mandate cap' : undefined} />
      </View>}>
      <View style={{ gap: space.xs }} onLayout={sec.at('vehicle')}>
        <Text variant="h2">Select the {used ? 'used ' : ''}{p.label.toLowerCase()}</Text>
        <Text variant="body" color={colors.textSecondary}>Pick the model the customer is buying, then set tenure and amount.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {used && <Pill label={`${CONDITION_LABEL[journey.condition]} vehicle`} tone="warning" />}
          {/* Short brand name ("Hero models"), so the chip never truncates. */}
          <Pill label={profile && profile.type !== 'multiBrand' && profile.oem ? `${profile.oem.split(' ')[0]} models` : 'All brands'} tone="neutral" />
        </View>
      </View>

      <ZippyAvoid>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} onScroll={onCarousel} scrollEventThrottle={64}>
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
      {/* Edge fade: a third model sits off-screen, so show the row scrolls. */}
      {catalogue.length > 1 && moreRight && (
        <LinearGradient pointerEvents="none" colors={['rgba(253,244,239,0)', colors.bg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 40 }} />
      )}
      </ZippyAvoid>

      {/* v1.3.0: tenure sits right under the models (above the details card), so it is in view on a 360×780 screen. */}
      <ZippyAvoid style={{ gap: space.xs }}>
      <View style={{ gap: space.xs }} onLayout={sec.at('emi')}>
        <Text variant="label">Tenure (months)</Text>
        {/* Equal-width wrapping grid, 3 per row: every option visible and aligned (no clipped "72"). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xs, rowGap: space.xs }} accessibilityRole="radiogroup">
          {p.tenureOptions.map((t) => {
            const on = t === journey.tenure;
            const fix = blocked && t === fixTenure;
            return (
              <PressableScale key={t} onPress={() => { haptic.select(); update({ tenure: t }); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t} months`}
                style={{ width: '31%', flexGrow: 0, minHeight: touch.min, borderRadius: radius.md, borderWidth: fix ? 2 : 1.5, borderColor: on ? (blocked ? colors.danger : colors.primary) : fix ? colors.successBright : colors.border, backgroundColor: on ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm }}>
                <Text variant="bodyStrong" color={on ? colors.onPrimary : colors.text} maxFontSizeMultiplier={fontScaleCap.compact} style={{ textAlign: 'center' }}>{t}</Text>
              </PressableScale>
            );
          })}
        </View>
        {/* Inline validation: tenure that breaks the UPI cap */}
        {blocked && (
          <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
            {fixTenure ? `${journey.tenure} months puts the EMI above ${inr(UPI_MANDATE_EMI_CAP)}. Pick ${fixTenure}+ months (outlined).` : `Even the longest tenure is above ${inr(UPI_MANDATE_EMI_CAP)} — lower the amount.`}
          </Text>
        )}
      </View>
      </ZippyAvoid>

      <ZippyAvoid>
      <Card style={{ gap: space.xs }}>
        <Row label="Brand" value={journey.asset.brand} />
        {/* Same casing as the model tiles above (no upper-casing). */}
        <Row label="Model" value={`${journey.asset.model} ${journey.asset.variant}`} />
        <Row label={used ? 'Valuation (used)' : 'On-road price'} value={inr(journey.asset.onRoadPrice)} />
      </Card>
      </ZippyAvoid>

      <ZippyAvoid>
      <Card style={{ gap: space.xs, borderColor: blocked ? colors.danger : colors.border }}>
        <Text variant="label" color={colors.textSecondary}>Desired loan amount</Text>
        {/* v1.2.9: the pre-approved tile is gone (the offer celebration shows it); keep the ceiling visible as a plain caption. */}
        <Text variant="caption" color={colors.textSecondary}>Up to {inr(journey.offer.amount)} pre-approved</Text>
        <Text variant="display" color={colors.primary} style={{ fontVariant: ['tabular-nums'] }}>{inr(loan)}</Text>
        <Slider label="Loan amount" value={loan} min={min} max={max} step={p.loanStep} onChange={(v) => update({ loan: v })} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color={colors.textSecondary}>{inr(min)}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption" style={{ fontFamily: 'Inter_600SemiBold' }}>{inr(max)}</Text>
            <Text variant="caption" color={colors.textSecondary}>{offerBinds ? 'Pre-qualified offer limit' : `${Math.round(t.ltv * 100)}% of ${used ? 'valuation' : 'on-road price'}`}</Text>
          </View>
        </View>
        {/* EMI + rate: the two figures the customer asks about, sized to dominate */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, marginTop: space.xxs }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={colors.textSecondary}>EMI</Text>
            <Text variant="h1" color={overCap ? colors.warning : colors.text} style={{ fontVariant: ['tabular-nums'] }}>{inr(monthly)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text variant="caption" color={colors.textSecondary}>Rate (indicative)</Text>
            <Text variant="h1" style={{ fontVariant: ['tabular-nums'] }}>{ratePct}</Text>
          </View>
        </View>
        {loan < min && <Text variant="caption" color={colors.danger}>Minimum loan is {inr(p.minLoan)}.</Text>}
      </Card>
      </ZippyAvoid>

      {overCap ? (
        <Banner tone="danger" title={`EMI above ${inr(UPI_MANDATE_EMI_CAP)} — UPI AutoPay can't be used`}
          body={`UPI AutoPay mandates go up to ${inr(UPI_MANDATE_EMI_CAP)}/month. ${fixTenure ? `Choose ${fixTenure} months or more, or ` : ''}lower the loan amount.`} />
      ) : (
        <Banner tone="success" title="Eligible for UPI AutoPay" body={`EMI is within the ${inr(UPI_MANDATE_EMI_CAP)} UPI mandate cap.`} />
      )}
      {/* Charges & net disbursal (the dealer-side summary that used to live on the KFS screen) */}
      <ZippyAvoid>
      <View onLayout={sec.at('charges')}>
      <Card style={{ gap: space.xs }}>
        <PressableScale onPress={() => setShowCharges((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showCharges }}
          accessibilityLabel={`Charges ${inr(c.total)}, dealer receives ${inr(c.net)}. ${showCharges ? 'Hide' : 'Show'} breakdown`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.min }}>
          <View style={{ flex: 1 }}>
            <Text variant="label" color={colors.textSecondary}>DEALER RECEIVES</Text>
            <Text variant="h1" color={colors.primary} style={{ fontVariant: ['tabular-nums'] }}>{inr(c.net)}</Text>
            <Text variant="caption" color={colors.textSecondary}>{inr(loan)} loan − {inr(c.total)} customer charges</Text>
          </View>
          <Icon name={showCharges ? 'chevron-up' : 'chevron-down'} size={24} color={colors.textSecondary} />
        </PressableScale>
        {showCharges && c.lines.map((l) => <ReadOnlyRow key={l.label} label={l.label} value={`− ${inr(l.amount)}`} />)}
      </Card>
      </View>
      </ZippyAvoid>
      <Sheet visible={breakdown} onClose={() => setBreakdown(false)} title={`Dealer receives ${inr(c.net)}`}
        subtitle="The loan is paid to your dealership after the customer's charges are deducted.">
        <ReadOnlyRow label="Loan amount" value={inr(loan)} />
        {c.lines.map((l) => <ReadOnlyRow key={l.label} label={l.label} value={`− ${inr(l.amount)}`} />)}
        <ReadOnlyRow label="Dealer receives" value={inr(c.net)} strong />
      </Sheet>
      <Text variant="caption" color={colors.textSecondary}>Indicative EMI at {ratePct} p.a. reducing{used ? ` · used ${p.label.toLowerCase()}: ${Math.round(t.ltv * 100)}% LTV (example values)` : ''}. The KFS with final rate and charges goes to the customer with the e-sign link.</Text>
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
