import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { Icon, Text } from '../components/ui';
import { colors, headerBtn } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { useVoiceSession, voiceSession } from './voiceSession';

/** Fixed header footprint (same as Zippy's dock slot and every other header button), so headers never jump. */
export const HEADER_MIC_SIZE = headerBtn.box;
const DISC = headerBtn.disc;

const LABEL = { idle: 'Hold to talk', listening: 'Listening, let go to send', thinking: 'Working it out' } as const;

/** m:ss for the recording timer. */
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * Standalone push-to-talk mic in its own header slot (sibling of HeaderDockSlot; used by Home, BrandHeader,
 * AuthScaffold, Scan QR and Face e-KYC). Press-and-hold records on the app's one voice session
 * (voiceSession.pressIn / pressOut); results show in VoiceHost's overlay.
 *
 * Independent of Zippy: it never opens the help sheet, never docks / undocks Zippy, does not read Zippy's
 * dock phase and is not affected by `firstgo.zippy.float`. Visible in release builds.
 * Listening → filled primary disc + elapsed timer; thinking → spinner, new holds ignored.
 * PTT_MIN_HOLD_MS / PTT_MAX_HOLD_MS are enforced by usePushToTalk (too_short / auto-stop).
 */
export function HeaderVoiceMic({ onDark = false, style }: { onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  const { phase } = useVoiceSession();
  const live = phase === 'listening';
  const busy = phase === 'thinking';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(t);
  }, [live]);

  const fg = onDark ? (live ? colors.primary : colors.onPrimary) : (live ? colors.onPrimary : colors.primary);
  const bg = onDark ? (live ? colors.onPrimary : 'rgba(255,255,255,0.16)') : (live ? colors.primary : colors.primaryTint);
  const border = onDark ? 'rgba(255,255,255,0.7)' : colors.primary;
  return (
    <Pressable
      onPressIn={() => { if (busy) return; haptic.tap(); voiceSession.pressIn(); }}
      onPressOut={() => { if (busy) return; voiceSession.pressOut(); }}
      hitSlop={headerBtn.hitSlop}
      accessibilityRole="button"
      accessibilityLabel={LABEL[phase]}
      accessibilityHint="Press and hold, say a command such as “Show pending disbursals”, then let go."
      accessibilityState={{ busy, selected: live }}
      style={[{ width: HEADER_MIC_SIZE, height: HEADER_MIC_SIZE, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, style, { cursor: 'pointer' } as object]}
    >
      <View style={{ width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: 1.5, borderColor: border }}>
        {busy ? <ActivityIndicator size="small" color={fg} />
          : live ? (
            <>
              <Icon name="microphone" size={16} color={fg} />
              <Text variant="caption" color={fg} maxFontSizeMultiplier={1} style={{ fontSize: 10, lineHeight: 12 }} accessibilityLabel={`${Math.floor(elapsed / 1000)} seconds`}>{clock(elapsed)}</Text>
            </>
          )
          : <Icon name="microphone-outline" size={24} color={fg} />}
      </View>
    </Pressable>
  );
}
