import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { ASSISTANT_NAME } from '../config/brand';
import { colors } from '../theme/tokens';
import { Icon } from '../components/ui';
import { haptic } from '../utils/haptics';
import { useVoiceSession, voiceSession } from './voiceSession';

export const MIC_BADGE_SIZE = 20;

/**
 * Compact push-to-talk badge drawn on Zippy (docked header face and floating orb). A sibling ON TOP of
 * Zippy's own pressable, so Zippy's tap (help sheet) / long-press (dock / undock) are untouched; only
 * presses that land on the badge record. Press-in / press-out = PTT on the shared voice session.
 */
export function VoiceMicBadge({ size = MIC_BADGE_SIZE, disabled = false, style, onPressIn, onPressOut }: {
  size?: number; disabled?: boolean; style?: StyleProp<ViewStyle>;
  /** Extra hooks for the host (e.g. floating Zippy stops peeking while held). */
  onPressIn?: () => void; onPressOut?: () => void;
}) {
  const { phase } = useVoiceSession();
  const live = phase === 'listening';
  const busy = phase === 'thinking';
  const off = disabled || busy;
  return (
    <Pressable
      onPressIn={() => { if (off) return; haptic.tap(); onPressIn?.(); voiceSession.pressIn(); }}
      onPressOut={() => { if (off) return; voiceSession.pressOut(); onPressOut?.(); }}
      disabled={disabled}
      // Extend the target mostly outward (right / down), away from Zippy's face.
      hitSlop={{ top: 4, left: 4, right: 10, bottom: 10 }}
      accessibilityRole="button"
      accessibilityLabel={live ? 'Listening, let go to send' : busy ? `${ASSISTANT_NAME} is working it out` : `Hold to talk to ${ASSISTANT_NAME}`}
      accessibilityHint="Press and hold, say a command, then let go. You'll see what I heard before anything happens."
      accessibilityState={{ busy, selected: live, disabled }}
      style={[{ position: 'absolute', zIndex: 2 }, style, { cursor: 'pointer' } as object]}
    >
      <View style={{
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: live ? colors.primary : colors.surface, borderWidth: 1.5, borderColor: colors.primary,
        transform: [{ scale: live ? 1.2 : 1 }],
      }}>
        {busy
          ? <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
          : <Icon name={live ? 'microphone' : 'microphone-outline'} size={Math.round(size * 0.65)} color={live ? colors.onPrimary : colors.primary} />}
      </View>
    </Pressable>
  );
}
