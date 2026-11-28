import React from 'react';
import { HeaderCircleButton } from '../Screen';
import { Badge } from '../ui';

/**
 * Design library (v1.4.7, feature 2): the Home header bell — the shared 40dp header circle + the existing maroon
 * `Badge` with the LIVE unread count (hidden at 0). Opens the Alerts inbox.
 */
export function BellBadge({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <HeaderCircleButton icon="bell-outline" label={count ? `Alerts, ${count} unread` : 'Alerts, none unread'} onPress={onPress}>
      <Badge count={count} style={{ position: 'absolute', top: 0, right: -2 }} />
    </HeaderCircleButton>
  );
}
