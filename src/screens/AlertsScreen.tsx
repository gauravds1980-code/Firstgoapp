import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { HeaderCircleButton, JourneyScreen } from '../components/Screen';
import { Chip, ExampleTag } from '../components/business';
import { Button, Card, EmptyState, PressableScale, Text } from '../components/ui';
import { useToast } from '../components/Toast';
import { useSectionTracker } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { AlertCard } from '../components/library';
import { SHOW_DEV_UI } from '../config/devFlags';
import type { RootStackParamList } from '../navigation/types';
import {
  addEvent, ALERT_FILTERS, alertCaption, alertTypeAllowed, demoArrival, filterAlerts, groupAlerts, heldNote, hourLabel, isRead, markAllRead, markRead,
  newAlertLine, planPush, readoutAllowed, unreadByFilter, type AlertEvent, type AlertFilter,
} from '../services/alerts';
import { isMoneyInFlightEnabled } from '../services/moneyInFlight';
import { getInboxState, markInvoicePaid, updateInbox } from '../state/stores';
import { useAlerts } from '../state/useAlerts';
import { inboxTone } from '../theme/library';
import { fontScaleCap, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { useVoiceStep } from '../voice/useAutoAdvance';
import { playReply } from '../voice/piper';

const ROUTE = 'Alerts';
const EMPTY_FILTER: Record<AlertFilter, string> = { all: 'alerts', loan: 'loan money alerts', payout: 'payout alerts' };

/**
 * v1.4.7 Feature 2 — Alerts inbox (spec 02-credit-payout-alerts.md §c). One shared inbox per dealer id: unread dot,
 * Today / Earlier, All · Loan money · Payouts chips (unread counts), Mark all as read (not destructive, no Confirm).
 * Tapping a row marks it read and opens Money in flight (that LAN) or Payouts (that invoice). New-two-wheeler-only
 * dealers get commission alerts only (no Loan money chip). In-app only: no push in this build.
 */
export default function AlertsScreen() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Alerts'>>();
  const { dealerId, mobile, profile, seeds, inbox, prefs, events } = useAlerts();
  const loanOn = isMoneyInFlightEnabled(profile);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const toast = useToast(4500);
  const focused = useIsFocused();
  useSectionTracker('list');

  useEffect(() => { if (params?.filter) setFilter(params.filter); }, [params?.at, params?.filter]);

  const counts = useMemo(() => unreadByFilter(events, inbox), [events, inbox]);
  const shown = useMemo(() => filterAlerts(events, filter), [events, filter]);
  const groups = useMemo(() => groupAlerts(shown), [shown]);
  const filters = ALERT_FILTERS.filter((f) => f.id !== 'loan' || loanOn);
  const firstUnread = shown.find((e) => !isRead(e, inbox));

  const open = (e: AlertEvent) => {
    haptic.select();
    updateInbox(dealerId, (s) => markRead(s, e.id, new Date()));
    const t = e.target;
    if (t.screen === 'MoneyInFlight') nav.navigate('MoneyInFlight', { lan: t.lan, ...(t.filter ? { filter: t.filter } : {}), at: Date.now() });
    else nav.navigate('Payouts', { invoice: t.invoice, ...(t.lan ? { lan: t.lan } : {}), at: Date.now() });
  };
  const markAll = () => { haptic.success(); updateInbox(dealerId, (s) => markAllRead(s, events, new Date())); toast.show('All alerts marked as read'); };

  // Voice "proceed" / "aage chaliye": open the first unread row's destination.
  useVoiceStep(!focused ? null : firstUnread
    ? { route: ROUTE, extra: { filter }, cta: { id: 'alerts-open-first', label: `Open ${firstUnread.title}`, press: () => open(firstUnread) } }
    : { route: ROUTE, extra: { filter } });

  /** Demo: a commission credit arrives now, or at 11:30 PM tonight (quiet hours: row now, push held, no readout). */
  const simulate = (night: boolean) => {
    const ev = demoArrival(mobile, profile, night);
    if (!ev) return;
    const r = addEvent(getInboxState(dealerId), seeds, ev, prefs, profile);
    if (!r.added) {
      haptic.error();
      toast.show(r.reason === 'duplicate' ? 'Already in your inbox. The same update is shown once.' : r.reason === 'typeOff' ? 'Commission paid alerts are off in Notification settings.' : 'Not available for your dealership.', 'error');
      return;
    }
    updateInbox(dealerId, () => r.state);
    if (ev.target.screen === 'Payouts') markInvoicePaid(dealerId, ev.target.invoice);
    setFilter('all');
    const p = planPush(ev, prefs);
    haptic.success();
    if (p.held) {
      // Foreground or not: no simulated OS banner and no readout inside quiet hours.
      toast.show(`Added to your inbox. Push held until ${hourLabel(prefs.quiet.endHour)}.`);
      return;
    }
    // App in the foreground: an in-app toast instead of an OS banner, then Zippy reads it (Piper) outside quiet hours.
    toast.show(`New alert: ${ev.title}`);
    if (readoutAllowed(ev.at, prefs.quiet)) void playReply(newAlertLine(ev));
  };

  return (
    <JourneyScreen title="Alerts" titleInBody assistant="alerts" showTerms={false} toast={toast.toast?.text} toastTone={toast.toast?.tone}
      headerAction={<HeaderCircleButton icon="cog-outline" label="Notification settings" onPress={() => nav.navigate('AlertSettings')} />}>
      <View style={{ gap: space.xxs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <Text variant="h1" accessibilityRole="header">Alerts</Text>
          {counts.all > 0 ? (
            <ZippyAvoid>
              <PressableScale onPress={markAll} accessibilityRole="button" accessibilityLabel={`Mark all ${counts.all} alerts as read`} style={{ minHeight: touch.min, justifyContent: 'center', paddingLeft: space.sm }}>
                <Text variant="bodyStrong" color={inboxTone.link} maxFontSizeMultiplier={fontScaleCap.control}>Mark all as read</Text>
              </PressableScale>
            </ZippyAvoid>
          ) : null}
        </View>
        <ExampleTag />
      </View>

      <ZippyAvoid style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        {filters.map((f) => <Chip key={f.id} label={f.label} count={String(counts[f.id])} on={filter === f.id} onPress={() => setFilter(f.id)} />)}
      </ZippyAvoid>

      {events.length === 0 ? (
        <Card>
          <EmptyState icon="bell-outline" title="No alerts yet" body="When a loan is credited or a file gets stuck, it shows up here." />
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="filter-variant-remove" title={`No ${EMPTY_FILTER[filter]}`} body="Nothing in this filter yet."
            action={{ label: 'Show all', icon: 'filter-off-outline', onPress: () => setFilter('all') }} />
        </Card>
      ) : (
        <Card style={{ paddingVertical: space.xs }}>
          {groups.map((g, gi) => (
            <View key={g.title} style={{ marginTop: gi ? space.sm : 0 }}>
              <Text variant="overline" color={inboxTone.overline} accessibilityRole="header" style={{ paddingVertical: space.xxs }}>{g.title.toUpperCase()}</Text>
              {g.items.map((e, i) => (
                <View key={e.id} style={i ? { borderTopWidth: 1, borderTopColor: inboxTone.divider } : undefined}>
                  <AlertCard variant="row" tone={e.tone} title={e.title} caption={alertCaption(e)} note={heldNote(e, prefs)} unread={!isRead(e, inbox)} onPress={() => open(e)} />
                </View>
              ))}
            </View>
          ))}
        </Card>
      )}

      {SHOW_DEV_UI ? (
        <Card style={{ gap: space.xs }}>
          <Text variant="overline" color={inboxTone.overline}>DEMO · TRY AN ALERT</Text>
          <Text variant="caption" color={inboxTone.overline}>
            A commission payout arrives. At night it lands in the inbox at once, but the push waits for the end of quiet hours and Zippy stays quiet.
          </Text>
          <Button variant="secondary" icon="bell-ring-outline" label="Arrives now (11:26 AM)" onPress={() => simulate(false)} />
          <Button variant="secondary" icon="weather-night" label="Arrives tonight (11:30 PM)" onPress={() => simulate(true)} />
          {!alertTypeAllowed('loan.credited', profile) ? (
            <Text variant="caption" color={inboxTone.overline}>Loan money alerts are not available for new two-wheeler dealers yet. Commission alerts still come here.</Text>
          ) : null}
        </Card>
      ) : null}
    </JourneyScreen>
  );
}
