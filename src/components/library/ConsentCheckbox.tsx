import React from 'react';
import { View } from 'react-native';
import { Icon, PressableScale, Text } from '../ui';
import { inboxTone, preferenceTone } from '../../theme/library';
import { space, touch } from '../../theme/tokens';

/**
 * Design library (v1.4.7, feature 2): an explicit consent checkbox — maroon box (checkbox-marked / blank glyphs, as in
 * RC pendency), the statement, and a caption. Used for promotional-alert consent; the caller records the timestamp.
 */
export function ConsentCheckbox({ checked, onChange, label, caption }: { checked: boolean; onChange: (v: boolean) => void; label: string; caption?: string }) {
  return (
    <PressableScale onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={[label, caption].filter(Boolean).join('. ')}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, minHeight: touch.min, paddingVertical: space.xs }}>
      <Icon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={checked ? inboxTone.checkboxOn : inboxTone.checkboxOff} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="body" color={preferenceTone.title}>{label}</Text>
        {caption ? <Text variant="caption" color={preferenceTone.caption}>{caption}</Text> : null}
      </View>
    </PressableScale>
  );
}
