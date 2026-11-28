import React, { useState } from 'react';
import { View } from 'react-native';
import { JourneyScreen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Chip, ExampleTag } from '../components/business';
import { Banner, Button, Card, Text } from '../components/ui';
import { useToast } from '../components/Toast';
import { useSectionTracker } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { ConsentCheckbox, PreferenceSwitch } from '../components/library';
import { fmtDate } from '../services/business';
import {
  ALERT_TYPE_LABEL, allowedTypes, giveConsent, hourLabel, isLoanType, PROMO_TYPES, promoLocked, quietLabel, setPromoSwitch, setQuietHours, withdrawConsent,
} from '../services/alerts';
import { updateAlertPrefs } from '../state/stores';
import { useAlerts } from '../state/useAlerts';
import { inboxTone } from '../theme/library';
import { space } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { fmtTime } from '../services/moneyInFlight';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * v1.4.7 Feature 2 — Notification settings (spec §c, approved decisions 1 and 4). Push on this phone (demo: a switch
 * plus the info Banner, live push needs a development build), quiet hours with an hour-chip sheet (default 9:00 PM –
 * 8:00 AM IST; every push waits, no breakthrough), transactional switches (default on) and a separate promotional block:
 * off and locked until the consent box is ticked (timestamp stored per dealer id); unticking withdraws, locks and turns
 * them off. No promotional alert is ever sent in this version. Replaces Profile → Notification settings (ComingSoon).
 */
export default function AlertSettingsScreen() {
  const { dealerId, profile, prefs } = useAlerts();
  const [edit, setEdit] = useState<'start' | 'end' | null>(null);
  const toast = useToast();
  useSectionTracker('settings');
  const set = (fn: Parameters<typeof updateAlertPrefs>[1]) => updateAlertPrefs(dealerId, fn);
  const types = allowedTypes(profile);
  const loanGated = !types.some(isLoanType);
  const locked = promoLocked(prefs);
  const consentAt = prefs.promo.consentAt ? new Date(prefs.promo.consentAt) : null;

  const pickHour = (h: number) => {
    const key = edit === 'start' ? 'startHour' : 'endHour';
    const other = edit === 'start' ? prefs.quiet.endHour : prefs.quiet.startHour;
    if (h === other) { haptic.error(); toast.show('Start and end cannot be the same hour.', 'error'); return; }
    haptic.select();
    set((p) => setQuietHours(p, { [key]: h }));
    setEdit(null);
  };

  return (
    <JourneyScreen title="Notification settings" titleInBody assistant="alerts" showTerms={false} toast={toast.toast?.text} toastTone={toast.toast?.tone}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1" accessibilityRole="header">Notification settings</Text>
        <ExampleTag />
      </View>
      <Banner tone="info" icon="information-outline" title="Live push needs a development build." body="The inbox still works." />

      <Card style={{ paddingVertical: space.xxs }}>
        <PreferenceSwitch title="Push on this phone" caption="Pops up when the app is closed" value={prefs.push} onChange={(on) => set((p) => ({ ...p, push: on }))} />
        <PreferenceSwitch divider title="Quiet hours" caption={prefs.quiet.enabled ? `${quietLabel(prefs.quiet)} · inbox still updates` : 'Off · pushes go out at any hour'}
          value={prefs.quiet.enabled} onChange={(on) => set((p) => ({ ...p, quiet: { ...p.quiet, enabled: on } }))} />
        {prefs.quiet.enabled ? (
          <ZippyAvoid style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', paddingBottom: space.sm }}>
            <Chip label={`From ${hourLabel(prefs.quiet.startHour)}`} icon="weather-night" on={false} onPress={() => setEdit('start')} />
            <Chip label={`Until ${hourLabel(prefs.quiet.endHour)}`} icon="weather-sunny" on={false} onPress={() => setEdit('end')} />
          </ZippyAvoid>
        ) : null}
        {prefs.quiet.enabled ? (
          <Text variant="caption" color={inboxTone.overline} style={{ paddingBottom: space.sm }}>
            Every push waits until {hourLabel(prefs.quiet.endHour)} (India time), loan credits and overdue files too. A night's updates arrive as one summary. Zippy stays quiet.
          </Text>
        ) : null}
      </Card>

      <View style={{ gap: space.xxs }}>
        <Text variant="overline" color={inboxTone.overline} accessibilityRole="header">LOAN AND PAYOUT UPDATES</Text>
        <Text variant="caption" color={inboxTone.overline}>Transactional — about your money and files, not offers.</Text>
      </View>
      <Card style={{ paddingVertical: space.xxs }}>
        {types.map((t, i) => (
          <PreferenceSwitch key={t} divider={i > 0} title={ALERT_TYPE_LABEL[t]} value={prefs.types[t]}
            onChange={(on) => set((p) => ({ ...p, types: { ...p.types, [t]: on } }))} />
        ))}
        {loanGated ? (
          <Text variant="caption" color={inboxTone.overline} style={{ paddingVertical: space.sm }}>
            Loan money alerts are not available for new two-wheeler dealers yet.
          </Text>
        ) : null}
      </Card>

      <View style={{ gap: space.xxs }}>
        <Text variant="overline" color={inboxTone.overline} accessibilityRole="header">PROMOTIONAL ALERTS</Text>
        <Text variant="caption" color={inboxTone.overline}>Optional. Off until you agree. Needed from 1 Jan 2027. Never used for loan or payout updates.</Text>
      </View>
      <Card style={{ paddingVertical: space.xxs }}>
        <ConsentCheckbox checked={!locked}
          label="I agree to receive promotional alerts (videos, leads, offers)."
          caption={consentAt ? `Agreed on ${fmtDate(consentAt)}, ${fmtTime(consentAt)}. I can turn this off any time.` : 'I can turn this off any time.'}
          onChange={(v) => {
            const now = new Date();
            set((p) => (v ? giveConsent(p, now) : withdrawConsent(p, now)));
            haptic.select();
            toast.show(v ? 'Consent recorded. Promotional alerts stay off until you turn them on.' : 'Consent withdrawn. Promotional alerts are off.');
          }} />
        {PROMO_TYPES.map((t) => (
          <PreferenceSwitch key={t.id} divider title={t.label} value={prefs.promo.switches[t.id]} locked={locked} lockedReason="Tick the box above first."
            onChange={(on) => set((p) => setPromoSwitch(p, t.id, on))} />
        ))}
        <Text variant="caption" color={inboxTone.overline} style={{ paddingVertical: space.sm }}>No promotional alerts are sent in this version.</Text>
      </Card>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit === 'start' ? 'Quiet hours start' : 'Quiet hours end'} subtitle="India time (IST)"
        footer={<Button variant="secondary" label="Cancel" onPress={() => setEdit(null)} />}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {HOURS.map((h) => (
            <Chip key={h} compact label={hourLabel(h)} on={edit === 'start' ? prefs.quiet.startHour === h : prefs.quiet.endHour === h} onPress={() => pickHour(h)} />
          ))}
        </View>
      </Sheet>
    </JourneyScreen>
  );
}
