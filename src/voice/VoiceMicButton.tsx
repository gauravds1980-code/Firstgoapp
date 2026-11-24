import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { colors, radius, space, touch } from '../theme/tokens';
import { Icon, Text } from '../components/ui';
import { haptic } from '../utils/haptics';

export type VoiceUiPhase = 'idle' | 'listening' | 'thinking';

const HINT: Record<VoiceUiPhase, string> = {
  idle: 'Hold to talk to Zippy',
  listening: 'Listening… let go to send',
  thinking: 'Working it out…',
};

/**
 * Push-to-talk mic (visible in release builds). Plain Pressable so press-in / press-out reach us
 * (PressableScale owns those for its scale animation). Brand primary while the mic is live.
 */
export function VoiceMicButton({ phase, error, onPressIn, onPressOut }: {
  phase: VoiceUiPhase; error?: string | null; onPressIn: () => void; onPressOut: () => void;
}) {
  const live = phase === 'listening';
  const busy = phase === 'thinking';
  return (
    <View style={{ gap: space.xs }}>
      {error ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}>
          <Icon name="alert-circle-outline" size={18} color={colors.danger} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>{error}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Pressable
          onPressIn={() => { if (busy) return; haptic.tap(); onPressIn(); }}
          onPressOut={() => { if (busy) return; onPressOut(); }}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={HINT[phase]}
          accessibilityHint="Press and hold, say a command, then let go. You'll see what I heard before anything happens."
          accessibilityState={{ busy, selected: live }}
          style={{
            width: touch.cta, height: touch.cta, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
            backgroundColor: live ? colors.primary : colors.primaryTint, borderWidth: 2, borderColor: colors.primary,
            transform: [{ scale: live ? 1.08 : 1 }],
          }}
        >
          {busy ? <ActivityIndicator color={colors.primary} /> : <Icon name={live ? 'microphone' : 'microphone-outline'} size={26} color={live ? colors.onPrimary : colors.primary} />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color={live ? colors.primary : colors.text}>{HINT[phase]}</Text>
          <Text variant="caption" color={colors.textSecondary}>Try “Show pending disbursals” or “New two-wheeler loan”.</Text>
        </View>
      </View>
    </View>
  );
}
