import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSwipeBack } from '../navigation/useSwipeBack';
import { useZippyTip } from '../components/assistant/tips';
import { JourneyScreen } from '../components/Screen';
import { Banner, Button, Card, Field, Icon, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { AVAILABLE_FROM, UPI_MANDATE_EMI_CAP } from '../config/phases';
import { termsFor } from '../config/products';
import { WaiverMotion } from '../components/motion/WaiverMotion';
import { mandate } from '../services';
import { MandateMode, useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { emi, inr } from '../utils/finance';
import { haptic } from '../utils/haptics';

export default function MandateScreen() {
  const nav = useNavigation();
  const { journey, product, update, features } = useApp();
  const t = termsFor(product, journey.condition);
  const monthly = Math.ceil(emi(journey.loan, t.annualRate, journey.tenure));
  const overCap = monthly > UPI_MANDATE_EMI_CAP;
  const mvp2 = features.debitCardMandate || features.netBankingMandate;
  const [mode, setMode] = useState<MandateMode>(overCap && mvp2 ? 'debitCard' : 'upi');
  const [vpa, setVpa] = useState('rahul.sharma@okidfc');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const maxAmt = Math.ceil((monthly * 1.5) / 100) * 100;
  const start = new Date();
  const end = new Date(start); end.setMonth(end.getMonth() + journey.tenure + 3);
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const done = !!journey.mandate;
  const upiBlocked = mode === 'upi' && overCap;

  // ETB waiver: an active mandate already covers this EMI → animate, record, auto-advance.
  const onFile = journey.offer.waivers.mandateOnFile;
  const covers = !!onFile && monthly <= onFile.maxAmount;
  const advanced = useRef(false);
  useZippyTip(onFile && covers && !journey.mandate ? '' : null);
  useSwipeBack(!(onFile && covers && !journey.mandate)); // iOS: no swipe-back mid waiver animation

  const create = async () => {
    setLoading(true); setErr('');
    const r = mode === 'upi'
      ? await mandate.createUpiMandate({ payerVpa: vpa.trim(), amountMax: maxAmt, frequency: 'MONTHLY', startDate: start.toISOString(), endDate: end.toISOString(), purpose: '14', loanApplicationNumber: journey.offer.loanApplicationNumber }, monthly)
      : await mandate.createEnachMandate(mode);
    setLoading(false);
    if (!r.ok) { haptic.error(); setErr(r.message); return; }
    haptic.success(); update({ mandate: { ...r.data, mode } });
    setTimeout(() => nav.navigate('Kfs'), 1100); // auto-advance — no extra tap
  };

  if (onFile && covers && !journey.mandate) {
    const finish = () => {
      if (advanced.current) return; advanced.current = true;
      update({ mandate: { umn: onFile.umn, status: 'ACTIVE', payerVpa: onFile.payerVpa, mode: 'upi', existing: true } });
      nav.navigate('Kfs');
    };
    return (
      <JourneyScreen step="mandate" assistant="mandate" showTerms={false}>
        <WaiverMotion title="Mandate already active, step skipped"
          subtitle={`An existing UPI AutoPay mandate (up to ${inr(onFile.maxAmount)}/month) covers this EMI of ${inr(monthly)}.`}
          items={[{ icon: 'bank-check', title: 'AutoPay mandate on file', detail: `UMN ••${onFile.umn.split('@')[0]!.slice(-4)} · since ${onFile.registeredOn}` }]} onDone={finish} />
      </JourneyScreen>
    );
  }

  return (
    <JourneyScreen step="mandate" assistant="mandate" footer={done
      ? <Button label="Continue to KFS & charges" iconRight="arrow-right" onPress={() => nav.navigate('Kfs')} />
      : <Button label={mode === 'upi' ? 'Send UPI AutoPay request' : 'Set up e-mandate'} icon={mode === 'upi' ? 'send' : 'bank'} onPress={create} loading={loading}
          disabled={upiBlocked || (mode === 'upi' && !mandate.VPA_REGEX.test(vpa.trim()))} />}>
      <View style={{ gap: space.xs }}>
        <Text variant="h2">Repayment mandate</Text>
        <Text variant="body" color={colors.textSecondary}>Set up auto-debit for the monthly EMI of <Text variant="bodyStrong">{inr(monthly)}</Text>.</Text>
      </View>

      <View style={{ gap: space.sm }}>
        <ModeRow on={mode === 'upi'} icon="contactless-payment" title="UPI AutoPay" sub={overCap ? `Not available — EMI above ${inr(UPI_MANDATE_EMI_CAP)} cap` : `NPCI · EMI up to ${inr(UPI_MANDATE_EMI_CAP)}`} disabled={overCap} onPress={() => setMode('upi')} />
        <ModeRow on={mode === 'debitCard'} icon="credit-card-outline" title="Debit card e-mandate" sub={features.debitCardMandate ? 'NPCI API e-NACH' : `Coming in MVP ${AVAILABLE_FROM.debitCardMandate}`} disabled={!features.debitCardMandate} onPress={() => setMode('debitCard')} />
        <ModeRow on={mode === 'netBanking'} icon="bank-outline" title="Net banking e-mandate" sub={features.netBankingMandate ? 'NPCI API e-NACH' : `Coming in MVP ${AVAILABLE_FROM.netBankingMandate}`} disabled={!features.netBankingMandate} onPress={() => setMode('netBanking')} />
      </View>

      {overCap && !mvp2 && (
        <Banner tone="danger" title="This EMI needs an MVP 2 mandate option"
          body={`EMI ${inr(monthly)} is above the ${inr(UPI_MANDATE_EMI_CAP)} UPI AutoPay limit. Debit card / net banking e-mandate arrives in MVP 2 — go back and extend tenure or lower the amount to proceed today.`} />
      )}
      {overCap && !mvp2 && <Button label="Change tenure / amount" variant="secondary" icon="arrow-left" onPress={() => nav.navigate('Asset')} />}

      {mode === 'upi' && !overCap && !done && (
        <>
          <Field label="Customer's UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="name@bank"
            error={vpa && !mandate.VPA_REGEX.test(vpa.trim()) ? 'Enter a valid UPI ID, e.g. name@okhdfc' : undefined}
            hint="Customer approves with UPI PIN in their UPI app. Demo: an ID starting with 'fail' is declined." />
          <PressableScale accessibilityRole="button" accessibilityLabel="Open UPI app on this phone (intent)" style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="cellphone-arrow-down" size={20} color={colors.primary} />
            <Text variant="bodyStrong" color={colors.primary}>Or approve via UPI intent / QR</Text>
          </PressableScale>
        </>
      )}

      <Card style={{ gap: space.xxs }}>
        <Text variant="label" color={colors.textSecondary}>MANDATE DETAILS</Text>
        <ReadOnlyRow label="Max debit amount" value={inr(maxAmt)} />
        <ReadOnlyRow label="Frequency" value="Monthly" />
        <ReadOnlyRow label="Valid from" value={fmt(start)} />
        <ReadOnlyRow label="Valid till" value={fmt(end)} />
        <ReadOnlyRow label="Purpose" value="Loan EMI" />
      </Card>

      {err ? <Banner tone="danger" title="Mandate not created" body={err} /> : null}
      {done && journey.mandate && (
        <Card style={{ gap: space.xs, borderColor: colors.successBright, backgroundColor: colors.successSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="check-decagram" size={24} color={colors.success} />
            <Text variant="h3" color={colors.success}>{journey.mandate.existing ? 'Existing mandate linked' : 'Mandate active'}</Text>
          </View>
          <ReadOnlyRow label="UMN" value={journey.mandate.umn} />
          <ReadOnlyRow label="Payer" value={journey.mandate.payerVpa} />
          <Text variant="caption" color={colors.textSecondary}>Customer gets a pre-debit notification at least 24 hours before each EMI.</Text>
        </Card>
      )}
    </JourneyScreen>
  );
}

function ModeRow({ on, icon, title, sub, disabled, onPress }: { on: boolean; icon: React.ComponentProps<typeof Icon>['name']; title: string; sub: string; disabled?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} accessibilityLabel={`${title}. ${sub}`}
      style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface }}>
      <Icon name={on ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={on ? colors.primary : colors.textSecondary} />
      <Icon name={icon} size={24} color={colors.text} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color={disabled ? colors.textMuted : colors.textSecondary}>{sub}</Text>
      </View>
    </PressableScale>
  );
}
