import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { Icon, Text } from '../components/ui';
import { colors, headerBtn } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { voiceMetrics } from './voiceMetrics';
import { useVoiceSettings } from './voiceSettings';
import { useVoiceSession, voiceSession } from './voiceSession';

/** Fixed header footprint (same as Zippy's dock slot and every other header button), so headers never jump. */
export const HEADER_MIC_SIZE = headerBtn.box;
const DISC = headerBtn.disc;

const LABEL = {
  ptt: { idle: 'Hold to talk', listening: 'Listening, let go to send', thinking: 'Checking what you said' },
  handsfree: { idle: 'Tap to talk', listening: 'Listening, tap to cancel', thinking: 'Checking what you said' },
} as const;

/** m:ss for the recording timer. */
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const now = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Standalone mic in its own header slot (sibling of HeaderDockSlot; used by Home, BrandHeader, AuthScaffold,
 * Scan QR and Face e-KYC). Drives the app's one voice session; results show in VoiceHost's overlay.
 *
 * v1.4.0 instant feedback: the disc turns solid and a haptic fires in the press handler itself — before the
 * session, permissions or the recognizer respond — and the first painted frame is recorded as
 * `pressToFeedback`. There is no spinner: while the server double-checks, the disc keeps the mic glyph with a
 * small "checking" dot and stays pressable (a new press starts a new turn).
 * Push-to-talk: press-and-hold, release ends the turn. Hands-free: tap to start, tap again to cancel.
 *
 * Independent of Zippy: it never opens the help sheet, never docks / undocks Zippy, does not read Zippy's
 * dock phase and is not affected by `firstgo.zippy.float`. Visible in release builds.
 */
export function HeaderVoiceMic({ onDark = false, style }: { onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  const { phase } = useVoiceSession();
  const { mode } = useVoiceSettings();
  const handsFree = mode === 'handsfree';
  // Local "pressed" flag so the disc changes on this very frame, not after the session round-trip.
  const [pressed, setPressed] = useState(false);
  const pendingPaint = useRef(false);
  const live = phase === 'listening' || (pressed && !handsFree);
  const checking = phase === 'thinking' && !live;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => { if (phase !== 'listening' && !pressed) pendingPaint.current = false; }, [phase, pressed]);

  // First frame that shows the pressed state → metrics (press-in → visible feedback).
  useLayoutEffect(() => {
    if (!live || !pendingPaint.current) return;
    pendingPaint.current = false;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    const mark = () => { const t = voiceMetrics.turns().at(-1); if (t) voiceMetrics.mark(t.id, 'feedback'); };
    if (raf) raf(mark); else mark();
  }, [live]);

  const onPressIn = () => {
    const at = now();
    haptic.tap();
    if (handsFree) return;
    pendingPaint.current = true;
    setPressed(true);
    voiceSession.pressIn(at);
  };
  const onPressOut = () => {
    if (handsFree) return;
    const at = now();
    setPressed(false);
    voiceSession.pressOut(at);
  };
  const onPress = () => {
    if (!handsFree) return;
    const at = now();
    pendingPaint.current = phase !== 'listening';
    voiceSession.tap(at);
  };

  const fg = onDark ? (live ? colors.primary : colors.onPrimary) : (live ? colors.onPrimary : colors.primary);
  const bg = onDark ? (live ? colors.onPrimary : 'rgba(255,255,255,0.16)') : (live ? colors.primary : colors.primaryTint);
  const border = onDark ? 'rgba(255,255,255,0.7)' : colors.primary;
  const label = LABEL[mode][live ? 'listening' : checking ? 'thinking' : 'idle'];
  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      // Push-to-talk: no long-press delay, the hold starts on touch-down.
      delayLongPress={60_000}
      hitSlop={headerBtn.hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={handsFree ? 'Tap, say a command such as “Show pending disbursals”, and Zippy acts when you stop. Tap again to cancel.'
        : 'Press and hold, say a command such as “Show pending disbursals”, then let go.'}
      accessibilityState={{ busy: checking, selected: live }}
      testID="header-voice-mic"
      style={[{ width: HEADER_MIC_SIZE, height: HEADER_MIC_SIZE, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, style, { cursor: 'pointer' } as object]}
    >
      <View style={{ width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: live ? 2.5 : 1.5, borderColor: border }}>
        {live ? (
          <>
            <Icon name="microphone" size={16} color={fg} />
            <Text variant="caption" color={fg} maxFontSizeMultiplier={1} style={{ fontSize: 10, lineHeight: 12 }} accessibilityLabel={`${Math.floor(elapsed / 1000)} seconds`}>{clock(elapsed)}</Text>
          </>
        ) : <Icon name="microphone-outline" size={24} color={fg} />}
        {checking && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.cta, borderWidth: 1.5, borderColor: onDark ? colors.primary : colors.surface }} />
        )}
      </View>
    </Pressable>
  );
}
