import React from 'react';
import { Field, Icon, PressableScale } from '../ui';
import { colors, space, touch } from '../../theme/tokens';

/** Design library: a Field preset for name / mobile search — no label above, leading search icon, clear when non-empty. */
export function SearchBar({ value, onChange, placeholder = 'Search customer or mobile', label = 'Search customer or mobile' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <Field label={label} hideLabel value={value} onChangeText={onChange} placeholder={placeholder} autoCorrect={false} autoCapitalize="none" returnKeyType="search"
      leading={<Icon name="magnify" size={22} color={colors.textSecondary} />}
      right={value ? (
        <PressableScale onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', marginRight: space.xxs }}>
          <Icon name="close-circle" size={20} color={colors.textSecondary} />
        </PressableScale>
      ) : undefined} />
  );
}
