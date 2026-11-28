/**
 * v1.4.7 alerts for the signed-in dealer: seeded mock feed (services/alerts) + the dealer's shared inbox state and
 * notification settings (state/stores, keyed by dealer id). One hook so Home's bell, the inbox, settings and voice agree.
 */
import { useMemo } from 'react';
import { inboxEvents, seedAlertsFor, unreadCount } from '../services/alerts';
import { useApp } from './AppState';
import { useAlertPrefs, useInboxState } from './stores';

export function useAlerts() {
  const { session, profile } = useApp();
  const dealerId = session?.dealerId ?? 'anon';
  const seeds = useMemo(() => seedAlertsFor(session?.mobile, profile), [session?.mobile, profile]);
  const inbox = useInboxState(dealerId);
  const prefs = useAlertPrefs(dealerId);
  const events = useMemo(() => inboxEvents(seeds, inbox), [seeds, inbox]);
  const unread = useMemo(() => unreadCount(events, inbox), [events, inbox]);
  return { dealerId, mobile: session?.mobile, profile, seeds, inbox, prefs, events, unread };
}
