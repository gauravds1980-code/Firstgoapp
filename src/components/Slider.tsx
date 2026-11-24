import React, { useState } from 'react';
import { GestureResponderEvent, View } from 'react-native';
import { colors, radius, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { Icon, PressableScale } from './ui';

/** Dependency-free slider with −/+ steppers (48dp) for precise, accessible adjustment. */
export function Slider({ value, min, max, step, onChange, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }) {
  const [w, setW] = useState(1);
  const pct = max > min ? (value - min) / (max - min) : 1;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const fromX = (e: GestureResponderEvent) => onChange(clamp(min + (e.nativeEvent.locationX / w) * (max - min)));
  const bump = (d: number) => { haptic.select(); onChange(clamp(value + d)); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <PressableScale accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => bump(-step * 5)} disabled={value <= min} style={btn}>
        <Icon name="minus" size={22} color={colors.primary} />
      </PressableScale>
      <View
        style={{ flex: 1, height: touch.min, justifyContent: 'center' }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={fromX}
        onResponderMove={fromX}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => bump(e.nativeEvent.actionName === 'increment' ? step * 5 : -step * 5)}
      >
        <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: colors.primarySoft }}>
          <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, pct * w - 14), width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, borderWidth: 4, borderColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 }} />
      </View>
      <PressableScale accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => bump(step * 5)} disabled={value >= max} style={btn}>
        <Icon name="plus" size={22} color={colors.primary} />
      </PressableScale>
    </View>
  );
}
const btn = { width: touch.min, height: touch.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface };
