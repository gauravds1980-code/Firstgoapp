import React from 'react';
import { Switch, View } from 'react-native';
import { PressableScale, Text } from '../ui';
import { ZippyAvoid } from '../assistant/zippyAvoid';
import { inboxTone, preferenceTone } from '../../theme/library';
import { space, touch } from '../../theme/tokens';

/**
 * Design library (v1.4.7, feature 2): a settings row — title (bodyStrong), optional caption, trailing switch. On =
 * successBright, off = borderStrong. `locked` (promotional alerts before consent) disables the switch (disabledBg) and
 * shows the reason as the caption. The whole row toggles (touch.min). Not a new colour language.
 */
export function PreferenceSwitch({ title, caption, value, onChange, locked, lockedReason, divider }: {
  title: string; caption?: string; value: boolean; onChange: (on: boolean) => void; locked?: boolean; lockedReason?: string; divider?: boolean;
}) {
  const disabled = !!locked;
  const cap = disabled ? lockedReason ?? caption : caption;
  return (
    <PressableScale onPress={() => !disabled && onChange(!value)} disabled={disabled} dimDisabled={false} haptics={!disabled}
      accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={[title, cap].filter(Boolean).join('. ')}
      style={{ minHeight: touch.min + 8, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, ...(divider ? { borderTopWidth: 1, borderTopColor: inboxTone.divider } : {}) }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" color={disabled ? preferenceTone.titleLocked : preferenceTone.title}>{title}</Text>
        {cap ? <Text variant="caption" color={preferenceTone.caption}>{cap}</Text> : null}
      </View>
      <ZippyAvoid>
        <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityElementsHidden importantForAccessibility="no"
          trackColor={{ false: disabled ? preferenceTone.locked : preferenceTone.off, true: preferenceTone.on }}
          thumbColor={preferenceTone.thumb} ios_backgroundColor={disabled ? preferenceTone.locked : preferenceTone.off} {...({ activeThumbColor: preferenceTone.thumb } as object)} />
      </ZippyAvoid>
    </PressableScale>
  );
}

