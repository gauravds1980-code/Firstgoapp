import React from 'react';
import { View } from 'react-native';
import { Icon, IconName, PressableScale, Text } from '../ui';
import { alertTone, inboxTone } from '../../theme/library';
import { colors, radius, space, touch } from '../../theme/tokens';

const ICON: Record<keyof typeof alertTone, IconName> = { success: 'check-circle', info: 'information', warning: 'alert', danger: 'alert-circle' };

/**
 * Design library: compact tappable in-app update (icon, one-line title, optional caption, chevron). Tones reuse
 * Banner's washes. Feature 1: the latest credit / stuck line on the Home card (variant 'card', tinted).
 * Feature 2 (v1.4.7): the inbox row (variant 'row'): white row, tone icon in a tinted well, ink title, unread dot
 * (colors.primary) on the well, optional second caption line (`note`, e.g. "Push held until 8:00 AM").
 * Not a push notification.
 */
export function AlertCard({ tone, title, caption, note, onPress, icon, unread, variant = 'card' }: {
  tone: keyof typeof alertTone; title: string; caption?: string; note?: string; onPress?: () => void; icon?: IconName; unread?: boolean; variant?: 'card' | 'row';
}) {
  const t = alertTone[tone];
  const row = variant === 'row';
  const dot = unread ? <View style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: inboxTone.unreadDot, borderWidth: 2, borderColor: row ? inboxTone.rowBg : t.bg }} /> : null;
  const body = (
    <>
      {row ? (
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon ?? ICON[tone]} size={22} color={t.fg} />
          {dot}
        </View>
      ) : (
        <View>
          <Icon name={icon ?? ICON[tone]} size={26} color={t.fg} />
          {dot}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" color={row ? colors.text : t.fg} numberOfLines={row ? 2 : 1}>{title}</Text>
        {caption ? <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{caption}</Text> : null}
        {note ? <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{note}</Text> : null}
      </View>
      {onPress ? <Icon name="chevron-right" size={20} color={colors.textSecondary} /> : null}
    </>
  );
  const style = row
    ? { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm, paddingVertical: space.sm, minHeight: touch.min }
    : { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: t.bg, minHeight: touch.min };
  const a11y = [unread ? 'Unread' : undefined, title, caption, note].filter(Boolean).join('. ');
  return onPress
    ? <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={style}>{body}</PressableScale>
    : <View accessible accessibilityLabel={a11y} style={style}>{body}</View>;
}
